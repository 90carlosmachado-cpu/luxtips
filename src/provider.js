export class ProviderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export async function api(env, path, ttl = 3600000) {
  if (!env.API_FOOTBALL_KEY) throw new ProviderError("missing_key");
  const key = "api:" + path,
    now = Date.now(),
    old = await env.DB.prepare("SELECT data,expires FROM cache WHERE key=?")
      .bind(key)
      .first();
  if (old && old.expires > now)
    return {
      data: JSON.parse(old.data),
      stale: false,
      fromCache: true,
      fetchedAt: old.expires - ttl,
    };
  const day = new Date(now).toISOString().slice(0, 10),
    limit = Math.min(600, Math.max(1, Number(env.DAILY_BUDGET) || 300));
  const q = await env.DB.prepare(
    "INSERT INTO quota(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 WHERE n<? RETURNING n",
  )
    .bind(day, limit)
    .first();
  if (!q) {
    if (old)
      return {
        data: JSON.parse(old.data),
        stale: true,
        fromCache: true,
        fetchedAt: old.expires - ttl,
      };
    throw new ProviderError("daily_budget");
  }
  try {
    const r = await fetch("https://v3.football.api-sports.io/" + path, {
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY,
        "User-Agent": "LuxTips/2.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
      cache: "no-store",
    });
    if (!r.ok)
      throw new ProviderError(
        r.status === 429 ? "rate_limit" : "upstream_http",
      );
    if (Number(r.headers.get("content-length") || 0) > 8000000)
      throw new ProviderError("payload_size");
    const d = await r.json();
    if (d?.errors?.rateLimit) throw new ProviderError("rate_limit");
    if (!d || Object.keys(d.errors || {}).length || !Array.isArray(d.response))
      throw new ProviderError("upstream_data");
    if ((d.paging?.total || 1) > 1)
      throw new ProviderError("pagination_required");
    await env.DB.prepare(
      "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires",
    )
      .bind(key, JSON.stringify(d.response), now + ttl)
      .run();
    return { data: d.response, stale: false, fromCache: false, fetchedAt: now };
  } catch (e) {
    if (old)
      return {
        data: JSON.parse(old.data),
        stale: true,
        fromCache: true,
        fetchedAt: old.expires - ttl,
      };
    if (e instanceof ProviderError) throw e;
    const error = new ProviderError("upstream_unavailable");
    error.detail = String(e.message)
      .replaceAll(env.API_FOOTBALL_KEY, "[redacted]")
      .slice(0, 160);
    throw error;
  }
}
export function parseOdds(data, fixtureId, at = Date.now()) {
  const out = {};
  const maps = {
    "Match Winner": { Home: "H", Draw: "D", Away: "A" },
    "Double Chance": {
      "Home/Draw": "HX",
      "Draw/Away": "XA",
      "Home/Away": "HA",
    },
    "Goals Over/Under": {
      "Over 1.5": "O15",
      "Under 1.5": "U15",
      "Over 2.5": "O25",
      "Under 2.5": "U25",
      "Over 3.5": "O35",
      "Under 3.5": "U35",
    },
    "Both Teams Score": { Yes: "BY", No: "BN" },
  };
  const f = data.find((x) => x.fixture?.id === fixtureId);
  if (!f) return out;
  const stamp = Date.parse(f.update);
  if (!Number.isFinite(stamp) || stamp > at || at - stamp > 6 * 3600000)
    return out;
  // One bookmaker; never invent or mix prices into an alleged margin-free probability.
  const book = f.bookmakers?.[0];
  for (const b of book?.bets || [])
    for (const v of b.values || []) {
      const k = maps[b.name]?.[v.value],
        odd = Number(v.odd);
      if (k && odd > 1 && Number.isFinite(odd))
        out[k] = { odd, at: stamp, bookmaker: String(book.name) };
    }
  return out;
}
