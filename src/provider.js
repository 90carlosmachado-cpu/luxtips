import { configuredCompetitions } from "./competitions.js";
export class ProviderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export async function api(
  env,
  path,
  ttl = 3600000,
  force = false,
  allowPaging = false,
) {
  if (!env.API_FOOTBALL_KEY) throw new ProviderError("missing_key");
  const key = "api:" + path,
    now = Date.now(),
    old = await env.DB.prepare("SELECT data,expires FROM cache WHERE key=?")
      .bind(key)
      .first();
  const stored = old ? JSON.parse(old.data) : null;
  const cachedData = Array.isArray(stored) ? stored : stored?.items;
  const inferredAt = old ? old.expires - ttl : null;
  const fetchedAt = Number.isFinite(stored?.fetchedAt)
    ? stored.fetchedAt
    : inferredAt;
  const validCache =
    Array.isArray(cachedData) && Number.isFinite(fetchedAt) && fetchedAt <= now;
  if (!force && validCache && old.expires > now)
    return {
      data: cachedData,
      stale: false,
      fromCache: true,
      fetchedAt,
      paging: stored?.paging || { current: 1, total: 1 },
    };
  const cooldown = await env.DB.prepare(
    "SELECT until FROM locks WHERE key='api-cooldown'",
  ).first();
  if (cooldown?.until > now) {
    if (validCache)
      return {
        data: cachedData,
        stale: old.expires <= now,
        refreshFailed: true,
        fromCache: true,
        fetchedAt,
        paging: stored?.paging || { current: 1, total: 1 },
      };
    throw new ProviderError("rate_limit_cooldown");
  }
  const day = new Date(now).toISOString().slice(0, 10),
    limit = Math.min(600, Math.max(1, Number(env.DAILY_BUDGET) || 300));
  // Reserve the remaining twice-hourly fixture polls before contextual endpoints.
  const contextual = /^(odds\?|injuries\?|fixtures\/lineups\?)/.test(path);
  const utcHour =
    new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60;
  const reserve = contextual
    ? Math.min(
        limit - 1,
        24 + Math.ceil((24 - utcHour) * 2 * configuredCompetitions(env).length),
      )
    : 0;
  const ceiling = limit - reserve;
  const q = await env.DB.prepare(
    "INSERT INTO quota(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 WHERE n<? RETURNING n",
  )
    .bind(day, ceiling)
    .first();
  if (!q) {
    if (validCache)
      return {
        data: cachedData,
        stale: old.expires <= now,
        refreshFailed: true,
        paging: stored?.paging || { current: 1, total: 1 },
        fromCache: true,
        fetchedAt,
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
    if (!r.ok) {
      await providerStatus(env, path, r, {});
      throw new ProviderError(
        r.status === 429 ? "rate_limit" : "upstream_http",
      );
    }
    if (Number(r.headers.get("content-length") || 0) > 8000000)
      throw new ProviderError("payload_size");
    const d = await r.json();
    if (Object.keys(d?.errors || {}).length)
      await providerStatus(env, path, r, d.errors);
    if (d?.errors?.rateLimit) throw new ProviderError("rate_limit");
    if (!d || Object.keys(d.errors || {}).length || !Array.isArray(d.response))
      throw new ProviderError("upstream_data");
    if (!allowPaging && (d.paging?.total || 1) > 1)
      throw new ProviderError("pagination_required");
    await env.DB.prepare(
      "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires",
    )
      .bind(
        key,
        JSON.stringify({ items: d.response, fetchedAt: now, paging: d.paging }),
        now + ttl,
      )
      .run();
    return {
      data: d.response,
      stale: false,
      fromCache: false,
      fetchedAt: now,
      paging: d.paging,
    };
  } catch (e) {
    if (validCache)
      return {
        data: cachedData,
        stale: old.expires <= now,
        refreshFailed: true,
        paging: stored?.paging || { current: 1, total: 1 },
        fromCache: true,
        fetchedAt,
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
    "Asian Handicap": { "Home +1.5": "HAP15", "Away +1.5": "AAP15" },
    "Goals Over/Under": {
      "Over 0.5": "O05",
      "Under 4.5": "U45",
      "Over 1.5": "O15",
      "Under 1.5": "U15",
      "Over 2.5": "O25",
      "Under 2.5": "U25",
      "Over 3.5": "O35",
      "Under 3.5": "U35",
    },
    "Both Teams Score": { Yes: "BY", No: "BN" },
    // Exact full-match names observed in the existing API-Football responses.
    "Total - Home": {
      "Over 0.5": "HO05",
      "Over 1.5": "HO15",
      "Under 1.5": "HU15",
      "Under 2.5": "HU25",
    },
    "Total - Away": {
      "Over 0.5": "AO05",
      "Over 1.5": "AO15",
      "Under 1.5": "AU15",
      "Under 2.5": "AU25",
    },
    "Home Team Score a Goal": { Yes: "HO05" },
    "Away Team Score a Goal": { Yes: "AO05" },
  };
  const f = data.find((x) => x.fixture?.id === fixtureId);
  if (!f) return out;
  const stamp = Date.parse(f.update);
  if (!Number.isFinite(stamp) || stamp > at || at - stamp > 6 * 3600000)
    return out;
  // One bookmaker; never invent or mix prices into an alleged margin-free probability.
  const book = [...(f.bookmakers || [])].sort((a, b) => {
    const coverage = (book) =>
      new Set(
        (book.bets || []).flatMap((m) =>
          (m.values || [])
            .filter((v) => Number.isFinite(Number(v.odd)) && Number(v.odd) > 1)
            .map((v) => maps[m.name]?.[v.value])
            .filter(Boolean),
        ),
      ).size;
    return coverage(b) - coverage(a);
  })[0];
  for (const b of book?.bets || [])
    for (const v of b.values || []) {
      const k = maps[b.name]?.[v.value],
        odd = Number(v.odd);
      if (k && odd > 1 && Number.isFinite(odd))
        out[k] = { odd, at: stamp, bookmaker: String(book.name) };
    }
  return out;
}

// Each page is quota-accounted and cached separately; a single failed fixture
// must never disable odds for another league or an unrelated injury endpoint.
export async function fixtureOdds(
  env,
  id,
  now = Date.now(),
  force = false,
  winnerOnly = false,
) {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ProviderError("invalid_fixture");
  const path = "odds?fixture=" + id + (winnerOnly ? "&bet=1" : "");
  const first = await api(env, path, 3 * 3600000, force, true);
  const total = first.paging?.total || 1;
  if (!Number.isInteger(total) || total < 1 || total > 10)
    throw new ProviderError("odds_page_limit");
  const items = [...first.data];
  for (let page = 2; page <= total; page++) {
    const next = await api(
      env,
      `${path}&page=${page}`,
      3 * 3600000,
      force,
      true,
    );
    items.push(...next.data);
  }
  const matches = items.filter((x) => x.fixture?.id === id);
  // Some responses split bookmaker lists across pages.
  const merged = new Map();
  for (const f of matches) {
    const k = f.update;
    if (!merged.has(k)) merged.set(k, { ...f, bookmakers: [] });
    merged.get(k).bookmakers.push(...(f.bookmakers || []));
  }
  const newest = [...merged.values()].sort(
    (a, b) => Date.parse(b.update) - Date.parse(a.update),
  );
  if (matches.length)
    await env.DB.prepare(
      "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires",
    )
      .bind(
        "api:odds-complete?fixture=" + id,
        JSON.stringify({ items: newest, fetchedAt: now }),
        now + 3 * 3600000,
      )
      .run();
  return {
    odds: parseOdds(newest, id, now),
    pages: total,
    records: matches.length,
    refreshFailed: !!first.refreshFailed,
  };
}

async function providerStatus(env, path, response, errors) {
  if (response.status === 429 || errors.rateLimit)
    await env.DB.prepare(
      "INSERT INTO locks(key,until) VALUES('api-cooldown',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until",
    )
      .bind(
        Date.now() +
          Math.max(
            60,
            Math.min(300, Number(response.headers.get("retry-after")) || 60),
          ) *
            1000,
      )
      .run();
  const safe = {
    at: Date.now(),
    path,
    http: response.status,
    limits: Object.fromEntries(
      [...response.headers].filter(
        ([k]) => k.includes("ratelimit") || k === "retry-after",
      ),
    ),
    errors: Object.fromEntries(
      Object.entries(errors).map(([k, v]) => [
        k,
        String(v).replaceAll(env.API_FOOTBALL_KEY, "[redacted]").slice(0, 220),
      ]),
    ),
  };
  await env.DB.prepare(
    "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
  )
    .bind("provider-error:" + path, JSON.stringify(safe))
    .run();
}
