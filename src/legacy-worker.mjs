import {assessMarket} from "./context/policy.mjs";
import {providerFetch} from "./context/provider.mjs";
// src/competitions.js
var COMPETITIONS = [
  { id: 94, name: "Primeira Liga", kind: "domestic" },
  { id: 39, name: "Premier League", kind: "domestic" },
  { id: 140, name: "La Liga", kind: "domestic" },
  { id: 78, name: "Bundesliga", kind: "domestic" },
  { id: 135, name: "Serie A", kind: "domestic" },
  { id: 61, name: "Ligue 1", kind: "domestic" },
  { id: 88, name: "Eredivisie", kind: "domestic", validationPending: true },
  {
    id: 2,
    name: "Champions League",
    kind: "european",
    validationPending: true
  },
  { id: 3, name: "Liga Europa", kind: "european", validationPending: true },
  {
    id: 848,
    name: "Conference League",
    kind: "european",
    validationPending: true
  }
];
var DEFAULT_LEAGUES = COMPETITIONS.map((c) => c.id).join(",");
function configuredCompetitions(env = {}) {
  const ids = new Set(
    String(env.LEAGUES || DEFAULT_LEAGUES).split(",").map(Number)
  );
  return COMPETITIONS.filter((c) => ids.has(c.id));
}
function competitionEvidence(prediction, league) {
  const c = COMPETITIONS.find((c2) => c2.id === league);
  if (!c?.validationPending) return prediction;
  return {
    ...prediction,
    modelEvidence: "competition-validation-pending",
    historyScope: c.kind === "european" ? "connected-european-and-domestic-fixtures" : "competition-only",
    risks: [
      ...prediction.risks.filter(
        (x) => !x.includes("Combina\xE7\xE3o validada retrospetivamente")
      ),
      "Competi\xE7\xE3o adicionada recentemente; calibra\xE7\xE3o e efic\xE1cia espec\xEDficas ainda n\xE3o validadas.",
      ...c.kind === "european" ? [
        "For\xE7a estimada numa rede de advers\xE1rios das competi\xE7\xF5es dispon\xEDveis; cobertura desigual entre clubes."
      ] : []
    ]
  };
}
function historyPath(league, season, now = Date.now()) {
  const pending = COMPETITIONS.find((c) => c.id === league)?.validationPending;
  const base = `fixtures?league=${league}&season=${season}`;
  if (!pending) return base;
  const today = new Date(now).toISOString().slice(0, 10);
  const end = `${season + 1}-12-31`;
  return `${base}&from=${season}-01-01&to=${today < end ? today : end}`;
}

// src/provider.js
var ProviderError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
};
async function api(env, path, ttl = 36e5, force = false, allowPaging = false) {
  if (!env.API_FOOTBALL_KEY) throw new ProviderError("missing_key");
  const key = "api:" + path, now = Date.now(), old = await env.DB.prepare("SELECT data,expires FROM cache WHERE key=?").bind(key).first();
  const stored = old ? JSON.parse(old.data) : null;
  const cachedData = Array.isArray(stored) ? stored : stored?.items;
  const inferredAt = old ? old.expires - ttl : null;
  const fetchedAt = Number.isFinite(stored?.fetchedAt) ? stored.fetchedAt : inferredAt;
  const validCache = Array.isArray(cachedData) && Number.isFinite(fetchedAt) && fetchedAt <= now;
  if (!force && validCache && old.expires > now)
    return {
      data: cachedData,
      stale: false,
      fromCache: true,
      fetchedAt,
      paging: stored?.paging || { current: 1, total: 1 }
    };
  const cooldown = await env.DB.prepare(
    "SELECT until FROM locks WHERE key='api-cooldown'"
  ).first();
  if (cooldown?.until > now) {
    if (validCache)
      return {
        data: cachedData,
        stale: old.expires <= now,
        refreshFailed: true,
        fromCache: true,
        fetchedAt,
        paging: stored?.paging || { current: 1, total: 1 }
      };
    throw new ProviderError("rate_limit_cooldown");
  }
  const day = new Date(now).toISOString().slice(0, 10), limit = Math.min(7500, Math.max(1, Number(env.DAILY_BUDGET) || 600));
  const contextual = /^(odds\?|injuries\?|fixtures\/lineups\?|fixtures\?team=)/.test(path);
  const utcHour = new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60;
  const reserve = contextual ? Math.min(
    limit - 1,
    24 + Math.ceil((24 - utcHour) * 2 * configuredCompetitions(env).length)
  ) : 0;
  const ceiling = limit - reserve;
  const q = await env.DB.prepare(
    "INSERT INTO quota(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 WHERE n<? RETURNING n"
  ).bind(day, ceiling).first();
  if (!q) {
    if (validCache)
      return {
        data: cachedData,
        stale: old.expires <= now,
        refreshFailed: true,
        paging: stored?.paging || { current: 1, total: 1 },
        fromCache: true,
        fetchedAt
      };
    throw new ProviderError("daily_budget");
  }
  try {
    const r = await providerFetch(env,"https://v3.football.api-sports.io/" + path, {
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY,
        "User-Agent": "LuxTips/2.0",
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(2e4),
      redirect: "manual",
      cache: "no-store"
    });
    if (!r.ok) {
      await providerStatus(env, path, r, {});
      throw new ProviderError(
        r.status === 429 ? "rate_limit" : "upstream_http"
      );
    }
    if (Number(r.headers.get("content-length") || 0) > 8e6)
      throw new ProviderError("payload_size");
    const d = await r.json();
    const receivedAt=Date.now();
    if (path === "status" && d?.response && !Array.isArray(d.response))
      d.response = [
        {
          subscription: d.response.subscription,
          requests: d.response.requests
        }
      ];
    if (Object.keys(d?.errors || {}).length)
      await providerStatus(env, path, r, d.errors);
    if (d?.errors?.rateLimit) throw new ProviderError("rate_limit");
    if (!d || Object.keys(d.errors || {}).length || !Array.isArray(d.response))
      throw new ProviderError("upstream_data");
    if (!allowPaging && (d.paging?.total || 1) > 1)
      throw new ProviderError("pagination_required");
    await env.DB.prepare(
      "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires"
    ).bind(
      key,
      JSON.stringify({ items: d.response, fetchedAt: receivedAt, paging: d.paging }),
      receivedAt + ttl
    ).run();
    return {
      data: d.response,
      stale: false,
      fromCache: false,
      fetchedAt: receivedAt,
      paging: d.paging
    };
  } catch (e) {
    if (e.code === "rate_limit_busy") await env.DB.prepare("UPDATE quota SET n=max(0,n-1) WHERE day=?").bind(day).run();
    if (validCache)
      return {
        data: cachedData,
        stale: old.expires <= now,
        refreshFailed: true,
        paging: stored?.paging || { current: 1, total: 1 },
        fromCache: true,
        fetchedAt
      };
    if (e instanceof ProviderError) throw e;
    if (e.code?.startsWith("rate_limit")) throw new ProviderError(e.code);
    const error = new ProviderError("upstream_unavailable");
    error.detail = String(e.message).replaceAll(env.API_FOOTBALL_KEY, "[redacted]").slice(0, 160);
    throw error;
  }
}
function parseOdds(data, fixtureId, at = Date.now()) {
  const out = {};
  const maps = {
    "Match Winner": { Home: "H", Draw: "D", Away: "A" },
    "Double Chance": {
      "Home/Draw": "HX",
      "Draw/Away": "XA",
      "Home/Away": "HA"
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
      "Under 3.5": "U35"
    },
    "Both Teams Score": { Yes: "BY", No: "BN" },
    // Exact full-match names observed in the existing API-Football responses.
    "Total - Home": {
      "Over 0.5": "HO05",
      "Over 1.5": "HO15",
      "Under 1.5": "HU15",
      "Under 2.5": "HU25"
    },
    "Total - Away": {
      "Over 0.5": "AO05",
      "Over 1.5": "AO15",
      "Under 1.5": "AU15",
      "Under 2.5": "AU25"
    },
    "Home Team Score a Goal": { Yes: "HO05" },
    "Away Team Score a Goal": { Yes: "AO05" }
  };
  const f = data.find((x) => x.fixture?.id === fixtureId);
  if (!f) return out;
  const stamp = Date.parse(f.update);
  if (!Number.isFinite(stamp) || stamp > at || at - stamp > 6 * 36e5)
    return out;
  const book = [...f.bookmakers || []].sort((a, b) => {
    const coverage = (book2) => new Set(
      (book2.bets || []).flatMap(
        (m) => (m.values || []).filter((v) => Number.isFinite(Number(v.odd)) && Number(v.odd) > 1).map((v) => maps[m.name]?.[v.value]).filter(Boolean)
      )
    ).size;
    return coverage(b) - coverage(a);
  })[0];
  for (const b of book?.bets || [])
    for (const v of b.values || []) {
      const k = maps[b.name]?.[v.value], odd = Number(v.odd);
      if (k && odd > 1 && Number.isFinite(odd))
        out[k] = { odd, at: stamp, bookmaker: String(book.name) };
    }
  return out;
}
async function fixtureOdds(env,id,now=Date.now()){if(!Number.isSafeInteger(id)||id<=0)throw new ProviderError("invalid_fixture");const row=await env.DB.prepare("SELECT data FROM fixtures WHERE id=?").bind(id).first();if(!row)return {odds:{},records:0,refreshFailed:true};const r=await (await import("./context/odds.mjs")).collectFixtureOdds(env,JSON.parse(row.data),now);return {...r,records:r.records||0,pages:r.fromCache?0:1,refreshFailed:r.status==="temporary_failure"};}
async function providerStatus(env, path, response, errors) {
  if (response.status === 429 || errors.rateLimit)
    await env.DB.prepare(
      "INSERT INTO locks(key,until) VALUES('api-cooldown',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until"
    ).bind(
      Date.now() + Math.max(
        60,
        Math.min(300, Number(response.headers.get("retry-after")) || 60)
      ) * 1e3
    ).run();
  const safe = {
    at: Date.now(),
    path,
    http: response.status,
    limits: Object.fromEntries(
      [...response.headers].filter(
        ([k]) => k.includes("ratelimit") || k === "retry-after"
      )
    ),
    errors: Object.fromEntries(
      Object.entries(errors).map(([k, v]) => [
        k,
        String(v).replaceAll(env.API_FOOTBALL_KEY, "[redacted]").slice(0, 220)
      ])
    )
  };
  await env.DB.prepare(
    "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data"
  ).bind("provider-error:" + path, JSON.stringify(safe)).run();
}

// src/luxg.js
function marginal(mean) {
  if (!Number.isFinite(mean) || mean <= 0 || mean > 5)
    throw new RangeError("Invalid goal intensity");
  const p = [Math.exp(-mean)];
  for (let k = 1; k <= 30; k++) p.push(p[k - 1] * mean / k);
  const sum = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / sum);
}
function interval(p) {
  let best;
  for (let lo = 0; lo < p.length; lo++) {
    let mass = 0;
    for (let hi = lo; hi < p.length; hi++) {
      mass += p[hi];
      if (mass >= 0.8) {
        if (!best || hi - lo < best.high - best.low || hi - lo === best.high - best.low && mass > best.coverage)
          best = { low: lo, high: hi, coverage: mass };
        break;
      }
    }
  }
  return best;
}
function mixtureProjection(components) {
  if (!components.length || components.some((c) => !Number.isFinite(c.weight) || c.weight < 0) || Math.abs(components.reduce((s, c) => s + c.weight, 0) - 1) > 1e-10)
    throw new RangeError("Invalid mixture weights");
  const parts = components.map((c) => ({
    ...c,
    h: marginal(c.homeGoals),
    a: marginal(c.awayGoals)
  }));
  const home = Array(31).fill(0), away = Array(31).fill(0), scores = [];
  for (let h = 0; h < 31; h++)
    for (let a = 0; a < 31; a++) {
      const probability = parts.reduce(
        (s, c) => s + c.weight * c.h[h] * c.a[a],
        0
      );
      home[h] += probability;
      away[a] += probability;
      scores.push({ home: h, away: a, probability });
    }
  scores.sort(
    (a, b) => b.probability - a.probability || a.home - b.home || a.away - b.away
  );
  return {
    version: "luxg-2",
    method: components.length > 1 ? "poisson-mixture" : "opponent-poisson",
    eventXg: false,
    topScores: scores.slice(0, 3),
    topThreeMass: scores.slice(0, 3).reduce((s, x) => s + x.probability, 0),
    goalRanges: {
      nominalCoverage: 0.8,
      home: interval(home),
      away: interval(away)
    }
  };
}
function scoreProjection(homeGoals, awayGoals) {
  return mixtureProjection([{ weight: 1, homeGoals, awayGoals }]);
}

// src/model.js
var VERSION = "luxg-1-opponent-poisson";
var DAY = 864e5;
var clip = (x, a, b) => Math.max(a, Math.min(b, x));
function normalize(f) {
  const id = f?.fixture?.id, ts = Date.parse(f?.fixture?.date), home = f?.teams?.home, away = f?.teams?.away;
  if (!Number.isInteger(id) || !Number.isFinite(ts) || !Number.isInteger(home?.id) || !Number.isInteger(away?.id) || home.id === away.id || !Number.isInteger(f?.league?.id))
    return null;
  const full = f.score?.fulltime;
  const hg = full?.home, ag = full?.away;
  const finished = ["FT", "AET", "PEN"].includes(f.fixture.status?.short) && Number.isInteger(hg) && Number.isInteger(ag) && hg >= 0 && ag >= 0;
  return {
    id,
    ts,
    league: f.league.id,
    season: f.league.season,
    competition: String(f.league.name || ""),
    country: String(f.league.country || ""),
    home: home.id,
    away: away.id,
    homeName: String(home.name || ""),
    awayName: String(away.name || ""),
    hg: finished ? hg : null,
    ag: finished ? ag : null,
    status: f.fixture.status?.short || "TBD",
    finished,
    neutral: f.fixture.venue?.id === null
  };
}
function fit(history, cutoff, opts = {}) {
  const half = opts.halfLife || 180, prior = opts.prior || 8;
  const rows = history.filter(
    (r) => r.finished && r.ts + 2 * 36e5 < cutoff && r.ts > cutoff - 3 * 365 * DAY
  ).map((r) => ({ ...r })).sort((a, b) => a.ts - b.ts);
  const teams = {};
  let sw = 0, sh = 0, sa = 0;
  for (const r of rows) {
    r._w = Math.exp(-Math.log(2) * (cutoff - r.ts) / DAY / half);
    sw += r._w;
    sh += r.hg * r._w;
    sa += r.ag * r._w;
    for (const t of [r.home, r.away])
      teams[t] ||= {
        attack: 1,
        defense: 1,
        n: 0,
        w: 0,
        elo: 1500,
        last: 0,
        recent: [],
        home: { n: 0, gf: 0, ga: 0 },
        away: { n: 0, gf: 0, ga: 0 }
      };
    for (const [t, side, gf, ga] of [
      [r.home, "home", r.hg, r.ag],
      [r.away, "away", r.ag, r.hg]
    ]) {
      const x = teams[t];
      x.n++;
      x.w += r._w;
      x.last = r.ts;
      x.recent.push({
        ts: r.ts,
        gf,
        ga,
        opponent: t === r.home ? r.awayName : r.homeName,
        opponentId: t === r.home ? r.away : r.home,
        side
      });
      x.recent = x.recent.slice(-5);
      x[side].n++;
      x[side].gf += gf;
      x[side].ga += ga;
    }
    const h = teams[r.home], a = teams[r.away], expected = 1 / (1 + 10 ** ((a.elo - h.elo - 60) / 400)), actual = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    h.elo += 20 * (actual - expected);
    a.elo -= 20 * (actual - expected);
  }
  const bh = (sh + 15) / (sw + 10), ba = (sa + 12) / (sw + 10);
  for (let it = 0; it < 25; it++) {
    const sums = {};
    for (const t of Object.keys(teams))
      sums[t] = { gf: prior, ef: prior, ga: prior, ea: prior };
    for (const r of rows) {
      const w = r._w, h = teams[r.home], a = teams[r.away], hs = sums[r.home], as = sums[r.away];
      hs.gf += w * r.hg;
      hs.ef += w * bh * a.defense;
      as.gf += w * r.ag;
      as.ef += w * ba * h.defense;
      hs.ga += w * r.ag;
      hs.ea += w * ba * a.attack;
      as.ga += w * r.hg;
      as.ea += w * bh * h.attack;
    }
    for (const [t, x] of Object.entries(teams)) {
      x.attack = clip(
        0.5 * x.attack + 0.5 * sums[t].gf / sums[t].ef,
        0.25,
        3
      );
      x.defense = clip(
        0.5 * x.defense + 0.5 * sums[t].ga / sums[t].ea,
        0.25,
        3
      );
    }
  }
  for (const x of Object.values(teams))
    for (const side of ["home", "away"])
      Object.assign(x[side], {
        weightedGF: 0,
        weightedGA: 0,
        expectedGF: 0,
        expectedGA: 0
      });
  for (const r of rows) {
    const h = teams[r.home], a = teams[r.away], eh = bh * h.attack * a.defense, ea = ba * a.attack * h.defense;
    for (const [x, side, gf, ga, ef, eg] of [
      [h, "home", r.hg, r.ag, eh, ea],
      [a, "away", r.ag, r.hg, ea, eh]
    ]) {
      x[side].weightedGF += r._w * gf;
      x[side].weightedGA += r._w * ga;
      x[side].expectedGF += r._w * ef;
      x[side].expectedGA += r._w * eg;
    }
  }
  return { teams, bh, ba, n: rows.length, cutoff, opts };
}
function grid(lh, la) {
  const hp = [Math.exp(-lh)], ap = [Math.exp(-la)];
  for (let i = 1; i <= 22; i++) {
    hp[i] = hp[i - 1] * lh / i;
    ap[i] = ap[i - 1] * la / i;
  }
  const out = { H: 0, D: 0, A: 0, O15: 0, O25: 0, O35: 0, BY: 0 };
  let s = 0;
  for (let i = 0; i < hp.length; i++)
    for (let j = 0; j < ap.length; j++) {
      const p = hp[i] * ap[j];
      s += p;
      out[i > j ? "H" : i === j ? "D" : "A"] += p;
      if (i + j > 1.5) out.O15 += p;
      if (i + j > 2.5) out.O25 += p;
      if (i + j > 3.5) out.O35 += p;
      if (i && j) out.BY += p;
    }
  for (const k of Object.keys(out)) out[k] /= s;
  return {
    ...out,
    U15: 1 - out.O15,
    U25: 1 - out.O25,
    U35: 1 - out.O35,
    BN: 1 - out.BY,
    HX: out.H + out.D,
    XA: out.D + out.A,
    HA: out.H + out.A
  };
}
function predict(state, f) {
  const h = state.teams[f.home], a = state.teams[f.away];
  const lh = clip(state.bh * (h?.attack || 1) * (a?.defense || 1), 0.15, 5), la = clip(state.ba * (a?.attack || 1) * (h?.defense || 1), 0.15, 5);
  const ew = state.opts.eloWeight || 0, delta = clip(((h?.elo || 1500) - (a?.elo || 1500)) / 400, -1, 1);
  const homeGoals = clip(lh * Math.exp(ew * delta), 0.15, 5), awayGoals = clip(la * Math.exp(-ew * delta), 0.15, 5);
  const probabilities = grid(homeGoals, awayGoals), sample = Math.min(h?.w || 0, a?.w || 0);
  const risks = [
    "Modelo de golos; n\xE3o representa xG medido por eventos.",
    "Aus\xEAncias e alinhamentos n\xE3o ajustam probabilidades sem valida\xE7\xE3o hist\xF3rica."
  ];
  if (sample < 12)
    risks.push("Amostra efetiva insuficiente ou equipa rec\xE9m-promovida.");
  if (Math.max(state.cutoff - (h?.last || 0), state.cutoff - (a?.last || 0)) > 45 * DAY)
    risks.push("Uma equipa tem dados recentes limitados.");
  const team = (x) => x ? {
    attack: x.attack,
    defense: x.defense,
    elo: x.elo,
    n: x.n,
    effectiveSample: x.w,
    recent: x.recent,
    home: x.home,
    away: x.away,
    restDays: Math.floor((f.ts - x.last) / DAY)
  } : null;
  return {
    version: VERSION,
    league: f.league,
    homeName: f.homeName,
    awayName: f.awayName,
    cutoff: state.cutoff,
    homeGoals,
    awayGoals,
    probabilities,
    luxg: scoreProjection(homeGoals, awayGoals),
    sample,
    quality: sample >= 20 ? "Boa" : sample >= 12 ? "Moderada" : "Insuficiente",
    teams: { home: team(h), away: team(a) },
    risks
  };
}
function outcome(k, h, a) {
  return {
    H: h > a,
    D: h === a,
    A: h < a,
    HX: h >= a,
    XA: a >= h,
    HA: h !== a,
    O15: h + a > 1.5,
    U15: h + a < 1.5,
    O25: h + a > 2.5,
    U25: h + a < 2.5,
    O35: h + a > 3.5,
    U35: h + a < 3.5,
    BY: h > 0 && a > 0,
    BN: h === 0 || a === 0,
    O05: h + a >= 1,
    U45: h + a <= 4,
    HU15: h <= 1,
    AU15: a <= 1,
    HU25: h <= 2,
    AU25: a <= 2,
    HAP15: h + 1.5 > a,
    AAP15: a + 1.5 > h,
    HO05: h >= 1,
    AO05: a >= 1,
    HO15: h >= 2,
    AO15: a >= 2
  }[k] ? 1 : 0;
}
function wilson(w, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = w / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [c - m, c + m];
}
function calibrationBin(market, p) {
  const bins = market?.bins || [];
  const direct = bins.find((b) => p >= b.low && p < b.high);
  if (direct?.n >= 100) return direct;
  const windows = [];
  for (let start = 0; start < bins.length; start++) {
    for (let end = start; end < Math.min(start + 3, bins.length); end++) {
      const bs = bins.slice(start, end + 1), low = bs[0].low, high = bs.at(-1).high;
      if (low < 0.5 || p < low || p >= high) continue;
      const n = bs.reduce((s, b) => s + b.n, 0);
      if (n < 100) continue;
      const mean = bs.reduce((s, b) => s + b.n * (b.mean || 0), 0) / n;
      const wins = bs.reduce((s, b) => s + b.n * (b.rate || 0), 0);
      windows.push({
        low,
        high,
        n,
        mean,
        rate: wins / n,
        interval: wilson(wins, n)
      });
    }
  }
  return windows.sort(
    (a, b) => a.high - a.low - (b.high - b.low) || Math.abs(a.mean - p) - Math.abs(b.mean - p)
  )[0] || null;
}
function winnerTip(pred, validation, odds = {}, context = {}) {
  const now = context.now ?? Date.now();
  const source = context.sourceUpdatedAt;
  if (pred.sample < 12 || !Number.isFinite(source) || source > now || now - source > 24 * 36e5)
    return null;
  const p = pred.probabilities;
  if (![p.H, p.D, p.A].every((x) => Number.isFinite(x) && x >= 0 && x <= 1) || Math.abs(p.H + p.D + p.A - 1) > 1e-6)
    return null;
  const market = p.H > p.A ? "H" : "A";
  const probability = p[market];
  const runnerUp = Math.max(p.D, p[market === "H" ? "A" : "H"]);
  if (probability <= runnerUp) return null;
  const v = validation?.markets?.[market];
  const bin = calibrationBin(v, probability);
  const o = odds[market];
  const validOdd = o && Number.isFinite(o.odd) && o.odd > 1 && Number.isFinite(o.at) && o.at <= now && now - o.at < 6 * 36e5;
  const expectedValue = validOdd ? probability * o.odd - 1 : null;
  const team = market === "H" ? pred.homeName || "Equipa da casa" : pred.awayName || "Equipa visitante";
  const provisional = !!context.stale || now - source > 2 * 36e5;
  return {
    market,
    label: `${team} vence`,
    selectionType: "winner-tip",
    probability,
    margin: probability - runnerUp,
    favoritism: probability >= 0.65 ? "Favorito destacado" : probability >= 0.5 ? "Favorito" : "Vantagem curta",
    majority: probability >= 0.5,
    provisional,
    sourceUpdatedAt: source,
    reliability: bin ? {
      n: bin.n,
      observed: bin.rate,
      interval: bin.interval,
      low: bin.low,
      high: bin.high
    } : null,
    calibrationStatus: v?.enabled && v.byLeague?.[pred.league]?.enabled && bin && Math.abs(bin.rate - bin.mean) <= 0.08 ? "Evid\xEAncia hist\xF3rica dispon\xEDvel" : "Fiabilidade deste perfil ainda por confirmar",
    fairOdd: 1 / probability,
    minimumOdd: Math.ceil(1.03 / probability * 100) / 100,
    odd: validOdd ? o.odd : null,
    bookmaker: validOdd ? o.bookmaker : null,
    oddsAt: validOdd ? o.at : null,
    expectedValue,
    valueStatus: expectedValue === null ? "Valor por confirmar: sem odds reais recentes." : expectedValue >= 0.03 ? "Odd com valor esperado positivo estimado; lucro n\xE3o demonstrado." : "A equipa \xE9 favorita, mas a odd n\xE3o atinge o crit\xE9rio de valor do modelo.",
    reason: `${team} tem a maior probabilidade no resultado final: ${(100 * probability).toFixed(1)}%, com ${(100 * (probability - runnerUp)).toFixed(1)} pontos de vantagem sobre a segunda op\xE7\xE3o. Golos estimados: ${pred.homeGoals.toFixed(2)}\u2013${pred.awayGoals.toFixed(2)}, ajustados \xE0 for\xE7a dos advers\xE1rios e ao fator casa.`,
    risks: [
      ...pred.risks || [],
      ...provisional ? [
        "Progn\xF3stico provis\xF3rio: atualiza\xE7\xE3o da fonte em atraso; confirmar hor\xE1rio e plant\xE9is."
      ] : [],
      ...probability < 0.5 ? [
        "Favorito relativo: empate e vit\xF3ria advers\xE1ria somam maior probabilidade."
      ] : []
    ]
  };
}

// src/opponent-history.js
async function collectOpponentHistory(env, requests, now = Date.now()) {
  const db = env.DB, checks = [];
  const unique = [
    ...new Map(
      requests.filter((x) => Number.isSafeInteger(x.id) && x.id > 0).sort((a, b) => b.priority - a.priority).map((x) => [x.id, x])
    ).values()
  ].slice(0, 2);
  for (const team of unique) {
    try {
      const response = await api(
        env,
        `fixtures?team=${team.id}&last=50&status=FT-AET-PEN`,
        864e5
      );
      if (response.stale || response.refreshFailed)
        throw new Error("opponent_history_stale");
      const rows = response.data.slice(0, 50).map(normalize).filter(
        (f) => f && f.finished && f.ts < now && (f.home === team.id || f.away === team.id)
      );
      const marker = await db.prepare("SELECT data FROM meta WHERE key=?").bind("opponent-history:" + team.id).first();
      if (!marker || JSON.parse(marker.data).sourceAt !== response.fetchedAt) {
        for (let i = 0; i < rows.length; i += 25)
          await db.batch(
            rows.slice(i, i + 25).map(
              (f) => db.prepare(
                "INSERT INTO opponent_history(team_id,fixture_id,kickoff,league_id,source_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,fixture_id) DO UPDATE SET kickoff=excluded.kickoff,league_id=excluded.league_id,source_at=excluded.source_at,data=excluded.data WHERE excluded.source_at>opponent_history.source_at"
              ).bind(
                team.id,
                f.id,
                f.ts,
                f.league,
                response.fetchedAt,
                JSON.stringify(f)
              )
            )
          );
        const data = {
          team: team.id,
          name: team.name,
          sourceAt: response.fetchedAt,
          count: rows.length,
          leagues: [...new Set(rows.map((f) => f.league))],
          trainingStatus: "cross-league-validation-pending"
        };
        await db.prepare(
          "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data"
        ).bind("opponent-history:" + team.id, JSON.stringify(data)).run();
      }
      checks.push({ team: team.id, count: rows.length });
    } catch (e) {
      checks.push({
        team: team.id,
        code: e.code || "opponent_history_unavailable"
      });
      if (["rate_limit", "rate_limit_cooldown", "daily_budget"].includes(e.code))
        break;
    }
  }
  return checks;
}
async function runQueuedOpponentHistory(env) {
  const row = await env.DB.prepare(
    "SELECT data FROM meta WHERE key='opponent-history:request'"
  ).first();
  if (!row) return;
  const job = JSON.parse(row.data), now = Date.now();
  if (!job.active || !Number.isFinite(job.expiresAt) || job.expiresAt <= now || job.nextAt > now)
    return;
  const teams = Array.isArray(job.teams) ? job.teams.slice(0, 2) : [];
  if (!teams.length) return;
  const checks = await collectOpponentHistory(env, teams);
  const complete = checks.length === teams.length && checks.every((x) => x.count > 0);
  const lock = await env.DB.prepare(
    "SELECT until FROM locks WHERE key='api-cooldown'"
  ).first();
  await env.DB.prepare(
    "UPDATE meta SET data=? WHERE key='opponent-history:request'"
  ).bind(
    JSON.stringify({
      ...job,
      checks,
      active: !complete,
      at: Date.now(),
      nextAt: Math.max(Date.now() + 65e3, lock?.until || 0)
    })
  ).run();
}

// src/window.js
var DAY2 = 864e5;
var formatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var lisbonDay = (ts) => formatter.format(new Date(ts));
function forecastWindow(now = Date.now()) {
  const today = lisbonDay(now);
  const shifted = (days2) => new Date(Date.parse(today + "T12:00:00Z") + days2 * DAY2).toISOString().slice(0, 10);
  const days = [today, shifted(1), shifted(2)], next = shifted(3);
  const nominal = Date.parse(next + "T00:00:00Z");
  let low = nominal - 36 * 36e5, high = nominal + 36 * 36e5;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (lisbonDay(mid) < next) low = mid;
    else high = mid;
  }
  return { start: now, end: high, days, timeZone: "Europe/Lisbon" };
}
function publicGames(rows, now = Date.now()) {
  const window = forecastWindow(now);
  const games = rows.flatMap((row) => {
    try {
      const g = JSON.parse(row.data), current = JSON.parse(row.fixture_data);
      if (current.finished || current.status !== "NS" || current.ts <= now || current.ts >= window.end || current.ts !== g.fixture.ts || current.id !== g.fixture.id || current.home !== g.fixture.home || current.away !== g.fixture.away)
        return [];
      if (!g.prediction?.luxg && Number.isFinite(g.prediction?.homeGoals) && Number.isFinite(g.prediction?.awayGoals))
        g.prediction.luxg = scoreProjection(
          g.prediction.homeGoals,
          g.prediction.awayGoals
        );
      return [g];
    } catch {
      return [];
    }
  });
  return { games, window };
}

// src/pricing-policy.js
var MIN_ODD = 1.25;
var PRICING_VERSION = "verified-odds-1.25-v1";
function quoteFor(g,market,now){return assessMarket(g,market,now).eligible?g.odds[market]:null;}
function pricedTip(g, tip, now) {
  if (!tip) return null;
  const q = quoteFor(g, tip.market, now);
  return {
    ...tip,
    odd: q?.odd ?? null,
    bookmaker: q?.bookmaker ?? null,
    oddsAt: q?.at ?? null,
    expectedValue: q ? tip.probability * q.odd - 1 : null,
    priceEligible: !!q,
    minimumMarketOdd: MIN_ODD,
    valueStatus: !q ? (g.prediction?.contextAdjustment && g.odds?.[tip.market] ? "Sem vantagem suficiente após margem e divergência do modelo." : "Sem odd verificada de pelo menos 1,25.") : tip.probability * q.odd > 1 ? "Valor esperado positivo estimado; rentabilidade n\xE3o demonstrada." : "A odd n\xE3o oferece valor esperado positivo segundo o modelo."
  };
}
function applyPricing(g, now) {
  const out = {
    ...g,
    winnerTip: pricedTip(g, g.winnerTip, now),
    pricingPolicy: PRICING_VERSION
  };
  if (g.displayTip) {
    const p = pricedTip(g, g.displayTip, now);
    if (p.priceEligible) out.displayTip = p;
    else delete out.displayTip;
  }
  return out;
}

// src/market-probabilities.js
function extraGoalMarkets(components) {
  if (!Array.isArray(components) || !components.length || components.some(
    (c) => !Number.isFinite(c.weight) || c.weight < 0 || ![c.homeGoals, c.awayGoals].every(
      (x) => Number.isFinite(x) && x > 0 && x <= 5
    )
  ) || Math.abs(components.reduce((s, c) => s + c.weight, 0) - 1) > 1e-10)
    return {};
  const pmf = (mean) => {
    const p = [Math.exp(-mean)];
    for (let n = 1; n <= 30; n++) p.push(p[n - 1] * mean / n);
    const sum = p.reduce((a, b) => a + b, 0);
    return p.map((x) => x / sum);
  };
  const out = Object.fromEntries(
    [
      "HO05",
      "AO05",
      "HO15",
      "AO15",
      "O05",
      "U45",
      "HU15",
      "AU15",
      "HU25",
      "AU25",
      "HAP15",
      "AAP15"
    ].map((k) => [k, 0])
  );
  for (const c of components) {
    const h = pmf(c.homeGoals), a = pmf(c.awayGoals), total = pmf(c.homeGoals + c.awayGoals);
    const cdf = (p2) => p2.map((_, i) => p2.slice(0, i + 1).reduce((s, x) => s + x, 0)), hc = cdf(h), ac = cdf(a);
    const p = {
      HO05: 1 - h[0],
      AO05: 1 - a[0],
      HO15: 1 - hc[1],
      AO15: 1 - ac[1],
      O05: 1 - h[0] * a[0],
      U45: total.slice(0, 5).reduce((s, x) => s + x, 0),
      HU15: hc[1],
      AU15: ac[1],
      HU25: hc[2],
      AU25: ac[2],
      HAP15: h.reduce((s, x, i) => s + x * ac[Math.min(30, i + 1)], 0),
      AAP15: a.reduce((s, x, i) => s + x * hc[Math.min(30, i + 1)], 0)
    };
    for (const k of Object.keys(out)) out[k] += c.weight * p[k];
  }
  return out;
}
function marketProbabilities(prediction) {
  return {
    ...prediction.probabilities,
    ...extraGoalMarkets(prediction.components)
  };
}
function marketLabel(market, fixture) {
  return {
    HX: `${fixture.homeName} ou empate`,
    XA: `${fixture.awayName} ou empate`,
    O05: "Mais de 0,5 golos",
    U45: "Menos de 4,5 golos",
    HU15: `${fixture.homeName} marca menos de 2 golos`,
    AU15: `${fixture.awayName} marca menos de 2 golos`,
    HU25: `${fixture.homeName} marca menos de 3 golos`,
    AU25: `${fixture.awayName} marca menos de 3 golos`,
    HAP15: `${fixture.homeName} \u2014 handicap +1,5`,
    AAP15: `${fixture.awayName} \u2014 handicap +1,5`,
    O15: "Mais de 1,5 golos",
    U15: "Menos de 1,5 golos",
    O25: "Mais de 2,5 golos",
    U25: "Menos de 2,5 golos",
    O35: "Mais de 3,5 golos",
    U35: "Menos de 3,5 golos",
    BY: "Ambas marcam",
    BN: "Ambas marcam \u2014 N\xE3o",
    HO05: `${fixture.homeName} marca pelo menos 1 golo`,
    AO05: `${fixture.awayName} marca pelo menos 1 golo`,
    HO15: `${fixture.homeName} marca pelo menos 2 golos`,
    AO15: `${fixture.awayName} marca pelo menos 2 golos`
  }[market];
}

// src/daily-markets.js
var POLICY_VERSION = "daily-market-v3-priced";
var MAX_DAILY_GAMES = 3;
var HOUR = 36e5;
function eligible(g, now) {
  const f = g.fixture, w = g.winnerTip;
  return f?.status === "NS" && !f.finished && f.ts > now && f.ts < forecastWindow(now).end && w?.majority && ["H", "A"].includes(w.market) && Number.isFinite(w.probability) && w.probability >= 0.5 && w.probability <= 1 && Number.isFinite(w.sourceUpdatedAt) && w.sourceUpdatedAt <= now && now - w.sourceUpdatedAt <= 24 * HOUR;
}
function chooseDailyMarkets(games, now, options = {}) {
  const days = /* @__PURE__ */ new Map();
  for (const g of games.filter(
    (g2) => eligible(g2, now) && (options.alternativeFirst || quoteFor(g2, g2.winnerTip.market, now))
  ).sort(
    (a, b) => b.winnerTip.probability - a.winnerTip.probability || a.fixture.ts - b.fixture.ts || a.fixture.id - b.fixture.id
  )) {
    const day = lisbonDay(g.fixture.ts);
    if (!days.has(day)) days.set(day, []);
    if (days.get(day).length < MAX_DAILY_GAMES) days.get(day).push(g);
  }
  return [...days].flatMap(([day, selected]) => {
    let best = null;
    for (const g of selected) {
      const home = g.winnerTip.market === "H";
      const p = marketProbabilities(g.prediction);
      const allowed = [
        home ? "HX" : "XA",
        "O15",
        "U15",
        "O25",
        "U25",
        "O35",
        "U35",
        "BY",
        "BN",
        home ? "HO05" : "AO05",
        home ? "HO15" : "AO15",
        "O05",
        "U45",
        "HU15",
        "AU15",
        "HU25",
        "AU25",
        home ? "HAP15" : "AAP15"
      ];
      for (const market of allowed) {
        const gain = p[market] - p[g.winnerTip.market];
        if (options.verifiedOnly && (["HAP15", "AAP15"].includes(market) || !(p[market] * (quoteFor(g, market, now)?.odd || 0) > 1)) || p[market] < (options.minimumProbability || 0) || !Number.isFinite(gain) || gain <= 0 || p[market] > 1 || !quoteFor(g, market, now))
          continue;
        if (!best || gain > best.gain)
          best = {
            day,
            fixture_id: g.fixture.id,
            kickoff: g.fixture.ts,
            market,
            policy_version: POLICY_VERSION,
            gain,
            game: g
          };
      }
    }
    return best ? [best] : [];
  });
}
function decorateDailyMarket(g, plan, now) {
  g = applyPricing(g, now);
  if (!plan || !eligible(g, now) || plan.fixture_id !== g.fixture.id || plan.kickoff !== g.fixture.ts || plan.day !== lisbonDay(g.fixture.ts) || !marketLabel(plan.market, g.fixture) || !quoteFor(g, plan.market, now))
    return g;
  const homeMarkets = ["HX", "HO05", "HO15", "HAP15"], awayMarkets = ["XA", "AO05", "AO15", "AAP15"];
  if (homeMarkets.includes(plan.market) && g.winnerTip.market !== "H" || awayMarkets.includes(plan.market) && g.winnerTip.market !== "A")
    return g;
  const probabilities = marketProbabilities(g.prediction);
  const probability = probabilities[plan.market];
  if (!Number.isFinite(probability) || probability < g.winnerTip.probability || probability > 1)
    return g;
  const o = g.odds?.[plan.market];
  const valid = o && Number.isFinite(o.odd) && o.odd > 1 && Number.isFinite(o.at) && o.at <= now && now - o.at < 6 * HOUR;
  return {
    ...g,
    prediction: { ...g.prediction, probabilities },
    displayTip: {
      minimumMarketOdd: MIN_ODD,
      priceEligible: true,
      market: plan.market,
      label: marketLabel(plan.market, g.fixture),
      probability,
      selectionType: plan.policy_version === "daily-market-v1" ? "daily-draw-protection" : "daily-alternative",
      policyVersion: plan.policy_version,
      provisional: g.winnerTip.provisional,
      sourceUpdatedAt: g.winnerTip.sourceUpdatedAt,
      reliability: null,
      calibrationStatus: "Regra com odd m\xEDnima de 1,25 ainda sem valida\xE7\xE3o hist\xF3rica adequada",
      fairOdd: 1 / probability,
      minimumOdd: Math.ceil(1.03 / probability * 100) / 100,
      odd: valid ? o.odd : null,
      bookmaker: valid ? o.bookmaker : null,
      oddsAt: valid ? o.at : null,
      expectedValue: valid ? probability * o.odd - 1 : null,
      valueStatus: valid ? probability * o.odd > 1 ? "Valor esperado positivo estimado; rentabilidade n\xE3o demonstrada." : "A odd n\xE3o oferece valor esperado positivo segundo o modelo." : "Valor por confirmar: sem odds reais recentes.",
      reason: "Um mercado alternativo por dia, escolhido pelo maior aumento de probabilidade entre os tr\xEAs favoritos. A sele\xE7\xE3o original fica registada.",
      risks: [
        ...g.winnerTip.risks || [],
        "Este mercado pode cobrir mais resultados do que a vit\xF3ria; uma maior taxa de acerto n\xE3o demonstra lucro."
      ]
    }
  };
}
async function readDailyMarkets(db, now) {
  const days = forecastWindow(now).days;
  return (await db.prepare("SELECT * FROM daily_markets WHERE day>=? AND day<=?").bind(days[0], days[2]).all()).results;
}
async function finalizeDailyMarkets(db, now = Date.now()) {
  const rows = await db.prepare(
    "SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150"
  ).bind(now, forecastWindow(now).end).all();
  const { games: storedGames } = publicGames(rows.results, now);
  const games = [];
  for (const original of storedGames) {
    let odds = { ...original.odds };
    const cached = await db.prepare(
      "SELECT data FROM cache WHERE key IN (?,?) ORDER BY CASE WHEN key LIKE 'api:odds-complete%' THEN 0 ELSE 1 END LIMIT 1"
    ).bind(
      "api:odds-complete?fixture=" + original.fixture.id,
      "api:odds?fixture=" + original.fixture.id
    ).first();
    if (cached) {
      try {
        const payload = JSON.parse(cached.data), fresh = parseOdds(
          Array.isArray(payload) ? payload : payload.items || [],
          original.fixture.id,
          now
        );
        if (Object.keys(fresh).length && Math.max(...Object.values(fresh).map((q) => q.at)) >= Math.max(
          0,
          ...Object.values(odds).map(
            (q) => Number.isFinite(q.at) ? q.at : 0
          )
        ))
          odds = fresh;
      } catch {
      }
    }
    games.push(applyPricing({ ...original, odds }, now));
  }
  let plans = await readDailyMarkets(db, now);
  for (const choice of chooseDailyMarkets(games, now)) {
    if (plans.some((p) => p.day === choice.day)) continue;
    const g = decorateDailyMarket(choice.game, choice, now);
    await db.prepare(
      "INSERT OR IGNORE INTO daily_markets(day,fixture_id,kickoff,market,policy_version,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(
      choice.day,
      choice.fixture_id,
      choice.kickoff,
      choice.market,
      POLICY_VERSION,
      now,
      JSON.stringify(g)
    ).run();
  }
  plans = await readDailyMarkets(db, now);
  let annotated = 0;
  for (const g of games) {
    const decorated = decorateDailyMarket(
      g,
      plans.find((p) => p.fixture_id === g.fixture.id),
      now
    );
    const old = rows.results.find(
      (r) => JSON.parse(r.data).fixture.id === g.fixture.id
    ).data;
    if (JSON.stringify(decorated) === old) continue;
    const data = JSON.stringify(decorated), phase = g.phase === "final" ? "final" : "preliminary";
    const version = `${g.prediction.version || "forecast"}@${g.fixture.ts}:${POLICY_VERSION}:${now}`;
    await db.batch([
      db.prepare(
        "INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)"
      ).bind(g.fixture.id, version, phase, now, g.fixture.ts, data),
      db.prepare("UPDATE cache SET data=? WHERE key=? AND data=?").bind(
        data,
        "forecast:" + g.fixture.id,
        rows.results.find(
          (r) => JSON.parse(r.data).fixture.id === g.fixture.id
        ).data
      )
    ]);
    annotated++;
  }
  return { reserved: plans.length, annotated };
}

// src/publication-ranking.js
var MIN_WIN_PROBABILITY = 0.6;
var MIN_ALTERNATIVE_PROBABILITY = 0.7;
var SELECTION_POLICY = "global-favorites-priced-v3";
async function rankPublicationPool(db, candidates, now) {
  const w = forecastWindow(now);
  const saved = await db.prepare(
    "SELECT day,fixture_id,recovered,alternative FROM openfoot_current_picks WHERE day>=? AND day<=?"
  ).bind(w.days[0], w.days[2]).all();
  const supplemental = await db.prepare("SELECT day FROM openfoot_current_alternatives WHERE day>=? AND day<=?").bind(w.days[0], w.days[2]).all();
  const usedAlternativeDays = /* @__PURE__ */ new Set([
    ...saved.results.filter((x) => x.alternative).map((x) => x.day),
    ...supplemental.results.map((x) => x.day)
  ]);
  const alternatives = chooseDailyMarkets(candidates, now, {
    verifiedOnly: true,
    alternativeFirst: true,
    minimumProbability: MIN_ALTERNATIVE_PROBABILITY
  }).filter((x) => !usedAlternativeDays.has(x.day));
  const ids = new Set(saved.results.map((x) => x.fixture_id));
  const selected = new Set(ids);
  for (const day of w.days) {
    const occupied = saved.results.filter(
      (x) => x.day === day && !x.recovered
    ).length;
    const alt = alternatives.find((x) => x.day === day);
    const pool = candidates.filter((g) => lisbonDay(g.fixture.ts) === day && !ids.has(g.fixture.id)).map((g) => {
      const isAlt = alt?.fixture_id === g.fixture.id;
      const known = [g.odds?.[g.winnerTip.market]].filter(Boolean).some(
        (q) => Number.isFinite(q.at) && q.at <= now && now - q.at < 6 * 36e5
      ) || Number.isFinite(g.oddsCheckedAt) && g.oddsCheckedAt <= now && now - g.oddsCheckedAt < 3 * 36e5;
      const win = g.winnerTip.probability >= MIN_WIN_PROBABILITY;
      return {
        g,
        score: isAlt ? g.winnerTip.probability + alt.gain : g.winnerTip.probability,
        eligible: isAlt || win && (g.winnerTip.priceEligible || !known)
      };
    }).filter((x) => x.eligible).sort(
      (a, b) => b.score - a.score || a.g.fixture.ts - b.g.fixture.ts || a.g.fixture.id - b.g.fixture.id
    );
    for (const x of pool.slice(0, Math.max(0, MAX_DAILY_GAMES - occupied)))
      selected.add(x.g.fixture.id);
  }
  return candidates.filter((g) => selected.has(g.fixture.id));
}

// src/public-cache.js
var PUBLIC_GAMES_CACHE = "public:games:v1";
async function cachedPublicGames(env, compute, now = Date.now()) {
  const scope = lisbonDay(now) + ":" + String(env.LEAGUES || "default");
  const saved = await env.DB.prepare(
    "SELECT data,expires FROM cache WHERE key=?"
  ).bind(PUBLIC_GAMES_CACHE).first();
  if (saved?.expires > now) {
    try {
      const payload = JSON.parse(saved.data);
      if (payload.scope === scope && Array.isArray(payload.value?.games))
        return { ...payload.value, window: forecastWindow(now) };
    } catch {
    }
  }
  const value = await compute();
  await env.DB.prepare(
    "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires"
  ).bind(PUBLIC_GAMES_CACHE, JSON.stringify({ scope, value }), now + 6e4).run();
  return value;
}
async function invalidatePublicGames(db) {
  await db.prepare("DELETE FROM cache WHERE key=?").bind(PUBLIC_GAMES_CACHE).run();
}

// src/published-picks.js
async function publishDailyPicks(db,games,now=Date.now()){return (await import("./context/selection.mjs")).publishMarketPicks(db,games,now,{markets:["H","A"]}); }
async function publishedGames(db, now = Date.now()) {
  const w = forecastWindow(now);
  const rows = await db.prepare(
    `SELECT p.*, f.data current_fixture FROM (
        SELECT day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data FROM openfoot_current_picks
        UNION ALL SELECT day,fixture_id,kickoff,market,1,published_at,recorded_at,0,data FROM openfoot_current_alternatives
      ) p LEFT JOIN fixtures f ON f.id=p.fixture_id WHERE p.day>=? AND p.day<=? ORDER BY p.day,p.published_at,p.fixture_id`
  ).bind(w.days[0], w.days[2]).all();
  return rows.results.map((row) => {
    const g = JSON.parse(row.data), current = row.current_fixture ? JSON.parse(row.current_fixture) : g.fixture;
    const tip = g.displayTip || g.winnerTip;
    const finished = current.finished && Number.isInteger(current.hg) && Number.isInteger(current.ag) && current.ts === g.fixture.ts;
    return {
      ...g,
      published: {
        at: row.published_at,
        recordedAt: row.recorded_at,
        recovered: !!row.recovered,
        day: row.day,
        alternative: !!row.alternative
      },
      currentFixture: current,
      result: finished ? {
        home: current.hg,
        away: current.ag,
        hit: outcome(tip.market, current.hg, current.ag)
      } : null
    };
  });
}

// src/selection-review.js
async function cachedFixtureOdds(db, id, now = Date.now()) {
  const row = await db.prepare(
    "SELECT data FROM cache WHERE key IN (?,?) ORDER BY CASE WHEN key LIKE 'api:odds-complete%' THEN 0 ELSE 1 END LIMIT 1"
  ).bind("api:odds-complete?fixture=" + id, "api:odds?fixture=" + id).first();
  if (!row) return {};
  try {
    const p = JSON.parse(row.data);
    return parseOdds(Array.isArray(p) ? p : p.items || [], id, now);
  } catch {
    return {};
  }
}
async function reviewSelections(env, now = Date.now()) {
  const db = env.DB, w = forecastWindow(now);
  const rows = await db.prepare(
    "SELECT c.data,f.data fixture_data FROM fixtures f LEFT JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 250"
  ).bind(now, w.end).all();
  const missingDays = new Set(
    rows.results.filter((r) => !r.data && JSON.parse(r.fixture_data).status === "NS").map((r) => lisbonDay(JSON.parse(r.fixture_data).ts))
  );
  let games = publicGames(
    rows.results.filter((r) => r.data),
    now
  ).games.map((g) => applyPricing(g, now));
  const candidates = games.filter((g) => eligible(g, now)).sort(
    (a, b) => lisbonDay(a.fixture.ts).localeCompare(lisbonDay(b.fixture.ts)) || b.winnerTip.probability - a.winnerTip.probability || a.fixture.ts - b.fixture.ts || a.fixture.id - b.fixture.id
  );
  const checks = [];
  let requests = 0;
  for (const g of candidates) {
    const cached = await cachedFixtureOdds(db, g.fixture.id, now);
    if (Object.keys(cached).length) g.odds = cached;
    const reusable = Object.values(cached).some(
      (q) => Number.isFinite(q.at) && q.at <= now && now - q.at < 6 * 36e5
    );
    try {
      if (!reusable && requests >= 9) continue;
      if (!reusable) requests++;
      const result = reusable ? { odds: cached, refreshFailed: false } : await fixtureOdds(env, g.fixture.id, now);
      if (result.refreshFailed) throw new Error("odds_refresh_failed");
      g.odds = result.odds;
      g.oddsCheckedAt = Date.now();
      const updated = applyPricing(g, Date.now());
      Object.assign(g, updated);
      await db.prepare("UPDATE cache SET data=? WHERE key=?").bind(JSON.stringify(g), "forecast:" + g.fixture.id).run();
      checks.push({ id: g.fixture.id, markets: Object.keys(g.odds).length });
    } catch (e) {
      checks.push({ id: g.fixture.id, code: e.code || "odds_unavailable" });
    }
    games = games.map((x) => x.fixture.id === g.fixture.id ? g : x);
    await publishDailyPicks(
      db,
      games.filter((x) => !missingDays.has(lisbonDay(x.fixture.ts))),
      Date.now()
    );
    const lock = await db.prepare("SELECT until FROM locks WHERE key='api-cooldown'").first();
    if (lock?.until > Date.now()) break;
  }
  await publishDailyPicks(
    db,
    games.filter((x) => !missingDays.has(lisbonDay(x.fixture.ts))),
    Date.now()
  );
  return { checks, waitingDays: [...missingDays] };
}

// index.html
var index_default = "<!doctype html>\n<html lang=\"pt-PT\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />\n    <meta name=\"theme-color\" content=\"#101412\" />\n    <title>LuxTips · Futebol com fundamento</title>\n    <style>\n      :root {\n        color-scheme: dark;\n        --bg: #101512;\n        --panel: #19211b;\n        --line: #2c392e;\n        --text: #edf3ea;\n        --muted: #a9b5aa;\n        --lime: #c8f474;\n        --amber: #f4c77b;\n      }\n      * {\n        box-sizing: border-box;\n      }\n      body {\n        margin: 0;\n        background: var(--bg);\n        color: var(--text);\n        font:\n          15px/1.5 system-ui,\n          sans-serif;\n      }\n      header,\n      main,\n      footer {\n        max-width: 1120px;\n        margin: auto;\n        padding: 20px 24px;\n      }\n      header {\n        display: flex;\n        align-items: center;\n        justify-content: space-between;\n        border-bottom: 1px solid var(--line);\n      }\n      .logo {\n        font-size: 25px;\n        font-weight: 900;\n        letter-spacing: -1.4px;\n      }\n      .logo span {\n        color: var(--lime);\n      }\n      .small,\n      small {\n        color: var(--muted);\n        font-size: 12px;\n      }\n      button,\n      select {\n        font: inherit;\n        color: var(--text);\n        background: var(--panel);\n        border: 1px solid var(--line);\n        padding: 10px 14px;\n        border-radius: 10px;\n        cursor: pointer;\n      }\n      button:hover,\n      button[aria-selected=\"true\"] {\n        border-color: var(--lime);\n        color: var(--lime);\n      }\n      button:focus-visible,\n      select:focus-visible,\n      summary:focus-visible {\n        outline: 2px solid var(--lime);\n        outline-offset: 3px;\n      }\n      h1 {\n        font-size: 27px;\n        line-height: 1.2;\n        letter-spacing: -0.8px;\n        margin: 0 0 6px;\n      }\n      h2 {\n        font-size: 19px;\n        letter-spacing: -0.4px;\n        margin: 0;\n      }\n      h3 {\n        font-size: 16px;\n        margin: 18px 0 10px;\n      }\n      h4 {\n        font-size: 14px;\n        margin: 18px 0 8px;\n      }\n      p {\n        overflow-wrap: anywhere;\n      }\n      .intro {\n        padding: 6px 0 14px;\n      }\n      .intro p {\n        margin: 0;\n        color: var(--muted);\n        font-size: 13px;\n      }\n      .status {\n        max-width: 55%;\n        text-align: right;\n        font-size: 11px;\n        color: var(--muted);\n      }\n      .dot {\n        height: 7px;\n        width: 7px;\n        display: inline-block;\n        background: var(--lime);\n        border-radius: 50%;\n        margin-right: 6px;\n      }\n      .dot.warn {\n        background: var(--amber);\n      }\n      .tabs {\n        display: flex;\n        gap: 6px;\n        margin: 8px 0 24px;\n      }\n      .tabs button {\n        background: transparent;\n        border-color: transparent;\n        padding: 9px 13px;\n      }\n      .tabs button[aria-selected=\"true\"] {\n        background: var(--panel);\n        border-color: var(--line);\n      }\n      .days {\n        display: flex;\n        gap: 6px;\n        margin: 0 0 20px;\n      }\n      .days button {\n        flex: 1;\n        padding: 10px 8px;\n        font-size: 13px;\n      }\n      .days button[aria-selected=\"true\"] {\n        background: #26351f;\n        border-color: var(--lime);\n      }\n      .toolbar {\n        display: flex;\n        align-items: center;\n        justify-content: space-between;\n        gap: 12px;\n        margin-bottom: 16px;\n      }\n      .toolbar select {\n        font-size: 12px;\n        max-width: 50%;\n        padding: 9px 12px;\n      }\n      .grid {\n        display: grid;\n        grid-template-columns: repeat(3, minmax(0, 1fr));\n        gap: 14px;\n        align-items: start;\n      }\n      .card {\n        border: 1px solid var(--line);\n        border-radius: 16px;\n        background: var(--panel);\n        padding: 18px;\n        min-width: 0;\n      }\n      .card.pick {\n        border-top: 2px solid var(--lime);\n      }\n      .fixture-meta {\n        display: flex;\n        justify-content: space-between;\n        gap: 12px;\n        font-size: 11px;\n        color: var(--muted);\n      }\n      .fixture-meta time {\n        white-space: nowrap;\n      }\n      .teams {\n        font-size: 13px;\n        color: var(--muted);\n        margin: 10px 0 0;\n        overflow-wrap: anywhere;\n      }\n      .market {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        gap: 12px;\n        margin-bottom: 12px;\n      }\n      .selection {\n        font-size: 20px;\n        line-height: 1.25;\n        font-weight: 750;\n        letter-spacing: -0.4px;\n      }\n      .prob {\n        text-align: right;\n        font-size: 28px;\n        line-height: 1.1;\n        font-weight: 750;\n        color: var(--lime);\n        letter-spacing: -1px;\n        white-space: nowrap;\n      }\n      .prob small {\n        display: block;\n        font-size: 10px;\n        font-weight: 400;\n        letter-spacing: 0;\n        margin-top: 4px;\n      }\n      .tags {\n        display: flex;\n        gap: 5px;\n        flex-wrap: wrap;\n      }\n      .tag {\n        font-size: 10px;\n        border: 1px solid var(--line);\n        border-radius: 20px;\n        padding: 3px 7px;\n        display: inline-block;\n        color: var(--muted);\n      }\n      .tag.strong {\n        color: var(--lime);\n        background: #24341f;\n        border-color: #405830;\n      }\n      .tag.pending {\n        color: var(--amber);\n        background: #32291d;\n        border-color: #54432c;\n      }\n      .price {\n        display: flex;\n        align-items: center;\n        justify-content: space-between;\n        gap: 8px;\n        margin-top: 15px;\n        padding-top: 12px;\n        border-top: 1px solid var(--line);\n        font-size: 12px;\n        color: var(--muted);\n      }\n      .price b {\n        font-size: 16px;\n        color: var(--text);\n      }\n      .price-note {\n        margin: 7px 0 0;\n        font-size: 11px;\n        color: var(--muted);\n      }\n      .price-note.warn {\n        color: var(--amber);\n      }\n      details {\n        margin-top: 15px;\n        border-top: 1px solid var(--line);\n        padding-top: 12px;\n      }\n      summary {\n        cursor: pointer;\n        font-size: 12px;\n        color: var(--muted);\n      }\n      summary:hover {\n        color: var(--lime);\n      }\n      details[open] > summary {\n        color: var(--lime);\n        margin-bottom: 12px;\n      }\n      .analysis {\n        font-size: 12px;\n        color: var(--muted);\n      }\n      .analysis p {\n        margin: 10px 0;\n      }\n      .analysis h4 {\n        color: var(--text);\n      }\n      .analysis ul {\n        padding-left: 17px;\n      }\n      .stats {\n        display: grid;\n        grid-template-columns: repeat(3, 1fr);\n        gap: 12px;\n        margin: 18px 0;\n      }\n      .stat {\n        padding: 16px;\n        background: var(--panel);\n        border: 1px solid var(--line);\n        border-radius: 12px;\n      }\n      .stat b {\n        display: block;\n        font-size: 24px;\n        color: var(--lime);\n      }\n      .wide {\n        grid-column: 1/-1;\n      }\n      .notice {\n        padding: 12px 16px;\n        border: 1px solid var(--line);\n        border-radius: 10px;\n        color: var(--muted);\n        font-size: 12px;\n        margin: 14px 0;\n      }\n      .empty {\n        padding: 30px 20px;\n        border: 1px dashed var(--line);\n        border-radius: 14px;\n        color: var(--muted);\n        text-align: center;\n      }\n      .empty h3 {\n        color: var(--text);\n        margin-top: 0;\n      }\n      .empty p {\n        font-size: 13px;\n        margin-bottom: 0;\n      }\n      .tablewrap {\n        overflow: auto;\n      }\n      table {\n        border-collapse: collapse;\n        width: 100%;\n        font-size: 12px;\n      }\n      th,\n      td {\n        padding: 10px 8px;\n        border-bottom: 1px solid var(--line);\n        text-align: left;\n        white-space: nowrap;\n      }\n      th {\n        color: var(--muted);\n        font-weight: 500;\n      }\n      .compare td,\n      .compare th {\n        white-space: normal;\n        padding: 8px 5px;\n        font-size: 11px;\n      }\n      .compare th:first-child {\n        width: 30%;\n      }\n      .history-list {\n        display: grid;\n        gap: 10px;\n      }\n      .history-row {\n        border: 1px solid var(--line);\n        border-radius: 12px;\n        padding: 14px 16px;\n        background: var(--panel);\n      }\n      .history-row .result {\n        float: right;\n        font-weight: 650;\n        color: var(--lime);\n      }\n      .history-row .result.loss {\n        color: var(--amber);\n      }\n      footer {\n        border-top: 1px solid var(--line);\n        color: var(--muted);\n        font-size: 11px;\n        margin-top: 30px;\n      }\n      .error {\n        color: #ffbda9;\n      }\n      .hidden {\n        display: none !important;\n      }\n      .section-note {\n        margin: 7px 0 18px;\n      }\n      .other-picks {\n        margin-top: 10px;\n      }\n      .other-picks > summary {\n        font-size: 13px;\n      }\n      .count {\n        color: var(--muted);\n        font-size: 12px;\n        font-weight: 400;\n        margin-left: 7px;\n      }\n      @media (max-width: 950px) {\n        .grid {\n          grid-template-columns: repeat(2, minmax(0, 1fr));\n        }\n      }\n      @media (max-width: 620px) {\n        header,\n        main,\n        footer {\n          padding: 16px;\n        }\n        .logo {\n          font-size: 24px;\n        }\n        header {\n          padding-top: 14px;\n          padding-bottom: 14px;\n        }\n        h1 {\n          font-size: 24px;\n        }\n        .tabs {\n          margin: 8px 0 20px;\n        }\n        .tabs button {\n          flex: 1;\n          font-size: 12px;\n          padding: 9px 7px;\n        }\n        .grid {\n          grid-template-columns: 1fr;\n        }\n        .days {\n          gap: 5px;\n        }\n        .days button {\n          font-size: 12px;\n          padding: 10px 5px;\n        }\n        .card {\n          padding: 17px;\n        }\n        .toolbar {\n          align-items: center;\n        }\n        .toolbar select {\n          max-width: 48%;\n        }\n        .status {\n          font-size: 10px;\n        }\n        .stats {\n          gap: 7px;\n        }\n        .stat {\n          padding: 11px;\n        }\n        .stat b {\n          font-size: 21px;\n        }\n        .stat small {\n          font-size: 10px;\n        }\n        .selection {\n          font-size: 21px;\n        }\n        .prob {\n          font-size: 30px;\n        }\n      }\n    </style>\n  </head>\n  <body>\n    <header>\n      <div class=\"logo\">LUX<span>TIPS</span></div>\n      <div class=\"status\" id=\"status\" aria-live=\"polite\">A atualizar…</div>\n    </header>\n    <main>\n      <section class=\"intro\">\n        <h1>Quem tem mais hipóteses de vencer?</h1>\n        <p>Vitórias casa ou fora · análise e recomendações separadas · odds ≥ 1,25.</p>\n      </section>\n      <nav class=\"tabs\" aria-label=\"Secções\">\n        <button data-tab=\"games\" aria-selected=\"true\">Prognósticos</button\n        ><button data-tab=\"history\" aria-selected=\"false\">Histórico</button\n        ><button data-tab=\"validation\" aria-selected=\"false\">Desempenho</button>\n      </nav>\n      <section id=\"games\">\n        <nav id=\"dayNav\" class=\"days\" aria-label=\"Dia dos prognósticos\"></nav>\n        <div class=\"toolbar\">\n          <h2 id=\"dayTitle\">Hoje</h2>\n          <select id=\"league\" aria-label=\"Filtrar competição\">\n            <option value=\"\">Todas as ligas</option>\n          </select>\n        </div>\n        <div id=\"best\"></div>\n        <div id=\"cards\" class=\"grid\">\n          <div class=\"empty wide\">A carregar os prognósticos…</div>\n        </div>\n      </section>\n      <section id=\"history\" class=\"hidden\">\n        <h2>Previsões que ficam registadas</h2>\n        <p class=\"small\">\n          Seleções efetivamente publicadas, preservadas com a odd registada. Os resultados não alteram o prognóstico original.\n        </p>\n        <div id=\"historyBody\">A carregar…</div>\n      </section>\n      <section id=\"validation\" class=\"hidden\">\n        <h2>Avaliação do modelo</h2>\n        <div id=\"validationBody\">A carregar…</div>\n      </section>\n    </main>\n    <footer>\n      LuxTips · API-Football + OpenFootAPI. Prognósticos probabilísticos, sem garantia de\n      acerto.\n    </footer>\n    <script>\n      const API =\n        location.hostname === \"luxtips.90carlosmachado.workers.dev\"\n          ? \"\"\n          : \"https://luxtips.90carlosmachado.workers.dev\";\n      const $ = (s) => document.querySelector(s),\n        esc = (s) =>\n          String(s ?? \"\").replace(\n            /[&<>\"']/g,\n            (c) =>\n              ({\n                \"&\": \"&amp;\",\n                \"<\": \"&lt;\",\n                \">\": \"&gt;\",\n                '\"': \"&quot;\",\n                \"'\": \"&#39;\",\n              })[c],\n          ),\n        pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + \"%\" : \"—\"),\n        date = (t) =>\n          new Date(t).toLocaleString(\"pt-PT\", {\n            timeZone: \"Europe/Lisbon\",\n            day: \"2-digit\",\n            month: \"short\",\n            hour: \"2-digit\",\n            minute: \"2-digit\",\n          });\n      const labels = {\n        O05: \"Mais de 0,5\",\n        U45: \"Menos de 4,5\",\n        HU15: \"Casa menos de 2\",\n        AU15: \"Fora menos de 2\",\n        HU25: \"Casa menos de 3\",\n        AU25: \"Fora menos de 3\",\n        HAP15: \"Casa handicap +1,5\",\n        AAP15: \"Fora handicap +1,5\",\n        HO05: \"Casa marca 1+\",\n        AO05: \"Fora marca 1+\",\n        HO15: \"Casa marca 2+\",\n        AO15: \"Fora marca 2+\",\n        H: \"Casa\",\n        D: \"Empate\",\n        A: \"Fora\",\n        HX: \"Casa ou empate\",\n        XA: \"Empate ou fora\",\n        HA: \"Sem empate\",\n        O15: \"Mais 1,5\",\n        U15: \"Menos 1,5\",\n        O25: \"Mais 2,5\",\n        U25: \"Menos 2,5\",\n        O35: \"Mais 3,5\",\n        U35: \"Menos 3,5\",\n        BY: \"Ambas marcam\",\n        BN: \"Ambas não marcam\",\n      };\n      let games = [],\n        importsPending = 0,\n        loaded = {};\n      async function get(path) {\n        const r = await fetch(API + path);\n        if (!r.ok)\n          throw new Error(\n            \"Não foi possível obter os dados. Tente novamente mais tarde.\",\n          );\n        return r.json();\n      }\n      function card(g) {\n        const f = g.fixture,\n          r = g.displayTip || g.winnerTip;\n        const hour = new Date(f.ts).toLocaleTimeString(\"pt-PT\", {\n          timeZone: \"Europe/Lisbon\",\n          hour: \"2-digit\",\n          minute: \"2-digit\",\n        });\n        return `<article class=\"card pick\" data-fixture=\"${f.id}\">\n          <div class=\"fixture-meta\"><span>${esc(f.competition)}</span><time>${hour}</time></div>\n          ${g.published?.alternative ? '<p class=\"small\">Mercado alternativo</p>' : \"\"}\n          <h3 class=\"selection\">${esc(pickLabel(g))}</h3>\n          <p class=\"small\">${g.published ? \"Odd registada\" : \"Odd\"} ${Number(r.odd).toFixed(2).replace(\".\", \",\")} · ${esc(r.bookmaker || \"\")}</p>\n          <p class=\"teams\">${esc(f.homeName)} · ${esc(f.awayName)}</p>\n          <p class=\"small\">${g.result ? `Terminado · ${g.result.home}–${g.result.away} · ${g.result.hit === 1 ? \"Certo\" : \"Errado\"}` : [\"CANC\", \"PST\", \"ABD\"].includes(g.currentFixture?.status) ? \"Adiado ou cancelado · seleção original mantida\" : f.ts <= Date.now() ? (g.currentFixture?.status === \"NS\" ? \"Hora prevista ultrapassada · atualização pendente\" : \"Em jogo · seleção original mantida\") : \"Por disputar\"}</p>\n          ${r.provisional || g.stale ? '<span class=\"small pending\">Provisório · fonte em atraso</span>' : \"\"}\n        </article>`;\n      }\n      function pickLabel(g) {\n        const selection = g.displayTip || g.winnerTip || g.recommendation;\n        const k = selection?.market;\n        return k === \"H\"\n          ? `${g.fixture.homeName} vence`\n          : k === \"A\"\n            ? `${g.fixture.awayName} vence`\n            : selection?.label;\n      }\n      const localDay = (ts) =>\n        new Date(ts).toLocaleDateString(\"sv-SE\", { timeZone: \"Europe/Lisbon\" });\n      function dayKeys(now = Date.now()) {\n        const first = localDay(now),\n          base = Date.parse(first + \"T12:00:00Z\");\n        return [0, 1, 2].map((i) =>\n          new Date(base + i * 86400000).toISOString().slice(0, 10),\n        );\n      }\n      let analysisByDay = {};\n      let winnerAnalyses = [];\n      let chosenDay = localDay(Date.now());\n      function winnerCard(g) {\n        const a=g.winnerAnalysis,q=a.quote,f=g.fixture;\n        const percentage=p=>Number.isFinite(p)?(100*p).toFixed(1)+'%':'Indisponível';\n        const stamp=t=>new Date(t).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});\n        const stale=!!q&&(a.quoteStatus==='quote_expired'||a.quoteStatus==='awaiting_recalculation'||Date.now()-q.at>=6*3600000);\n        const awaiting=!q||stale;\n        const value=awaiting?'A aguardar atualização da odd':a.value.eligible?'Candidata com valor estimado':'Sem recomendação de aposta';\n        const reason=awaiting?'A análise mantém-se visível; sem uma odd recente não há recomendação nem valor esperado atual.':a.value.reason==='insufficient_probability'?'O modelo não atinge 60%.':a.value.reason==='insufficient_expected_return'?'A odd não compensa a estimativa e a reserva do modelo.':'Critérios de valor avaliados separadamente da probabilidade.';\n        return '<article class=\"card\"><div class=\"fixture-meta\"><span>'+esc(f.competition||'')+'</span><time>'+esc(stamp(f.ts))+'</time></div><p class=\"teams\">'+esc(f.homeName)+' · '+esc(f.awayName)+'</p><h3>'+esc(a.label)+'</h3><p>Modelo <strong>'+percentage(a.modelProbability)+'</strong><br>Mercado sem margem <strong>'+percentage(a.marketProbability)+'</strong></p><span class=\"tag\">'+esc(a.basis==='market-reference'?'Favorito do mercado':'Favorito do modelo')+'</span><p class=\"price\"><span>Odd registada · '+esc(q?.bookmaker||'A aguardar cotação')+'</span><b>'+(q?q.odd.toFixed(2):'—')+'</b></p><p class=\"small\">'+(q?'Cotação '+esc(stamp(q.at))+' · Lisboa':'Sem cotação verificada')+'</p>'+(stale?'<p class=\"price-note warn\">Odd desatualizada — a aguardar atualização</p>':'')+'<details><summary>'+value+'</summary><p>'+esc(reason)+'</p><p>Retorno esperado após reserva: '+(!awaiting&&Number.isFinite(a.value.expectedReturn)?(100*a.value.expectedReturn).toFixed(1)+'%':'Indisponível')+'</p>'+(a.value.minimumOdd?'<p>Odd mínima segundo o modelo: '+(Math.ceil(a.value.minimumOdd*100)/100).toFixed(2)+'</p>':'')+'<p class=\"small\">'+esc(a.note)+(a.disagreement?' Modelo e mercado discordam sobre o favorito.':'')+'</p></details></article>';\n      }\n      function render() {\n        const now=Date.now(),days=dayKeys(now),league=Number($('#league').value);\n        if(!days.includes(chosenDay))chosenDay=days[0];\n        const names=['Hoje','Amanhã','Depois de amanhã'];\n        $('#dayNav').innerHTML=days.map((day,i)=>'<button data-day=\"'+day+'\" aria-selected=\"'+(chosenDay===day)+'\">'+names[i]+'</button>').join('');\n        const onDay=g=>localDay(g.fixture.ts)===chosenDay&&(!league||g.fixture.league===league);\n        const picks=games.filter(g=>onDay(g)&&g.published&&['H','A'].includes((g.displayTip||g.winnerTip)?.market));\n        const publishedIds=new Set(picks.map(g=>g.fixture.id));\n        const analyses=winnerAnalyses.filter(g=>onDay(g)&&g.fixture.ts>now&&!publishedIds.has(g.fixture.id));\n        $('#dayTitle').textContent=names[days.indexOf(chosenDay)];\n        $('#best').innerHTML='<h3>Recomendações de vitória</h3><p class=\"small\">'+(picks.length?picks.length+' seleções publicadas.':'Sem recomendações de vitória que cumpram todos os critérios neste momento.')+'</p>';\n        const empty=analysisByDay[chosenDay]?.updating?'<div class=\"empty wide\"><h3>Análise em atualização</h3><p>A recolher os dados disponíveis para este dia.</p></div>':'<div class=\"empty wide\"><h3>Análise concluída</h3><p>Sem vitórias prováveis com dados suficientes neste momento.</p></div>';\n        $('#cards').innerHTML=picks.map(card).join('')+'<div class=\"wide\"><h3>Vitórias mais prováveis</h3><p class=\"small\">Análise informativa. Uma equipa favorita pode não oferecer uma aposta com valor.</p></div>'+(analyses.length?analyses.map(winnerCard).join(''):empty);\n      }\n      async function loadGames() {\n        try {\n          const results = await Promise.allSettled([\n            get(\"/api/games\"),\n            get(\"/api/health\"),\n          ]);\n          if (results[0].status !== \"fulfilled\") throw results[0].reason;\n          const d = results[0].value,\n            h = results[1].status === \"fulfilled\" ? results[1].value : null;\n          if (!Array.isArray(d.games))\n            throw new Error(\"Dados temporariamente indisponíveis.\");\n          games = d.games;\n          winnerAnalyses = d.winnerAnalyses || [];\n          importsPending = d.imports?.pending || 0;\n          analysisByDay = d.analysis?.days || {};\n          const selectedLeague = $(\"#league\").value;\n          $(\"#league\").innerHTML = '<option value=\"\">Todas as ligas</option>';\n          for (const [id, name] of new Map([\n            ...(d.competitions || []).map((c) => [c.id, c.name]),\n            ...games.map((g) => [g.fixture.league, g.fixture.competition]),\n          ])) {\n            const o = document.createElement(\"option\");\n            o.value = id;\n            o.textContent = name;\n            $(\"#league\").append(o);\n          }\n          $(\"#league\").value = [...$(\"#league\").options].some(\n            (o) => o.value === selectedLeague,\n          )\n            ? selectedLeague\n            : \"\";\n          // Published predictions are immutable. Their timestamp is not a sync clock.\n          const syncAt = h?.sync?.at;\n          const validSync =\n            Number.isFinite(syncAt) && syncAt > 0 && syncAt <= Date.now();\n          const stamp = validSync\n            ? new Date(syncAt).toLocaleString(\"pt-PT\", {\n                timeZone: \"Europe/Lisbon\",\n                day: \"2-digit\",\n                month: \"2-digit\",\n                hour: \"2-digit\",\n                minute: \"2-digit\",\n              })\n            : null;\n          const warn = !h?.ready;\n          const statusNote = !validSync\n            ? \"A aguardar a primeira sincronização\"\n            : !h?.sync?.ok\n              ? \"A última tentativa falhou\"\n              : Date.now() - syncAt > 3600000\n                ? \"Atualização automática em atraso\"\n                : warn\n                  ? \"Atualização parcial · alguns dados em atraso\"\n                  : \"Análise automática · página atualizada a cada 5 min\";\n          $(\"#status\").innerHTML =\n            `<span class=\"dot ${warn ? \"warn\" : \"\"}\"></span>${stamp ? \"Última sincronização: \" + stamp + \" · Lisboa<br>\" : \"\"}${statusNote}`;\n          render();\n        } catch (e) {\n          $(\"#status\").textContent = \"Sem atualização · a tentar novamente\";\n          if (games.length) render();\n          else {\n            $(\"#best\").innerHTML = \"\";\n            $(\"#cards\").innerHTML =\n              `<div class=\"empty wide error\">Dados temporariamente indisponíveis. A tentar novamente.</div>`;\n          }\n        }\n      }\n      async function history() {\n        const d = await get('/api/history');\n        const selections = d.publishedSelections || [];\n        $('#historyBody').innerHTML = selections.length ? '<div class=\"history-list\">' + selections.map(f => {\n          const pick=f.displayTip || f.winnerTip || f.recommendation;\n          if(!pick)return '';\n          const hit=f.displayTip ? f.displayHit : f.winnerTip ? f.winnerHit : f.hit;\n          return '<article class=\"history-row\"><span class=\"result '+(hit?'':'loss')+'\">'+(hit?'Certo':'Errado')+'</span><strong>'+esc(pick.label)+'</strong><div class=\"small\">'+esc(f.fixture.homeName)+' · '+esc(f.fixture.awayName)+'<br>'+date(f.fixture.ts)+' · Resultado '+f.result.home+'–'+f.result.away+' · '+(f.prediction?.version===d.activeModel?'Modelo atual':'Modelo anterior')+'</div></article>';\n        }).join('')+'</div>' : '<p class=\"small\">Ainda não há seleções publicadas com resultado confirmado.</p>';\n      }\n      async function validation() {\n        await get('/api/validation');\n        $('#validationBody').innerHTML = '<p>A avaliação do modelo atual está em curso. Os resultados de versões anteriores não demonstram a precisão desta versão.</p><p class=\"small\">Até três recomendações de vitória por dia, uma por jogo. A análise dos favoritos não equivale a uma recomendação. Odds registadas de pelo menos 1,25. Nenhuma seleção é publicada para preencher vagas.</p>';\n      }\n      $(\"#league\").addEventListener(\"change\", render);\n      $(\"#dayNav\").addEventListener(\"click\", (e) => {\n        const b = e.target.closest(\"[data-day]\");\n        if (b) {\n          chosenDay = b.dataset.day;\n          render();\n        }\n      });\n      setInterval(render, 60000);\n      setInterval(loadGames, 300000);\n      document.addEventListener(\"visibilitychange\", () => {\n        if (document.visibilityState === \"visible\") loadGames();\n      });\n      document.querySelectorAll(\"[data-tab]\").forEach((b) =>\n        b.addEventListener(\"click\", async () => {\n          document\n            .querySelectorAll(\"[data-tab]\")\n            .forEach((x) => x.setAttribute(\"aria-selected\", String(x === b)));\n          for (const id of [\"games\", \"history\", \"validation\"])\n            $(\"#\" + id).classList.toggle(\"hidden\", id !== b.dataset.tab);\n          const name = b.dataset.tab;\n          if (!loaded[name] && name !== \"games\") {\n            try {\n              await (name === \"history\" ? history() : validation());\n              loaded[name] = true;\n            } catch (e) {\n              $(\"#\" + name + \"Body\").innerHTML =\n                `<p class=\"error\">Dados temporariamente indisponíveis. A tentar novamente.</p>`;\n            }\n          }\n        }),\n      );\n      loadGames();\n    </script>\n  </body>\n</html>\n";

// src/winner-config.json
var winner_config_default = {
  version: "winner-multiscale-v1",
  status: "retrospective-evidence-awaiting-prospective-confirmation",
  components: [
    {
      halfLife: 180,
      prior: 8,
      weight: 0.23402670885449198
    },
    {
      halfLife: 365,
      prior: 8,
      weight: 0.765973291145508
    }
  ],
  trainedBefore: 17860608e5,
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477"
};

// src/forecast.js
var VERSION2 = winner_config_default.version;
function fit2(history, cutoff) {
  return winner_config_default.components.map((c) => ({
    weight: c.weight,
    state: fit(history, cutoff, c)
  }));
}
function predict2(states, fixture) {
  const components = states.map((c) => ({
    weight: c.weight,
    prediction: predict(c.state, fixture)
  }));
  const base = components[0].prediction;
  const probabilities = Object.fromEntries(
    Object.keys(base.probabilities).map((k) => [
      k,
      components.reduce(
        (s, c) => s + c.weight * c.prediction.probabilities[k],
        0
      )
    ])
  );
  const goals = components.map((c) => ({
    weight: c.weight,
    homeGoals: c.prediction.homeGoals,
    awayGoals: c.prediction.awayGoals
  }));
  return {
    ...base,
    version: VERSION2,
    baselineProbabilities: base.probabilities,
    probabilities: { ...probabilities, ...extraGoalMarkets(goals) },
    homeGoals: goals.reduce((s, c) => s + c.weight * c.homeGoals, 0),
    awayGoals: goals.reduce((s, c) => s + c.weight * c.awayGoals, 0),
    luxg: mixtureProjection(goals),
    components: goals,
    modelEvidence: winner_config_default.status,
    risks: [
      ...new Set(components.flatMap((c) => c.prediction.risks)),
      "Combina\xE7\xE3o validada retrospetivamente; melhoria futura ainda por confirmar."
    ]
  };
}

// src/winner-multiscale-research.json
var winner_multiscale_research_default = {
  version: "winner-multiscale-v1",
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477",
  options: [
    {
      halfLife: 90,
      prior: 8
    },
    {
      halfLife: 180,
      prior: 8
    },
    {
      halfLife: 365,
      prior: 8
    },
    {
      halfLife: 180,
      prior: 16
    }
  ],
  protocol: {
    version: "winner-multiscale-v1",
    dataStatus: "Retrospective development extension after the direct-winner result; all seasons already observed. Not a fresh independent test.",
    models: [
      {
        halfLife: 90,
        prior: 8
      },
      {
        halfLife: 180,
        prior: 8
      },
      {
        halfLife: 365,
        prior: 8
      },
      {
        halfLife: 180,
        prior: 16
      }
    ],
    pool: "Nonnegative weights summing to one, fit to 1X2 log loss with quadratic shrinkage toward existing baseline weights [0,1,0,0]",
    ridge: [
      1e-3,
      0.01,
      0.1
    ],
    selection: "Prior season log loss including baseline; train before selection season, choose ridge, refit all past seasons, then score next season. Outer folds 2025 and 2026.",
    promotion: "Same as winner-direct-v1: positive log-loss improvement in both folds and pooled week-bootstrap95 lower bound >0, Brier and top-three hit rate no worse.",
    restrictions: "Stop this research batch after these fixed mixtures. Any change remains subject to future prospective confirmation. No parameter changes after reading output."
  },
  folds: [
    {
      season: 2025,
      selected: "pool-0.001",
      weights: [
        0,
        0.2932976509678343,
        0.7067023490321657,
        0
      ],
      candidates: [
        {
          id: "baseline",
          ridge: null,
          weights: [
            0,
            1,
            0,
            0
          ],
          development: {
            n: 1804,
            logLoss: 0.9850592415697951,
            brier: 0.5869745408405983,
            accuracy: 0.5227272727272727,
            ece: 0.021254499608178906
          }
        },
        {
          id: "pool-0.001",
          ridge: 1e-3,
          weights: [
            0,
            0.34811437381301846,
            0.6518856261869815,
            0
          ],
          development: {
            n: 1804,
            logLoss: 0.9836456333502885,
            brier: 0.5862060244025561,
            accuracy: 0.5221729490022173,
            ece: 0.01984713729549112
          }
        },
        {
          id: "pool-0.01",
          ridge: 0.01,
          weights: [
            0,
            0.9163390606522805,
            0.08366093934771947,
            0
          ],
          development: {
            n: 1804,
            logLoss: 0.9848366736764766,
            brier: 0.5868444226943439,
            accuracy: 0.5227272727272727,
            ece: 0.02510168255768024
          }
        },
        {
          id: "pool-0.1",
          ridge: 0.1,
          weights: [
            14398507179421514e-34,
            0.9913928842877575,
            0.00860711571224254,
            0
          ],
          development: {
            n: 1804,
            logLoss: 0.9850357867130505,
            brier: 0.5869607262574139,
            accuracy: 0.5227272727272727,
            ece: 0.02124048555514435
          }
        }
      ],
      baseline: {
        n: 1835,
        logLoss: 0.9902466943049921,
        brier: 0.5899380614631244,
        accuracy: 0.5313351498637602,
        ece: 0.024721877029732088
      },
      candidate: {
        n: 1835,
        logLoss: 0.9880896306159017,
        brier: 0.5884089965537042,
        accuracy: 0.5302452316076294,
        ece: 0.024206505513748682
      },
      baselineTips: {
        n: 389,
        wins: 277,
        hitRate: 0.712082262210797,
        meanProbability: 0.6539906232769354
      },
      candidateTips: {
        n: 388,
        wins: 280,
        hitRate: 0.7216494845360825,
        meanProbability: 0.6604189226719738
      }
    },
    {
      season: 2026,
      selected: "pool-0.001",
      weights: [
        17847754911202507e-34,
        0.23402670885449195,
        0.7659732911455079,
        0
      ],
      candidates: [
        {
          id: "baseline",
          ridge: null,
          weights: [
            0,
            1,
            0,
            0
          ],
          development: {
            n: 1835,
            logLoss: 0.9902466943049921,
            brier: 0.5899380614631244,
            accuracy: 0.5313351498637602,
            ece: 0.024721877029732088
          }
        },
        {
          id: "pool-0.001",
          ridge: 1e-3,
          weights: [
            0,
            0.2932976509678343,
            0.7067023490321657,
            0
          ],
          development: {
            n: 1835,
            logLoss: 0.9880896306159017,
            brier: 0.5884089965537042,
            accuracy: 0.5302452316076294,
            ece: 0.024206505513748682
          }
        },
        {
          id: "pool-0.01",
          ridge: 0.01,
          weights: [
            0,
            0.8899863468307885,
            0.11001365316921155,
            0
          ],
          development: {
            n: 1835,
            logLoss: 0.9898150479176249,
            brier: 0.589630091352671,
            accuracy: 0.5291553133514987,
            ece: 0.022215230619279547
          }
        },
        {
          id: "pool-0.1",
          ridge: 0.1,
          weights: [
            17952029932046512e-34,
            0.9883562959409616,
            0.011643704059038367,
            0
          ],
          development: {
            n: 1835,
            logLoss: 0.9901993290105828,
            brier: 0.589904245989085,
            accuracy: 0.5318801089918256,
            ece: 0.025213383767810748
          }
        }
      ],
      baseline: {
        n: 285,
        logLoss: 0.9720562948419895,
        brier: 0.577091731441316,
        accuracy: 0.5263157894736842,
        ece: 0.04568365735869852
      },
      candidate: {
        n: 285,
        logLoss: 0.9685377789835722,
        brier: 0.5747933932196762,
        accuracy: 0.543859649122807,
        ece: 0.048634126571442685
      },
      baselineTips: {
        n: 75,
        wins: 57,
        hitRate: 0.76,
        meanProbability: 0.6287705239264451
      },
      candidateTips: {
        n: 71,
        wins: 55,
        hitRate: 0.7746478873239436,
        meanProbability: 0.6451793334320284
      }
    }
  ],
  pooled: {
    baseline: {
      n: 2120,
      logLoss: 0.987801286830013,
      brier: 0.5882110784177398,
      accuracy: 0.5306603773584906,
      ece: 0.02505405414651265
    },
    candidate: {
      n: 2120,
      logLoss: 0.9854611977313668,
      brier: 0.5865785970488938,
      accuracy: 0.5320754716981132,
      ece: 0.023245919210422166
    },
    baselineTips: {
      n: 464,
      wins: 334,
      hitRate: 0.7198275862068966,
      meanProbability: 0.6499140985974379
    },
    candidateTips: {
      n: 459,
      wins: 335,
      hitRate: 0.7298474945533769,
      meanProbability: 0.6580616005891065
    },
    logLossImprovement: 0.0023400890986462475,
    weekBootstrap95: [
      507264044838245e-18,
      0.0041557017119699625
    ],
    weeks: 48
  },
  promoted: true,
  calibration: {
    markets: {
      H: {
        enabled: true,
        bins: [
          {
            low: 0,
            high: 0.1,
            n: 16,
            rate: 0.0625,
            mean: 0.08495567257682524,
            interval: [
              0.01111934476464252,
              0.28328737570298945
            ]
          },
          {
            low: 0.1,
            high: 0.2,
            n: 119,
            rate: 0.12605042016806722,
            mean: 0.16124256441989304,
            interval: [
              0.07789721130352727,
              0.19759169240683083
            ]
          },
          {
            low: 0.2,
            high: 0.3,
            n: 297,
            rate: 0.2222222222222222,
            mean: 0.24859342661116465,
            interval: [
              0.17865679566598575,
              0.2728815639510562
            ]
          },
          {
            low: 0.3,
            high: 0.4,
            n: 491,
            rate: 0.3380855397148676,
            mean: 0.35380490249406515,
            interval: [
              0.2976433836816181,
              0.381041582652996
            ]
          },
          {
            low: 0.4,
            high: 0.5,
            n: 522,
            rate: 0.4444444444444444,
            mean: 0.44745154322357156,
            interval: [
              0.4023772918557579,
              0.48732330320558104
            ]
          },
          {
            low: 0.5,
            high: 0.6,
            n: 356,
            rate: 0.547752808988764,
            mean: 0.5477199527901754,
            interval: [
              0.49581568605225484,
              0.5986703693106483
            ]
          },
          {
            low: 0.6,
            high: 0.7,
            n: 197,
            rate: 0.7258883248730964,
            mean: 0.6401253005017938,
            interval: [
              0.6597259354591424,
              0.7834096627514683
            ]
          },
          {
            low: 0.7,
            high: 0.8,
            n: 91,
            rate: 0.8351648351648352,
            mean: 0.7458310319499203,
            interval: [
              0.7456929440655073,
              0.8974856906634852
            ]
          },
          {
            low: 0.8,
            high: 0.9,
            n: 30,
            rate: 0.8333333333333334,
            mean: 0.836343901830835,
            interval: [
              0.6643564949358398,
              0.9266345762815145
            ]
          },
          {
            low: 0.9,
            high: 1,
            n: 1,
            rate: 1,
            mean: 0.9123837814607418,
            interval: [
              0.20654931437723745,
              1
            ]
          }
        ],
        byLeague: {
          "39": {
            enabled: true
          },
          "61": {
            enabled: true
          },
          "78": {
            enabled: true
          },
          "94": {
            enabled: true
          },
          "135": {
            enabled: true
          },
          "140": {
            enabled: true
          }
        }
      },
      A: {
        enabled: true,
        bins: [
          {
            low: 0,
            high: 0.1,
            n: 84,
            rate: 0.03571428571428571,
            mean: 0.0746530215407658,
            interval: [
              0.012219669231335377,
              0.0998169357251345
            ]
          },
          {
            low: 0.1,
            high: 0.2,
            n: 332,
            rate: 0.11746987951807229,
            mean: 0.15864262565275714,
            interval: [
              0.08713280508196794,
              0.15655795039557216
            ]
          },
          {
            low: 0.2,
            high: 0.3,
            n: 579,
            rate: 0.23834196891191708,
            mean: 0.25372561828044604,
            interval: [
              0.20543336479735932,
              0.27469970498617646
            ]
          },
          {
            low: 0.3,
            high: 0.4,
            n: 538,
            rate: 0.30297397769516726,
            mean: 0.3465481698030152,
            interval: [
              0.2656520158450726,
              0.3430896251851039
            ]
          },
          {
            low: 0.4,
            high: 0.5,
            n: 297,
            rate: 0.45454545454545453,
            mean: 0.4480236879104951,
            interval: [
              0.3988567234819962,
              0.5113950080917016
            ]
          },
          {
            low: 0.5,
            high: 0.6,
            n: 197,
            rate: 0.5786802030456852,
            mean: 0.5450946688995223,
            interval: [
              0.5088703653973246,
              0.6454802362265959
            ]
          },
          {
            low: 0.6,
            high: 0.7,
            n: 64,
            rate: 0.703125,
            mean: 0.6423980792897889,
            interval: [
              0.5822979889645707,
              0.8009484867446022
            ]
          },
          {
            low: 0.7,
            high: 0.8,
            n: 26,
            rate: 0.7692307692307693,
            mean: 0.7419172930789688,
            interval: [
              0.5794844592105632,
              0.8896615059421671
            ]
          },
          {
            low: 0.8,
            high: 0.9,
            n: 3,
            rate: 0.6666666666666666,
            mean: 0.8212647478932672,
            interval: [
              0.2076596008020477,
              0.9385080552796037
            ]
          },
          {
            low: 0.9,
            high: 1,
            n: 0,
            rate: 0,
            mean: 0,
            interval: [
              0,
              1
            ]
          }
        ],
        byLeague: {
          "39": {
            enabled: true
          },
          "61": {
            enabled: true
          },
          "78": {
            enabled: true
          },
          "94": {
            enabled: true
          },
          "135": {
            enabled: true
          },
          "140": {
            enabled: true
          }
        }
      }
    }
  },
  byLeague: {
    "39": {
      baseline: {
        n: 386,
        logLoss: 1.0412442353102158,
        brier: 0.625760382569543,
        accuracy: 0.47150259067357514,
        ece: 0.029040667613967827
      },
      candidate: {
        n: 386,
        logLoss: 1.0396580771758943,
        brier: 0.62437403375372,
        accuracy: 0.4637305699481865,
        ece: 0.04113213539426025
      }
    },
    "61": {
      baseline: {
        n: 313,
        logLoss: 1.007006179677805,
        brier: 0.6032377266136606,
        accuracy: 0.5079872204472844,
        ece: 0.06781293185517828
      },
      candidate: {
        n: 313,
        logLoss: 1.0053415730376776,
        brier: 0.6020827550204856,
        accuracy: 0.5239616613418531,
        ece: 0.04296466535759516
      }
    },
    "78": {
      baseline: {
        n: 313,
        logLoss: 0.9699411083143029,
        brier: 0.5734061580957704,
        accuracy: 0.5654952076677316,
        ece: 0.05103869018619631
      },
      candidate: {
        n: 313,
        logLoss: 0.9667004916637275,
        brier: 0.5713458189191924,
        accuracy: 0.5718849840255591,
        ece: 0.05558574001876939
      }
    },
    "94": {
      baseline: {
        n: 330,
        logLoss: 0.9385823268176711,
        brier: 0.5563042715508505,
        accuracy: 0.5696969696969697,
        ece: 0.040645614484367404
      },
      candidate: {
        n: 330,
        logLoss: 0.9366176906261126,
        brier: 0.5551721221516873,
        accuracy: 0.5606060606060606,
        ece: 0.032086693444541924
      }
    },
    "135": {
      baseline: {
        n: 385,
        logLoss: 0.9815021630274169,
        brier: 0.5833759070139082,
        accuracy: 0.5428571428571428,
        ece: 0.05151032702629682
      },
      candidate: {
        n: 385,
        logLoss: 0.9798031399193137,
        brier: 0.5823257124278368,
        accuracy: 0.5506493506493506,
        ece: 0.052597886549169345
      }
    },
    "140": {
      baseline: {
        n: 393,
        logLoss: 0.9817390623230731,
        brier: 0.5826827197139378,
        accuracy: 0.5343511450381679,
        ece: 0.07121946613549662
      },
      candidate: {
        n: 393,
        logLoss: 0.9778944233422638,
        brier: 0.5797783854372156,
        accuracy: 0.5318066157760815,
        ece: 0.055406393121149505
      }
    }
  },
  configuration: {
    version: "winner-multiscale-v1",
    status: "retrospective-evidence-awaiting-prospective-confirmation",
    components: [
      {
        halfLife: 180,
        prior: 8,
        weight: 0.23402670885449198
      },
      {
        halfLife: 365,
        prior: 8,
        weight: 0.765973291145508
      }
    ],
    trainedBefore: 17860608e5,
    datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477"
  },
  limitations: [
    "Retrospective nested evaluation; seasons already inspected in earlier model research.",
    "Hit-rate difference is small; selected match sets and counts differ.",
    "No historical odds; profitability not demonstrated.",
    "Daily historical cutoff differs from intraday live refresh; source delays not simulated.",
    "Prospective forecasts must remain immutable."
  ]
};

// src/comparison.js
function compareForecasts(forecasts) {
  const out = {
    n: 0,
    currentBrier: 0,
    baselineBrier: 0,
    currentLogLoss: 0,
    baselineLogLoss: 0
  };
  for (const f of forecasts) {
    const base = f.prediction?.baselineProbabilities, p = f.prediction?.probabilities;
    const h = f.result?.home, a = f.result?.away;
    if (!base || !p || !Number.isInteger(h) || !Number.isInteger(a)) continue;
    const keys = ["H", "D", "A"];
    if (![base, p].every(
      (q) => keys.every((k) => Number.isFinite(q[k]) && q[k] >= 0 && q[k] <= 1) && Math.abs(keys.reduce((s, k) => s + q[k], 0) - 1) < 1e-6
    ))
      continue;
    const actual = h > a ? "H" : h === a ? "D" : "A";
    out.n++;
    for (const k of keys) {
      out.currentBrier += (p[k] - Number(k === actual)) ** 2;
      out.baselineBrier += (base[k] - Number(k === actual)) ** 2;
    }
    out.currentLogLoss -= Math.log(Math.max(1e-12, p[actual]));
    out.baselineLogLoss -= Math.log(Math.max(1e-12, base[actual]));
  }
  for (const k of Object.keys(out))
    if (k !== "n") out[k] = out.n ? out[k] / out.n : null;
  return out;
}

// src/validation.json
var validation_default = {
  generatedAt: "2026-10-18T07:40:30.910Z",
  source: "API-Football, resultados regulamentares",
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477",
  matches: 6584,
  holdoutMatches: 1835,
  training: "\xC9poca 2023; atualiza\xE7\xE3o di\xE1ria com resultados anteriores ao corte",
  development: "\xC9poca 2024: escolha entre 3 configura\xE7\xF5es predefinidas",
  holdout: "\xC9poca 2025 (2025/26): avalia\xE7\xE3o ap\xF3s sele\xE7\xE3o; pesos atualizados s\xF3 com passado",
  cutoff: "00:00 UTC do dia do jogo; exclui jogos sem 2h de anteced\xEAncia",
  opts: {
    halfLife: 180,
    prior: 8,
    eloWeight: 0
  },
  developmentResults: [
    {
      opts: {
        halfLife: 180,
        prior: 8,
        eloWeight: 0.15
      },
      n: 25256,
      brier: 0.2076534527526152,
      logLoss: 0.6021699188789066,
      accuracy: 0.6708900855242319
    },
    {
      opts: {
        halfLife: 365,
        prior: 8,
        eloWeight: 0
      },
      n: 25256,
      brier: 0.207728197742382,
      logLoss: 0.6024099776605032,
      accuracy: 0.6735033259423503
    },
    {
      opts: {
        halfLife: 180,
        prior: 8,
        eloWeight: 0
      },
      n: 25256,
      brier: 0.20784252547126167,
      logLoss: 0.6027357943578188,
      accuracy: 0.6705733291099145
    }
  ],
  markets: {
    H: {
      n: 1835,
      brier: 0.21399248918404434,
      logLoss: 0.6162724181688913,
      accuracy: 0.6517711171662125,
      baselineBrier: 0.2457717740098413,
      ece: 0.0179749243600398,
      comparison: {
        improvement: 0.031779284825797775,
        interval: [0.02567874837805073, 0.03787982127354482]
      },
      enabled: true,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 14,
          mean: 0.08520532575400495,
          rate: 0.07142857142857142,
          interval: [0.012721886112291636, 0.3146926955395781]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 97,
          mean: 0.1621559609373951,
          rate: 0.14432989690721648,
          interval: [0.08796276624676438, 0.2277958095790852]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 261,
          mean: 0.25080672035527213,
          rate: 0.210727969348659,
          interval: [0.16562740914092677, 0.264220469742149]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 423,
          mean: 0.3531019639330863,
          rate: 0.3546099290780142,
          interval: [0.31051490788606684, 0.4013219889862154]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 436,
          mean: 0.44564712001538626,
          rate: 0.4518348623853211,
          interval: [0.4057428705982452, 0.4987682079354815]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 331,
          mean: 0.5465132694646907,
          rate: 0.5438066465256798,
          interval: [0.48995185317353457, 0.5966562624250054]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 173,
          mean: 0.6380617762480439,
          rate: 0.6878612716763006,
          interval: [0.6153635908314615, 0.7521969831511309]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 73,
          mean: 0.7424469999118822,
          rate: 0.8356164383561644,
          interval: [0.7342874444391131, 0.903387981371906]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 25,
          mean: 0.8340563110506543,
          rate: 0.84,
          interval: [0.6534598601976183, 0.9359665239142201]
        },
        {
          low: 0.9,
          high: 1,
          n: 2,
          mean: 0.902269177400121,
          rate: 0.5,
          interval: [0.09452865480086614, 0.9054713451991339]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.22259816074736302,
          logLoss: 0.6348068954344936,
          accuracy: 0.638235294117647,
          comparison: {
            improvement: 0.020703231390542056,
            interval: [0.008511469283926024, 0.03289499349715809]
          },
          enabled: true
        },
        "61": {
          n: 269,
          brier: 0.2299896282536344,
          logLoss: 0.6505766212337643,
          accuracy: 0.587360594795539,
          comparison: {
            improvement: 0.01895733996686913,
            interval: [0.0033120377252984327, 0.034602642208439824]
          },
          enabled: true
        },
        "78": {
          n: 278,
          brier: 0.20224416359767705,
          logLoss: 0.5920221325412313,
          accuracy: 0.6834532374100719,
          comparison: {
            improvement: 0.04415586441891666,
            interval: [0.027916127533244264, 0.060395601304589056]
          },
          enabled: true
        },
        "94": {
          n: 274,
          brier: 0.19178302684639503,
          logLoss: 0.565595388639019,
          accuracy: 0.6861313868613139,
          comparison: {
            improvement: 0.05112502069349693,
            interval: [0.032940049925974685, 0.06930999146101917]
          },
          enabled: true
        },
        "135": {
          n: 340,
          brier: 0.2099910268534326,
          logLoss: 0.6073153325253567,
          accuracy: 0.6764705882352942,
          comparison: {
            improvement: 0.030833014890902063,
            interval: [0.01667700719582671, 0.044989022585977416]
          },
          enabled: true
        },
        "140": {
          n: 334,
          brier: 0.2244199312340012,
          logLoss: 0.6406524831979912,
          accuracy: 0.6377245508982036,
          comparison: {
            improvement: 0.028172315838572253,
            interval: [0.014294165847686944, 0.04205046582945756]
          },
          enabled: true
        }
      }
    },
    D: {
      n: 1835,
      brier: 0.18887705662256768,
      logLoss: 0.5648106327887791,
      accuracy: 0.7449591280653951,
      baselineBrier: 0.19007832519007292,
      ece: 0.021465490043090247,
      comparison: {
        improvement: 0.0012012685675048674,
        interval: [-19883599416718007e-20, 0.002601373129176915]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 11,
          mean: 0.08652015196832706,
          rate: 0.18181818181818182,
          interval: [0.05136660067100063, 0.4769861375782448]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 209,
          mean: 0.16880184222870084,
          rate: 0.17703349282296652,
          interval: [0.13125265631066352, 0.23447284096054666]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 1553,
          mean: 0.24832557614792888,
          rate: 0.2678686413393432,
          interval: [0.246435674245909, 0.2904472045260867]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 62,
          mean: 0.31080807555248824,
          rate: 0.20967741935483872,
          interval: [0.12683870286313342, 0.3263945113965444]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.20328688085375496,
          logLoss: 0.597678261404469,
          accuracy: 0.7205882352941176,
          comparison: {
            improvement: -9168747437774841e-19,
            interval: [-0.0033689242467817198, 0.0015351747592267514]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.18254321051323977,
          logLoss: 0.5507329778762576,
          accuracy: 0.758364312267658,
          comparison: {
            improvement: 566049323998418e-18,
            interval: [-0.0025746521999420154, 0.003706750847938852]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.18247039488802486,
          logLoss: 0.5521278292332018,
          accuracy: 0.7589928057553957,
          comparison: {
            improvement: 5250847512129349e-19,
            interval: [-0.003569239209585389, 0.004619408712011259]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.20218018539577562,
          logLoss: 0.5937935324355286,
          accuracy: 0.7153284671532847,
          comparison: {
            improvement: 0.0022920694985297365,
            interval: [-0.002730791659429988, 0.007314930656489461]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.18689635709838417,
          logLoss: 0.5610860774548779,
          accuracy: 0.75,
          comparison: {
            improvement: 959771381673909e-18,
            interval: [-0.0020517512240319437, 0.003971293987379762]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.17574501135721382,
          logLoss: 0.5332619775220184,
          accuracy: 0.7664670658682635,
          comparison: {
            improvement: 0.003782859559571054,
            interval: [8556996007386096e-19, 0.006710019518403498]
          },
          enabled: true
        }
      }
    },
    A: {
      n: 1835,
      brier: 0.18706851565651264,
      logLoss: 0.5553557214388996,
      accuracy: 0.7264305177111716,
      baselineBrier: 0.2137502723896356,
      ece: 0.031451939709679806,
      comparison: {
        improvement: 0.026681756733123445,
        interval: [0.020932285227201416, 0.03243122823904547]
      },
      enabled: true,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 65,
          mean: 0.07329376965210217,
          rate: 0.046153846153846156,
          interval: [0.01581955358590327, 0.12714051706904955]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 297,
          mean: 0.15968180779469213,
          rate: 0.12121212121212122,
          interval: [0.08885227043583735, 0.16324584365476716]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 504,
          mean: 0.25263040270823867,
          rate: 0.23214285714285715,
          interval: [0.197392615452164, 0.2709455435328424]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 466,
          mean: 0.34762338573567797,
          rate: 0.3090128755364807,
          interval: [0.2687619035779969, 0.35238701129033323]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 265,
          mean: 0.4480001718373465,
          rate: 0.4377358490566038,
          interval: [0.37931488199575375, 0.4979362577088157]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 160,
          mean: 0.54295664354969,
          rate: 0.6,
          interval: [0.5226034047446808, 0.6727071879253126]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 55,
          mean: 0.6406566426054593,
          rate: 0.6909090909090909,
          interval: [0.5597116084861727, 0.7971787547942276]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 20,
          mean: 0.7433579601956695,
          rate: 0.8,
          interval: [0.5839782779742401, 0.9193436467288]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 3,
          mean: 0.8209295617804241,
          rate: 0.6666666666666666,
          interval: [0.2076549551264879, 0.9385096847238394]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.19775587429564606,
          logLoss: 0.580939411497854,
          accuracy: 0.7147058823529412,
          comparison: {
            improvement: 0.016283286569042245,
            interval: [0.005046981506549799, 0.02751959163153469]
          },
          enabled: true
        },
        "61": {
          n: 269,
          brier: 0.18820489509179622,
          logLoss: 0.5580304794110769,
          accuracy: 0.7100371747211895,
          comparison: {
            improvement: 0.022946331017992642,
            interval: [0.00921906249647515, 0.03667359953951013]
          },
          enabled: true
        },
        "78": {
          n: 278,
          brier: 0.18899906144478298,
          logLoss: 0.5617272512629641,
          accuracy: 0.7086330935251799,
          comparison: {
            improvement: 0.031634628725114994,
            interval: [0.0155586125708204, 0.04771064487940958]
          },
          enabled: true
        },
        "94": {
          n: 274,
          brier: 0.16600385684008576,
          logLoss: 0.5026274269544307,
          accuracy: 0.7883211678832117,
          comparison: {
            improvement: 0.04724329221415411,
            interval: [0.029132077142070556, 0.06535450728623766]
          },
          enabled: true
        },
        "135": {
          n: 340,
          brier: 0.19295686285418337,
          logLoss: 0.5694059137118515,
          accuracy: 0.7058823529411765,
          comparison: {
            improvement: 0.03447338828529936,
            interval: [0.020702905822642954, 0.04824387074795577]
          },
          enabled: true
        },
        "140": {
          n: 334,
          brier: 0.18495354180608464,
          logLoss: 0.5508085283559385,
          accuracy: 0.7365269461077845,
          comparison: {
            improvement: 0.011353599576961675,
            interval: [-5687221503513917e-19, 0.023275921304274742]
          },
          enabled: false
        }
      }
    },
    HX: {
      n: 1835,
      brier: 0.1870685156565126,
      logLoss: 0.5553557214388996,
      accuracy: 0.7264305177111716,
      baselineBrier: 0.21375027238963565,
      ece: 0.031451939709679834,
      comparison: {
        improvement: 0.02668175673312348,
        interval: [0.020932285227201447, 0.03243122823904551]
      },
      enabled: true,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 3,
          mean: 0.179070438219576,
          rate: 0.3333333333333333,
          interval: [0.0614903152761605, 0.7923450448735121]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 20,
          mean: 0.25664203980433065,
          rate: 0.2,
          interval: [0.0806563532712, 0.41602172202575993]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 55,
          mean: 0.3593433573945408,
          rate: 0.3090909090909091,
          interval: [0.20282124520577244, 0.4402883915138273]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 160,
          mean: 0.4570433564503105,
          rate: 0.4,
          interval: [0.32729281207468736, 0.47739659525531913]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 265,
          mean: 0.5519998281626535,
          rate: 0.5622641509433962,
          interval: [0.5020637422911842, 0.6206851180042463]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 466,
          mean: 0.6523766142643217,
          rate: 0.6909871244635193,
          interval: [0.6476129887096668, 0.731238096422003]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 504,
          mean: 0.7473695972917616,
          rate: 0.7678571428571429,
          interval: [0.7290544564671577, 0.8026073845478361]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 297,
          mean: 0.8403181922053082,
          rate: 0.8787878787878788,
          interval: [0.8367541563452329, 0.9111477295641627]
        },
        {
          low: 0.9,
          high: 1,
          n: 65,
          mean: 0.9267062303478979,
          rate: 0.9538461538461539,
          interval: [0.8728594829309505, 0.9841804464140967]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.19775587429564614,
          logLoss: 0.5809394114978541,
          accuracy: 0.7147058823529412,
          comparison: {
            improvement: 0.016283286569042252,
            interval: [0.005046981506549806, 0.027519591631534696]
          },
          enabled: true
        },
        "61": {
          n: 269,
          brier: 0.18820489509179614,
          logLoss: 0.5580304794110768,
          accuracy: 0.7100371747211895,
          comparison: {
            improvement: 0.022946331017992646,
            interval: [0.009219062496475156, 0.03667359953951013]
          },
          enabled: true
        },
        "78": {
          n: 278,
          brier: 0.18899906144478296,
          logLoss: 0.5617272512629645,
          accuracy: 0.7086330935251799,
          comparison: {
            improvement: 0.031634628725115,
            interval: [0.015558612570820408, 0.0477106448794096]
          },
          enabled: true
        },
        "94": {
          n: 274,
          brier: 0.16600385684008576,
          logLoss: 0.5026274269544307,
          accuracy: 0.7883211678832117,
          comparison: {
            improvement: 0.04724329221415408,
            interval: [0.029132077142070525, 0.06535450728623764]
          },
          enabled: true
        },
        "135": {
          n: 340,
          brier: 0.1929568628541833,
          logLoss: 0.5694059137118513,
          accuracy: 0.7058823529411765,
          comparison: {
            improvement: 0.03447338828529937,
            interval: [0.020702905822642954, 0.04824387074795578]
          },
          enabled: true
        },
        "140": {
          n: 334,
          brier: 0.18495354180608464,
          logLoss: 0.5508085283559387,
          accuracy: 0.7365269461077845,
          comparison: {
            improvement: 0.011353599576961585,
            interval: [-5687221503514837e-19, 0.023275921304274652]
          },
          enabled: false
        }
      }
    },
    XA: {
      n: 1835,
      brier: 0.2139924891840443,
      logLoss: 0.6162724181688913,
      accuracy: 0.6517711171662125,
      baselineBrier: 0.2457717740098414,
      ece: 0.017974924360039723,
      comparison: {
        improvement: 0.03177928482579783,
        interval: [0.025678748378050783, 0.037879821273544875]
      },
      enabled: true,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 2,
          mean: 0.09773082259987938,
          rate: 0.5,
          interval: [0.09452865480086614, 0.9054713451991339]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 25,
          mean: 0.16594368894934605,
          rate: 0.16,
          interval: [0.06403347608577989, 0.34654013980238163]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 73,
          mean: 0.25755300008811727,
          rate: 0.1643835616438356,
          interval: [0.09661201862809403, 0.26571255556088685]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 173,
          mean: 0.3619382237519561,
          rate: 0.31213872832369943,
          interval: [0.24780301684886918, 0.3846364091685386]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 331,
          mean: 0.4534867305353098,
          rate: 0.4561933534743202,
          interval: [0.4033437375749948, 0.5100481468264655]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 436,
          mean: 0.5543528799846142,
          rate: 0.5481651376146789,
          interval: [0.5012317920645185, 0.5942571294017548]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 423,
          mean: 0.6468980360669135,
          rate: 0.6453900709219859,
          interval: [0.5986780110137846, 0.689485092113933]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 261,
          mean: 0.7491932796447279,
          rate: 0.789272030651341,
          interval: [0.735779530257851, 0.8343725908590732]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 97,
          mean: 0.8378440390626053,
          rate: 0.8556701030927835,
          interval: [0.7722041904209146, 0.9120372337532355]
        },
        {
          low: 0.9,
          high: 1,
          n: 14,
          mean: 0.914794674245995,
          rate: 0.9285714285714286,
          interval: [0.6853073044604219, 0.9872781138877085]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.2225981607473629,
          logLoss: 0.6348068954344941,
          accuracy: 0.638235294117647,
          comparison: {
            improvement: 0.020703231390542056,
            interval: [0.008511469283926027, 0.03289499349715808]
          },
          enabled: true
        },
        "61": {
          n: 269,
          brier: 0.2299896282536344,
          logLoss: 0.6505766212337643,
          accuracy: 0.587360594795539,
          comparison: {
            improvement: 0.018957339966869147,
            interval: [0.003312037725298443, 0.03460264220843985]
          },
          enabled: true
        },
        "78": {
          n: 278,
          brier: 0.202244163597677,
          logLoss: 0.5920221325412313,
          accuracy: 0.6834532374100719,
          comparison: {
            improvement: 0.0441558644189167,
            interval: [0.027916127533244302, 0.060395601304589104]
          },
          enabled: true
        },
        "94": {
          n: 274,
          brier: 0.19178302684639503,
          logLoss: 0.5655953886390191,
          accuracy: 0.6861313868613139,
          comparison: {
            improvement: 0.051125020693496934,
            interval: [0.0329400499259747, 0.06930999146101917]
          },
          enabled: true
        },
        "135": {
          n: 340,
          brier: 0.20999102685343257,
          logLoss: 0.6073153325253571,
          accuracy: 0.6764705882352942,
          comparison: {
            improvement: 0.030833014890902087,
            interval: [0.016677007195826737, 0.04498902258597744]
          },
          enabled: true
        },
        "140": {
          n: 334,
          brier: 0.22441993123400125,
          logLoss: 0.6406524831979915,
          accuracy: 0.6377245508982036,
          comparison: {
            improvement: 0.028172315838572354,
            interval: [0.014294165847687041, 0.042050465829457664]
          },
          enabled: true
        }
      }
    },
    HA: {
      n: 1835,
      brier: 0.18887705662256765,
      logLoss: 0.5648106327887793,
      accuracy: 0.7449591280653951,
      baselineBrier: 0.19007832519007284,
      ece: 0.0214654900430899,
      comparison: {
        improvement: 0.0012012685675048488,
        interval: [-19883599416719677e-20, 0.0026013731291768946]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 62,
          mean: 0.689191924447512,
          rate: 0.7903225806451613,
          interval: [0.6736054886034556, 0.8731612971368666]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 1553,
          mean: 0.7516744238520707,
          rate: 0.7321313586606568,
          interval: [0.7095527954739134, 0.7535643257540909]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 209,
          mean: 0.831198157771299,
          rate: 0.8229665071770335,
          interval: [0.7655271590394533, 0.8687473436893366]
        },
        {
          low: 0.9,
          high: 1,
          n: 11,
          mean: 0.9134798480316731,
          rate: 0.8181818181818182,
          interval: [0.5230138624217553, 0.9486333993289995]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.20328688085375488,
          logLoss: 0.597678261404469,
          accuracy: 0.7205882352941176,
          comparison: {
            improvement: -9168747437774509e-19,
            interval: [-0.00336892424678168, 0.001535174759226778]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.18254321051323988,
          logLoss: 0.5507329778762575,
          accuracy: 0.758364312267658,
          comparison: {
            improvement: 5660493239984021e-19,
            interval: [-0.002574652199942027, 0.0037067508479388315]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.18247039488802483,
          logLoss: 0.5521278292332018,
          accuracy: 0.7589928057553957,
          comparison: {
            improvement: 525084751212907e-18,
            interval: [-0.003569239209585411, 0.004619408712011225]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.20218018539577567,
          logLoss: 0.5937935324355285,
          accuracy: 0.7153284671532847,
          comparison: {
            improvement: 0.002292069498529726,
            interval: [-0.0027307916594299965, 0.007314930656489449]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.18689635709838417,
          logLoss: 0.5610860774548776,
          accuracy: 0.75,
          comparison: {
            improvement: 9597713816738493e-19,
            interval: [-0.002051751224031997, 0.003971293987379695]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.1757450113572138,
          logLoss: 0.5332619775220184,
          accuracy: 0.7664670658682635,
          comparison: {
            improvement: 0.0037828595595710154,
            interval: [8556996007385654e-19, 0.006710019518403465]
          },
          enabled: true
        }
      }
    },
    O15: {
      n: 1835,
      brier: 0.17936792793036338,
      logLoss: 0.5433627498681552,
      accuracy: 0.7645776566757493,
      baselineBrier: 0.17937477767369314,
      ece: 0.023205695431953253,
      comparison: {
        improvement: 6849743329312891e-21,
        interval: [-0.002593443113360061, 0.0026071426000186864]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 54,
          mean: 0.5715125983450713,
          rate: 0.6851851851851852,
          interval: [0.5525630440832037, 0.7932088571090179]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 405,
          mean: 0.660793667605915,
          rate: 0.7185185185185186,
          interval: [0.672823354952538, 0.7601071491840274]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 854,
          mean: 0.751923218074431,
          rate: 0.7552693208430913,
          interval: [0.7253329520799802, 0.7829193872796404]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 497,
          mean: 0.8355950765972713,
          rate: 0.8169014084507042,
          interval: [0.7805121724835496, 0.8484291934093794]
        },
        {
          low: 0.9,
          high: 1,
          n: 25,
          mean: 0.9233103209846444,
          rate: 0.96,
          interval: [0.8045552759497747, 0.9929039496133008]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.1702818191629983,
          logLoss: 0.5240655492117668,
          accuracy: 0.7852941176470588,
          comparison: {
            improvement: -0.0011748642425671984,
            interval: [-0.005882233496794481, 0.0035325050116600844]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.211666292650219,
          logLoss: 0.6225296874193516,
          accuracy: 0.7174721189591078,
          comparison: {
            improvement: -0.0036472022544561376,
            interval: [-0.010272374596620235, 0.0029779700877079593]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.13232107755172784,
          logLoss: 0.4351793091815218,
          accuracy: 0.8489208633093526,
          comparison: {
            improvement: -0.0032311687116430535,
            interval: [-0.008964178210185473, 0.0025018407868993664]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.1844618120609751,
          logLoss: 0.5538310364524807,
          accuracy: 0.7481751824817519,
          comparison: {
            improvement: 0.004426111689674978,
            interval: [-0.003588968793746222, 0.012441192173096177]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.20861055442888723,
          logLoss: 0.6078484913270467,
          accuracy: 0.7088235294117647,
          comparison: {
            improvement: -0.0018520210895032732,
            interval: [-0.007095680447888447, 0.0033916382688819]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.1678165028262844,
          logLoss: 0.5150593843371862,
          accuracy: 0.781437125748503,
          comparison: {
            improvement: 0.005114724542598128,
            interval: [-0.0024980627874052006, 0.012727511872601457]
          },
          enabled: false
        }
      }
    },
    U15: {
      n: 1835,
      brier: 0.17936792793036338,
      logLoss: 0.5433627498681552,
      accuracy: 0.7645776566757493,
      baselineBrier: 0.17937477767369314,
      ece: 0.023205695431953565,
      comparison: {
        improvement: 6849743329312891e-21,
        interval: [-0.002593443113360061, 0.0026071426000186864]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 25,
          mean: 0.07668967901535569,
          rate: 0.04,
          interval: [0.007096050386699165, 0.19544472405022525]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 497,
          mean: 0.16440492340272858,
          rate: 0.18309859154929578,
          interval: [0.1515708065906206, 0.2194878275164504]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 854,
          mean: 0.24807678192556923,
          rate: 0.24473067915690866,
          interval: [0.2170806127203596, 0.2746670479200197]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 405,
          mean: 0.33920633239408576,
          rate: 0.2814814814814815,
          interval: [0.23989285081597259, 0.32717664504746213]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 54,
          mean: 0.4284874016549286,
          rate: 0.3148148148148148,
          interval: [0.2067911428909822, 0.44743695591679633]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.1702818191629983,
          logLoss: 0.5240655492117668,
          accuracy: 0.7852941176470588,
          comparison: {
            improvement: -0.0011748642425671984,
            interval: [-0.005882233496794481, 0.0035325050116600844]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.211666292650219,
          logLoss: 0.6225296874193516,
          accuracy: 0.7174721189591078,
          comparison: {
            improvement: -0.0036472022544561376,
            interval: [-0.010272374596620235, 0.0029779700877079593]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.13232107755172784,
          logLoss: 0.4351793091815218,
          accuracy: 0.8489208633093526,
          comparison: {
            improvement: -0.0032311687116430535,
            interval: [-0.008964178210185473, 0.0025018407868993664]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.1844618120609751,
          logLoss: 0.5538310364524807,
          accuracy: 0.7481751824817519,
          comparison: {
            improvement: 0.004426111689674978,
            interval: [-0.003588968793746222, 0.012441192173096177]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.20861055442888723,
          logLoss: 0.6078484913270467,
          accuracy: 0.7088235294117647,
          comparison: {
            improvement: -0.0018520210895032732,
            interval: [-0.007095680447888447, 0.0033916382688819]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.1678165028262844,
          logLoss: 0.5150593843371862,
          accuracy: 0.781437125748503,
          comparison: {
            improvement: 0.005114724542598128,
            interval: [-0.0024980627874052006, 0.012727511872601457]
          },
          enabled: false
        }
      }
    },
    O25: {
      n: 1835,
      brier: 0.2466096281795871,
      logLoss: 0.6862039539552107,
      accuracy: 0.55858310626703,
      baselineBrier: 0.2470500697288559,
      ece: 0.03942184667957037,
      comparison: {
        improvement: 4404415492688114e-19,
        interval: [-0.003580013810811691, 0.004460896909349314]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 22,
          mean: 0.2784149805484997,
          rate: 0.3181818181818182,
          interval: [0.1636038735469248, 0.5268177721716065]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 241,
          mean: 0.3640785339591654,
          rate: 0.46473029045643155,
          interval: [0.40280708579567986, 0.5277602687715177]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 566,
          mean: 0.45393660242136585,
          rate: 0.48056537102473496,
          interval: [0.4396738169644435, 0.5217189630642521]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 614,
          mean: 0.5472250455294771,
          rate: 0.5667752442996743,
          interval: [0.5272845921910759, 0.6054355095307894]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 326,
          mean: 0.6392973319510716,
          rate: 0.5797546012269938,
          interval: [0.5255483227791086, 0.632103107483175]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 56,
          mean: 0.7318426517897972,
          rate: 0.7321428571428571,
          interval: [0.6040519481066103, 0.8304284133810503]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 10,
          mean: 0.8296301876991198,
          rate: 0.9,
          interval: [0.5958436145024278, 0.9821242504842788]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.25528514877356917,
          logLoss: 0.7044072761864497,
          accuracy: 0.5470588235294118,
          comparison: {
            improvement: -0.0062060288892466006,
            interval: [-0.014141366054064644, 0.001729308275571443]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.2509924331023451,
          logLoss: 0.6955711032261817,
          accuracy: 0.5427509293680297,
          comparison: {
            improvement: 6782318159311993e-19,
            interval: [-0.009609774779712027, 0.010966238411574425]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.22946897532580054,
          logLoss: 0.6494345898391949,
          accuracy: 0.6223021582733813,
          comparison: {
            improvement: 8796771719416176e-19,
            interval: [-0.010165659048634892, 0.011925013392518127]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.2371546243670923,
          logLoss: 0.6669308611835805,
          accuracy: 0.6021897810218978,
          comparison: {
            improvement: 0.012742657546592377,
            interval: [0.001403079412236852, 0.024082235680947903]
          },
          enabled: true
        },
        "135": {
          n: 340,
          brier: 0.25559592457761304,
          logLoss: 0.7051823646145878,
          accuracy: 0.5147058823529411,
          comparison: {
            improvement: -0.006293970133995231,
            interval: [-0.0137045936608741, 0.0011166533928836384]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.24712394026483198,
          logLoss: 0.6872253860120252,
          accuracy: 0.5389221556886228,
          comparison: {
            improvement: 0.0034123566789189116,
            interval: [-0.00775853582985715, 0.014583249187694974]
          },
          enabled: false
        }
      }
    },
    U25: {
      n: 1835,
      brier: 0.2466096281795871,
      logLoss: 0.6862039539552106,
      accuracy: 0.55858310626703,
      baselineBrier: 0.2470500697288559,
      ece: 0.03942184667957025,
      comparison: {
        improvement: 4404415492688113e-19,
        interval: [-0.0035800138108116916, 0.004460896909349314]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 10,
          mean: 0.17036981230088027,
          rate: 0.1,
          interval: [0.01787574951572113, 0.4041563854975721]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 56,
          mean: 0.2681573482102029,
          rate: 0.26785714285714285,
          interval: [0.1695715866189496, 0.3959480518933896]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 326,
          mean: 0.3607026680489282,
          rate: 0.42024539877300615,
          interval: [0.3678968925168251, 0.47445167722089154]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 614,
          mean: 0.4527749544705224,
          rate: 0.43322475570032576,
          interval: [0.39456449046921066, 0.4727154078089241]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 566,
          mean: 0.5460633975786344,
          rate: 0.519434628975265,
          interval: [0.47828103693574786, 0.5603261830355565]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 241,
          mean: 0.6359214660408341,
          rate: 0.5352697095435685,
          interval: [0.4722397312284822, 0.5971929142043201]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 22,
          mean: 0.7215850194515004,
          rate: 0.6818181818181818,
          interval: [0.47318222782839336, 0.8363961264530752]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.25528514877356917,
          logLoss: 0.7044072761864497,
          accuracy: 0.5470588235294118,
          comparison: {
            improvement: -0.0062060288892466006,
            interval: [-0.014141366054064644, 0.001729308275571443]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.25099243310234515,
          logLoss: 0.6955711032261817,
          accuracy: 0.5427509293680297,
          comparison: {
            improvement: 6782318159311974e-19,
            interval: [-0.009609774779712027, 0.010966238411574422]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.22946897532580054,
          logLoss: 0.6494345898391949,
          accuracy: 0.6223021582733813,
          comparison: {
            improvement: 8796771719416176e-19,
            interval: [-0.010165659048634893, 0.011925013392518129]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.2371546243670923,
          logLoss: 0.6669308611835805,
          accuracy: 0.6021897810218978,
          comparison: {
            improvement: 0.01274265754659238,
            interval: [0.0014030794122368555, 0.024082235680947903]
          },
          enabled: true
        },
        "135": {
          n: 340,
          brier: 0.25559592457761304,
          logLoss: 0.7051823646145878,
          accuracy: 0.5147058823529411,
          comparison: {
            improvement: -0.006293970133995234,
            interval: [-0.013704593660874105, 0.0011166533928836375]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.24712394026483198,
          logLoss: 0.6872253860120252,
          accuracy: 0.5389221556886228,
          comparison: {
            improvement: 0.003412356678918909,
            interval: [-0.007758535829857152, 0.01458324918769497]
          },
          enabled: false
        }
      }
    },
    O35: {
      n: 1835,
      brier: 0.20395089239648928,
      logLoss: 0.5969076965115444,
      accuracy: 0.7046321525885558,
      baselineBrier: 0.20579489028037928,
      ece: 0.019562359266423048,
      comparison: {
        improvement: 0.0018439978838903509,
        interval: [-0.0016500109350689955, 0.005338006702849697]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 2,
          mean: 0.0963481480126269,
          rate: 0,
          interval: [0, 0.6576280471103807]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 277,
          mean: 0.169050811346579,
          rate: 0.20938628158844766,
          interval: [0.16560953139502327, 0.2611135751532944]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 711,
          mean: 0.2531557755831614,
          rate: 0.2559774964838256,
          interval: [0.22526974866024996, 0.28930802633214003]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 567,
          mean: 0.3470333666975816,
          rate: 0.3368606701940035,
          interval: [0.299170331293854, 0.3767467707533689]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 229,
          mean: 0.43955044707769203,
          rate: 0.38427947598253276,
          interval: [0.3236795331010934, 0.4486979114792566]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 37,
          mean: 0.5395135164250514,
          rate: 0.4594594594594595,
          interval: [0.31038327828457724, 0.6161622047523264]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 10,
          mean: 0.6375468757743588,
          rate: 0.7,
          interval: [0.39677321997956516, 0.892210712513788]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 2,
          mean: 0.743219253906213,
          rate: 1,
          interval: [0.34237195288961925, 1]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.2080915947142367,
          logLoss: 0.6069199631131393,
          accuracy: 0.7205882352941176,
          comparison: {
            improvement: -0.004042859232431392,
            interval: [-0.010272437213475965, 0.002186718748613181]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.21922986065965658,
          logLoss: 0.6304725866380101,
          accuracy: 0.6728624535315985,
          comparison: {
            improvement: 7047719903340004e-19,
            interval: [-0.008407538039971794, 0.009817082020639795]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.23864432438557612,
          logLoss: 0.6699804089335101,
          accuracy: 0.6007194244604317,
          comparison: {
            improvement: 0.010239484788401105,
            interval: [-0.0016768474527838265, 0.022155817029586036]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.20799016900357145,
          logLoss: 0.6048903720194485,
          accuracy: 0.6788321167883211,
          comparison: {
            improvement: 0.007350174168647574,
            interval: [-0.002708287042732734, 0.017408635380027883]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.17279374529776853,
          logLoss: 0.5303358762629128,
          accuracy: 0.7852941176470588,
          comparison: {
            improvement: -0.0029297954490455787,
            interval: [-0.007632936757771824, 0.0017733458596806665]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.18695691898161476,
          logLoss: 0.560080827210643,
          accuracy: 0.7395209580838323,
          comparison: {
            improvement: 0.0021087741013658024,
            interval: [-0.007079625016456006, 0.01129717321918761]
          },
          enabled: false
        }
      }
    },
    U35: {
      n: 1835,
      brier: 0.20395089239648928,
      logLoss: 0.5969076965115444,
      accuracy: 0.7046321525885558,
      baselineBrier: 0.20579489028037928,
      ece: 0.01956235926642319,
      comparison: {
        improvement: 0.0018439978838903509,
        interval: [-0.0016500109350689955, 0.005338006702849697]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 2,
          mean: 0.2567807460937869,
          rate: 0,
          interval: [0, 0.6576280471103807]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 10,
          mean: 0.3624531242256412,
          rate: 0.3,
          interval: [0.10778928748621183, 0.6032267800204347]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 37,
          mean: 0.4604864835749487,
          rate: 0.5405405405405406,
          interval: [0.38383779524767364, 0.6896167217154228]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 229,
          mean: 0.5604495529223079,
          rate: 0.6157205240174672,
          interval: [0.5513020885207434, 0.6763204668989067]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 567,
          mean: 0.6529666333024181,
          rate: 0.6631393298059964,
          interval: [0.6232532292466311, 0.7008296687061459]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 711,
          mean: 0.7468442244168386,
          rate: 0.7440225035161744,
          interval: [0.71069197366786, 0.7747302513397502]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 277,
          mean: 0.8309491886534215,
          rate: 0.7906137184115524,
          interval: [0.7388864248467057, 0.8343904686049768]
        },
        {
          low: 0.9,
          high: 1,
          n: 2,
          mean: 0.9036518519873731,
          rate: 1,
          interval: [0.34237195288961925, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.2080915947142367,
          logLoss: 0.6069199631131393,
          accuracy: 0.7205882352941176,
          comparison: {
            improvement: -0.004042859232431401,
            interval: [-0.010272437213475974, 0.002186718748613172]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.21922986065965658,
          logLoss: 0.6304725866380101,
          accuracy: 0.6728624535315985,
          comparison: {
            improvement: 7047719903340069e-19,
            interval: [-0.008407538039971787, 0.009817082020639802]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.23864432438557612,
          logLoss: 0.6699804089335101,
          accuracy: 0.6007194244604317,
          comparison: {
            improvement: 0.010239484788401105,
            interval: [-0.0016768474527838282, 0.022155817029586036]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.20799016900357148,
          logLoss: 0.6048903720194485,
          accuracy: 0.6788321167883211,
          comparison: {
            improvement: 0.007350174168647573,
            interval: [-0.002708287042732736, 0.017408635380027883]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.17279374529776853,
          logLoss: 0.5303358762629128,
          accuracy: 0.7852941176470588,
          comparison: {
            improvement: -0.002929795449045575,
            interval: [-0.007632936757771819, 0.0017733458596806695]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.18695691898161476,
          logLoss: 0.560080827210643,
          accuracy: 0.7395209580838323,
          comparison: {
            improvement: 0.0021087741013658006,
            interval: [-0.0070796250164560075, 0.011297173219187608]
          },
          enabled: false
        }
      }
    },
    BY: {
      n: 1835,
      brier: 0.24883608643027375,
      logLoss: 0.6909858519962603,
      accuracy: 0.5405994550408719,
      baselineBrier: 0.2479998675026705,
      ece: 0.030053319798026806,
      comparison: {
        improvement: -8362189276029343e-19,
        interval: [-0.004195390165061069, 0.0025229523098552007]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 1,
          mean: 0.2926778357641579,
          rate: 1,
          interval: [0.20654329147389294, 1]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 101,
          mean: 0.37498375110856197,
          rate: 0.46534653465346537,
          interval: [0.3711275816192353, 0.5621050283371178]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 643,
          mean: 0.45708938713100444,
          rate: 0.49455676516329705,
          interval: [0.4560588697904171, 0.5331193154097925]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 798,
          mean: 0.5483426631818568,
          rate: 0.5551378446115288,
          interval: [0.5204753210193719, 0.5892720405542856]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 280,
          mean: 0.632956374884417,
          rate: 0.5785714285714286,
          interval: [0.520052344197931, 0.634963692915727]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 12,
          mean: 0.7143345586524089,
          rate: 0.6666666666666666,
          interval: [0.3906175873976139, 0.8618821601026385]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.24581566369903823,
          logLoss: 0.6847779830485555,
          accuracy: 0.5470588235294118,
          comparison: {
            improvement: 0.0014632464029406568,
            interval: [-0.00523926139951542, 0.008165754205396733]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.2550367963032472,
          logLoss: 0.7040024607268188,
          accuracy: 0.5427509293680297,
          comparison: {
            improvement: 5206626772524695e-19,
            interval: [-0.008023074494205229, 0.009064399848710167]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.24472220725029176,
          logLoss: 0.6826473568150039,
          accuracy: 0.564748201438849,
          comparison: {
            improvement: -0.008638215212029203,
            interval: [-0.017526759633175168, 2503292091167626e-19]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.24883708864347678,
          logLoss: 0.6908138059033533,
          accuracy: 0.5364963503649635,
          comparison: {
            improvement: 0.003802454354340481,
            interval: [-0.006440576338296299, 0.01404548504697726]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.25110612814622585,
          logLoss: 0.6954832378367458,
          accuracy: 0.5117647058823529,
          comparison: {
            improvement: -6950805587095468e-19,
            interval: [-0.007435025340238877, 0.006044864222819784]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.2480292672535797,
          logLoss: 0.6893251897141695,
          accuracy: 0.5449101796407185,
          comparison: {
            improvement: -0.0017249851602276984,
            interval: [-0.010347612957018443, 0.006897642636563045]
          },
          enabled: false
        }
      }
    },
    BN: {
      n: 1835,
      brier: 0.24883608643027375,
      logLoss: 0.6909858519962603,
      accuracy: 0.5405994550408719,
      baselineBrier: 0.2479998675026705,
      ece: 0.03005331979802657,
      comparison: {
        improvement: -8362189276029343e-19,
        interval: [-0.004195390165061069, 0.002522952309855201]
      },
      enabled: false,
      bins: [
        {
          low: 0,
          high: 0.1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.1,
          high: 0.2,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.2,
          high: 0.3,
          n: 12,
          mean: 0.28566544134759103,
          rate: 0.3333333333333333,
          interval: [0.13811783989736134, 0.609382412602386]
        },
        {
          low: 0.3,
          high: 0.4,
          n: 280,
          mean: 0.3670436251155833,
          rate: 0.42142857142857143,
          interval: [0.36503630708427315, 0.4799476558020691]
        },
        {
          low: 0.4,
          high: 0.5,
          n: 798,
          mean: 0.45165733681814296,
          rate: 0.4448621553884712,
          interval: [0.41072795944571444, 0.47952467898062817]
        },
        {
          low: 0.5,
          high: 0.6,
          n: 643,
          mean: 0.5429106128689953,
          rate: 0.505443234836703,
          interval: [0.46688068459020743, 0.5439411302095828]
        },
        {
          low: 0.6,
          high: 0.7,
          n: 101,
          mean: 0.625016248891438,
          rate: 0.5346534653465347,
          interval: [0.4378949716628822, 0.6288724183807648]
        },
        {
          low: 0.7,
          high: 0.8,
          n: 1,
          mean: 0.707322164235842,
          rate: 0,
          interval: [0, 0.7934567085261071]
        },
        {
          low: 0.8,
          high: 0.9,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        },
        {
          low: 0.9,
          high: 1,
          n: 0,
          mean: null,
          rate: null,
          interval: [0, 1]
        }
      ],
      byLeague: {
        "39": {
          n: 340,
          brier: 0.24581566369903823,
          logLoss: 0.6847779830485555,
          accuracy: 0.5470588235294118,
          comparison: {
            improvement: 0.0014632464029406575,
            interval: [-0.005239261399515419, 0.008165754205396735]
          },
          enabled: false
        },
        "61": {
          n: 269,
          brier: 0.2550367963032472,
          logLoss: 0.7040024607268188,
          accuracy: 0.5427509293680297,
          comparison: {
            improvement: 520662677252469e-18,
            interval: [-0.008023074494205229, 0.009064399848710167]
          },
          enabled: false
        },
        "78": {
          n: 278,
          brier: 0.24472220725029176,
          logLoss: 0.6826473568150039,
          accuracy: 0.564748201438849,
          comparison: {
            improvement: -0.008638215212029203,
            interval: [-0.017526759633175168, 2503292091167626e-19]
          },
          enabled: false
        },
        "94": {
          n: 274,
          brier: 0.24883708864347678,
          logLoss: 0.6908138059033533,
          accuracy: 0.5364963503649635,
          comparison: {
            improvement: 0.003802454354340479,
            interval: [-0.006440576338296301, 0.014045485046977259]
          },
          enabled: false
        },
        "135": {
          n: 340,
          brier: 0.25110612814622585,
          logLoss: 0.6954832378367458,
          accuracy: 0.5117647058823529,
          comparison: {
            improvement: -6950805587095428e-19,
            interval: [-0.007435025340238873, 0.006044864222819787]
          },
          enabled: false
        },
        "140": {
          n: 334,
          brier: 0.2480292672535797,
          logLoss: 0.6893251897141695,
          accuracy: 0.5449101796407185,
          comparison: {
            improvement: -0.0017249851602277005,
            interval: [-0.010347612957018444, 0.0068976426365630426]
          },
          enabled: false
        }
      }
    }
  },
  limitations: [
    "Valida\xE7\xE3o retrospetiva com resultados recolhidos agora; corre\xE7\xF5es posteriores da fonte n\xE3o s\xE3o observ\xE1veis.",
    "Sem odds hist\xF3ricas: n\xE3o foi calculado ROI nem demonstrada vantagem sobre casas de apostas.",
    "Sem snapshots do modelo antigo: compara\xE7\xE3o direta n\xE3o executada.",
    "Elo s\xF3 \xE9 inclu\xEDdo se escolhido em desenvolvimento. Les\xF5es, plantel, cantos e cart\xF5es n\xE3o ajustam o modelo.",
    "As condi\xE7\xF5es de sele\xE7\xE3o s\xE3o explorat\xF3rias; requerem confirma\xE7\xE3o prospetiva. Intervalos normais de diferen\xE7as de Brier n\xE3o corrigem depend\xEAncia entre jogos nem compara\xE7\xF5es m\xFAltiplas."
  ]
};

// src/winner-review.json
var winner_review_default = {
  version: "poisson-opponent-v1-winner-v3",
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477",
  scope: "Avalia\xE7\xE3o retrospetiva do seletor de vencedor nos jogos da \xE9poca 2025 j\xE1 avaliados. Probabilidades calculadas cronologicamente no backtest original; sem novo treino nem ajuste dos pesos. N\xE3o \xE9 novo per\xEDodo independente. A recolha e atrasos da API n\xE3o s\xE3o reproduzidos; sem odds hist\xF3ricas, ROI e valor n\xE3o avaliados.",
  rule: "Maior probabilidade entre casa/empate/fora; s\xF3 escolhe equipa se superar as outras duas op\xE7\xF5es. At\xE9 3 por dia de Lisboa, ordenados por probabilidade, sem filtro de odd nem limiar de 65%. Hist\xF3rico m\xEDnimo de 12 jogos efetivos j\xE1 aplicado no conjunto original.",
  all: {
    interval: [
      0.5084609531212911,
      0.5540784194924238
    ],
    ece: 0.024721877029731745,
    n: 1835,
    wins: 975,
    hitRate: 0.5313351498637602,
    meanProbability: 0.5078567874716451,
    brier: 0.2367682818916167,
    logLoss: 0.665970930734142,
    baselineBrierSameEvents: 0.2695504229704425,
    calibrationGap: 0.023478362392115093
  },
  topThreePerDay: {
    interval: [
      0.6157343672130194,
      0.69899479731536
    ],
    ece: 0.06651081137862458,
    n: 495,
    wins: 326,
    hitRate: 0.6585858585858586,
    meanProbability: 0.6069892861179808,
    brier: 0.2149754751009522,
    logLoss: 0.6207943123731327,
    baselineBrierSameEvents: 0.2931418967302693,
    calibrationGap: 0.051596572467877855
  },
  majority: {
    interval: [
      0.6651841656666305,
      0.7548324517180863
    ],
    ece: 0.0638434888896859,
    n: 389,
    wins: 277,
    hitRate: 0.712082262210797,
    meanProbability: 0.6539906232769354,
    brier: 0.2044624295071015,
    logLoss: 0.599057996786027,
    baselineBrierSameEvents: 0.3026868148213565,
    calibrationGap: 0.0580916389338616
  },
  relative: {
    interval: [
      0.37033458798877916,
      0.5568332609864725
    ],
    ece: 0.07629938164463543,
    n: 106,
    wins: 49,
    hitRate: 0.46226415094339623,
    meanProbability: 0.43450324692144093,
    brier: 0.25355636883687616,
    logLoss: 0.7005624893861898,
    baselineBrierSameEvents: 0.2581138482639215,
    calibrationGap: 0.0277609040219553
  },
  byLeague: {
    "39": {
      interval: [
        0.3692454986165162,
        0.5830454881967124
      ],
      ece: 0.1436532482463067,
      n: 80,
      wins: 38,
      hitRate: 0.475,
      meanProbability: 0.5701821408577419,
      brier: 0.24188483028907726,
      logLoss: 0.674763546094394,
      baselineBrierSameEvents: 0.2583198948684964,
      calibrationGap: 0.0951821408577419
    },
    "61": {
      interval: [
        0.5717217482621142,
        0.8086273430493296
      ],
      ece: 0.12658170034644858,
      n: 54,
      wins: 38,
      hitRate: 0.7037037037037037,
      meanProbability: 0.6253742859708068,
      brier: 0.2127112749745146,
      logLoss: 0.6145169484102637,
      baselineBrierSameEvents: 0.278529035440058,
      calibrationGap: 0.07832941773289692
    },
    "78": {
      interval: [
        0.6450473904731996,
        0.8424826738807688
      ],
      ece: 0.1475138024749993,
      n: 70,
      wins: 53,
      hitRate: 0.7571428571428571,
      meanProbability: 0.6517061700259572,
      brier: 0.1997423583018825,
      logLoss: 0.5971321020589591,
      baselineBrierSameEvents: 0.3095935702694606,
      calibrationGap: 0.10543668711689991
    },
    "94": {
      interval: [
        0.6112816903971267,
        0.7855377076467428
      ],
      ece: 0.07342982506196287,
      n: 102,
      wins: 72,
      hitRate: 0.7058823529411765,
      meanProbability: 0.6584019074902937,
      brier: 0.20384059124106743,
      logLoss: 0.5958824031792885,
      baselineBrierSameEvents: 0.3085734870750937,
      calibrationGap: 0.04748044545088281
    },
    "135": {
      interval: [
        0.5946267078910946,
        0.7823594707184943
      ],
      ece: 0.19427313716520833,
      n: 89,
      wins: 62,
      hitRate: 0.6966292134831461,
      meanProbability: 0.5637198631934139,
      brier: 0.22303351659690443,
      logLoss: 0.6398840728880397,
      baselineBrierSameEvents: 0.32378506681949215,
      calibrationGap: 0.13290935028973216
    },
    "140": {
      interval: [
        0.5322034757513312,
        0.7181778743049083
      ],
      ece: 0.0927949265423037,
      n: 100,
      wins: 63,
      hitRate: 0.63,
      meanProbability: 0.5812741962731695,
      brier: 0.20951976538376266,
      logLoss: 0.6059925096754453,
      baselineBrierSameEvents: 0.2743616283078379,
      calibrationGap: 0.04872580372683055
    }
  }
};

// src/luxg-validation.json
var luxg_validation_default = {
  version: "luxg-1",
  activeModel: "opponent-adjusted Poisson",
  promoted: false,
  reason: "No candidate passed the development gate; holdout is reported without changing that decision.",
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477",
  protocol: {
    version: "luxg-1",
    data: "API-Football regulation-time results; no event xG or shots available locally",
    features: "Only completed matches at least two hours before 00:00 UTC of target match day; 3-year window",
    training: "Seasons 2023 and 2024; prequential features with minimum effective sample 12, matching production eligibility",
    development: "Season 2025; choose one candidate by joint score log loss, requiring >=0.005 improvement and no worse 1X2 Brier by more than 0.001",
    holdout: "Season 2026, never used for fitting/selection; evaluated once after candidate is locked",
    candidates: {
      panels: [
        "calibration",
        "strength",
        "context"
      ],
      ridge: [
        0.01,
        0.1,
        1
      ],
      correlation: [
        "independent",
        "fittedDixonColes"
      ]
    },
    tieBreak: "Prefer smallest panel and strongest regularization within 0.002 score log loss of development best",
    productionGate: "Holdout score log loss improvement >=0.005, week-block bootstrap 95% lower bound >0, 1X2 Brier no worse by 0.001, 1X2 log loss no worse by 0.002; otherwise retain current probabilities; goal MAE no worse by 0.01",
    bootstrap: {
      unit: "ISO-calendar-week UTC",
      draws: 2e3,
      seed: 20261018
    },
    restrictions: "No historical odds/ROI; no post-hoc edits after holdout; new generation available only as experimental if not promoted",
    developmentRevision: "Before opening 2026 holdout: align training sample eligibility with development/production. Initial sample>=5 experiment retained separately; no holdout scores used.",
    additionalDevelopment: "Before opening holdout, compare 9 proper joint-score exponential-family corrections (3 panels x 3 ridge strengths). Goals means are derived from the corrected joint distribution, not from rounded intensities."
  },
  trainMatches: 2940,
  developmentMatches: 1835,
  candidateCount: 45,
  baselineDevelopment: {
    n: 1835,
    scoreLogLoss: 2.887150385174171,
    brier1X2: 0.5899380614631244,
    logLoss1X2: 0.9902466943049921,
    accuracy1X2: 0.5313351498637602,
    ece1X2: 0.024721877029732088,
    exactScoreAccuracy: 0.12861035422343325,
    topThreeScoresAccuracy: 0.3237057220708447,
    goalMAE: 0.9004756905211441,
    goalMeanPredicted: [
      1.507973225140683,
      1.2535554835994354
    ],
    goalMeanObserved: [
      1.5291553133514986,
      1.228882833787466
    ],
    goalIntervalCoverage80: [
      0.9416893732970028,
      0.9493188010899183
    ]
  },
  holdout: {
    season: 2026,
    baseline: {
      n: 285,
      scoreLogLoss: 2.991191564430779,
      brier1X2: 0.577091731441316,
      logLoss1X2: 0.9720562948419895,
      accuracy1X2: 0.5263157894736842,
      ece1X2: 0.04568365735869852,
      exactScoreAccuracy: 0.10877192982456141,
      topThreeScoresAccuracy: 0.312280701754386,
      goalMAE: 0.9480138587825666,
      goalMeanPredicted: [
        1.5420711425418117,
        1.272269394917593
      ],
      goalMeanObserved: [
        1.6456140350877193,
        1.3508771929824561
      ],
      goalIntervalCoverage80: [
        0.9157894736842105,
        0.9298245614035088
      ]
    },
    experimental: {
      n: 285,
      scoreLogLoss: 2.977949085186124,
      brier1X2: 0.5711240994937731,
      logLoss1X2: 0.9627081060222094,
      accuracy1X2: 0.5298245614035088,
      ece1X2: 0.04841486817812654,
      exactScoreAccuracy: 0.12631578947368421,
      topThreeScoresAccuracy: 0.312280701754386,
      goalMAE: 0.945127906873754,
      goalMeanPredicted: [
        1.511320847953778,
        1.3165770912158115
      ],
      goalMeanObserved: [
        1.6456140350877193,
        1.3508771929824561
      ],
      goalIntervalCoverage80: [
        0.9192982456140351,
        0.9403508771929825
      ]
    },
    experimentalId: "strength-ridge0.1",
    scoreLogLossImprovement: 0.013242479244654623,
    weekBootstrap95: [
      0.005713673444122786,
      0.020187371399011184
    ],
    weeks: 9
  },
  byLeague: {
    "39": {
      baseline: {
        n: 46,
        scoreLogLoss: 3.0278714347484654,
        brier1X2: 0.6414260058031275,
        logLoss1X2: 1.0636602303564866,
        accuracy1X2: 0.43478260869565216,
        ece1X2: 0.061775631355087506,
        exactScoreAccuracy: 0.10869565217391304,
        topThreeScoresAccuracy: 0.2608695652173913,
        goalMAE: 0.9534214956058619,
        goalMeanPredicted: [
          1.5110131907040711,
          1.2830840481808041
        ],
        goalMeanObserved: [
          1.5217391304347827,
          1.3695652173913044
        ],
        goalIntervalCoverage80: [
          0.8695652173913043,
          0.9347826086956522
        ]
      },
      experimental: {
        n: 46,
        scoreLogLoss: 3.016654429692257,
        brier1X2: 0.6303869272872342,
        logLoss1X2: 1.048991987310164,
        accuracy1X2: 0.43478260869565216,
        ece1X2: 0.056672351640617576,
        exactScoreAccuracy: 0.10869565217391304,
        topThreeScoresAccuracy: 0.2608695652173913,
        goalMAE: 0.9517845771126069,
        goalMeanPredicted: [
          1.4987209769370424,
          1.3451048011679192
        ],
        goalMeanObserved: [
          1.5217391304347827,
          1.3695652173913044
        ],
        goalIntervalCoverage80: [
          0.8695652173913043,
          0.9782608695652174
        ]
      }
    },
    "61": {
      baseline: {
        n: 44,
        scoreLogLoss: 2.891915575162246,
        brier1X2: 0.6185217732293954,
        logLoss1X2: 1.0312837524331204,
        accuracy1X2: 0.5227272727272727,
        ece1X2: 0.1836317038586184,
        exactScoreAccuracy: 0.045454545454545456,
        topThreeScoresAccuracy: 0.36363636363636365,
        goalMAE: 0.8841227489469106,
        goalMeanPredicted: [
          1.5273766784476699,
          1.329924832853842
        ],
        goalMeanObserved: [
          1.6363636363636365,
          1.1818181818181819
        ],
        goalIntervalCoverage80: [
          0.9545454545454546,
          0.9772727272727273
        ]
      },
      experimental: {
        n: 44,
        scoreLogLoss: 2.8917479775607733,
        brier1X2: 0.6193340082846186,
        logLoss1X2: 1.0325138368185602,
        accuracy1X2: 0.5454545454545454,
        ece1X2: 0.15279322933521364,
        exactScoreAccuracy: 0.06818181818181818,
        topThreeScoresAccuracy: 0.3409090909090909,
        goalMAE: 0.8940453282935107,
        goalMeanPredicted: [
          1.564293948919431,
          1.4389533373190153
        ],
        goalMeanObserved: [
          1.6363636363636365,
          1.1818181818181819
        ],
        goalIntervalCoverage80: [
          0.9318181818181818,
          0.9772727272727273
        ]
      }
    },
    "78": {
      baseline: {
        n: 35,
        scoreLogLoss: 3.5069486223043436,
        brier1X2: 0.5709640326657534,
        logLoss1X2: 0.9583237703148325,
        accuracy1X2: 0.5714285714285714,
        ece1X2: 0.09632022678553105,
        exactScoreAccuracy: 0.05714285714285714,
        topThreeScoresAccuracy: 0.11428571428571428,
        goalMAE: 1.2240861777242709,
        goalMeanPredicted: [
          1.8966712790985651,
          1.4690055351113867
        ],
        goalMeanObserved: [
          2.6857142857142855,
          1.457142857142857
        ],
        goalIntervalCoverage80: [
          0.8285714285714286,
          0.8857142857142857
        ]
      },
      experimental: {
        n: 35,
        scoreLogLoss: 3.5126876426371463,
        brier1X2: 0.5791849894397808,
        logLoss1X2: 0.96781857745337,
        accuracy1X2: 0.5714285714285714,
        ece1X2: 0.14714066024565753,
        exactScoreAccuracy: 0.05714285714285714,
        topThreeScoresAccuracy: 0.14285714285714285,
        goalMAE: 1.2351492437170144,
        goalMeanPredicted: [
          1.8197889188973162,
          1.4757086910538615
        ],
        goalMeanObserved: [
          2.6857142857142855,
          1.457142857142857
        ],
        goalIntervalCoverage80: [
          0.8571428571428571,
          0.8857142857142857
        ]
      }
    },
    "94": {
      baseline: {
        n: 56,
        scoreLogLoss: 2.901117537997868,
        brier1X2: 0.5383827264864709,
        logLoss1X2: 0.9156768950715738,
        accuracy1X2: 0.5714285714285714,
        ece1X2: 0.10161902613753386,
        exactScoreAccuracy: 0.17857142857142858,
        topThreeScoresAccuracy: 0.39285714285714285,
        goalMAE: 0.9125466323954453,
        goalMeanPredicted: [
          1.503706953567626,
          1.1938551275839715
        ],
        goalMeanObserved: [
          1.3571428571428572,
          1.4107142857142858
        ],
        goalIntervalCoverage80: [
          0.9642857142857143,
          0.9107142857142857
        ]
      },
      experimental: {
        n: 56,
        scoreLogLoss: 2.866015575920789,
        brier1X2: 0.5320840490631815,
        logLoss1X2: 0.9032800264466211,
        accuracy1X2: 0.5535714285714286,
        ece1X2: 0.07905910772708169,
        exactScoreAccuracy: 0.19642857142857142,
        topThreeScoresAccuracy: 0.39285714285714285,
        goalMAE: 0.9051454495300533,
        goalMeanPredicted: [
          1.4830940739238152,
          1.2411188956924069
        ],
        goalMeanObserved: [
          1.3571428571428572,
          1.4107142857142858
        ],
        goalIntervalCoverage80: [
          0.9642857142857143,
          0.9107142857142857
        ]
      }
    },
    "135": {
      baseline: {
        n: 45,
        scoreLogLoss: 2.627483225233549,
        brier1X2: 0.5345040063625469,
        logLoss1X2: 0.9160222580415128,
        accuracy1X2: 0.5555555555555556,
        ece1X2: 0.19613912202360742,
        exactScoreAccuracy: 0.13333333333333333,
        topThreeScoresAccuracy: 0.4444444444444444,
        goalMAE: 0.6986309770607416,
        goalMeanPredicted: [
          1.3092811848507588,
          1.2051659679140974
        ],
        goalMeanObserved: [
          1.4444444444444444,
          1.2666666666666666
        ],
        goalIntervalCoverage80: [
          0.9333333333333333,
          0.9333333333333333
        ]
      },
      experimental: {
        n: 45,
        scoreLogLoss: 2.6186807220410393,
        brier1X2: 0.5257123642556965,
        logLoss1X2: 0.9020129057156013,
        accuracy1X2: 0.5555555555555556,
        ece1X2: 0.14746744366127285,
        exactScoreAccuracy: 0.17777777777777778,
        topThreeScoresAccuracy: 0.4444444444444444,
        goalMAE: 0.6932469028913636,
        goalMeanPredicted: [
          1.2834506652081967,
          1.2361371152902776
        ],
        goalMeanObserved: [
          1.4444444444444444,
          1.2666666666666666
        ],
        goalIntervalCoverage80: [
          0.9333333333333333,
          0.9555555555555556
        ]
      }
    },
    "140": {
      baseline: {
        n: 59,
        scoreLogLoss: 3.093571110392566,
        brier1X2: 0.5688938145572788,
        logLoss1X2: 0.9608635360951855,
        accuracy1X2: 0.5084745762711864,
        ece1X2: 0.08540522349793062,
        exactScoreAccuracy: 0.1016949152542373,
        topThreeScoresAccuracy: 0.2542372881355932,
        goalMAE: 1.0515447186316946,
        goalMeanPredicted: [
          1.5808535171832259,
          1.2297401569473334
        ],
        goalMeanObserved: [
          1.5593220338983051,
          1.4067796610169492
        ],
        goalIntervalCoverage80: [
          0.9152542372881356,
          0.9322033898305084
        ]
      },
      experimental: {
        n: 59,
        scoreLogLoss: 3.0751000383697717,
        brier1X2: 0.5558751790941102,
        logLoss1X2: 0.9430450428977072,
        accuracy1X2: 0.5254237288135594,
        ece1X2: 0.12400436289535591,
        exactScoreAccuracy: 0.11864406779661017,
        topThreeScoresAccuracy: 0.2542372881355932,
        goalMAE: 1.0360489683565373,
        goalMeanPredicted: [
          1.49924038541964,
          1.241645267237676
        ],
        goalMeanObserved: [
          1.5593220338983051,
          1.4067796610169492
        ],
        goalIntervalCoverage80: [
          0.9322033898305084,
          0.9322033898305084
        ]
      }
    }
  },
  limitations: [
    "Goal estimates from match results, not shot-based event xG.",
    "No historical odds: no ROI or betting advantage established.",
    "2026 season is incomplete; limited holdout size.",
    "Training and development experiments are retained; multiple testing limits evidence.",
    "Rolling team states only use matches available before each prediction cutoff."
  ]
};

// src/storage.js
async function saveFixtures(db, items, sourceAt, readBack = false) {
  if (!Number.isFinite(sourceAt) || sourceAt > Date.now())
    throw new Error("invalid_source_timestamp");
  const rows = items.map(normalize).filter(Boolean);
  for (let i = 0; i < rows.length; i += 50)
    await db.batch(
      rows.slice(i, i + 50).map(
        (f) => db.prepare(
          "INSERT INTO fixtures(id,league,kickoff,finished,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET league=excluded.league,kickoff=excluded.kickoff,finished=excluded.finished,data=excluded.data,updated_at=excluded.updated_at WHERE fixtures.updated_at<excluded.updated_at OR (fixtures.updated_at=excluded.updated_at AND fixtures.data<>excluded.data)"
        ).bind(
          f.id,
          f.league,
          f.ts,
          f.finished ? 1 : 0,
          JSON.stringify(f),
          sourceAt
        )
      )
    );
  if (!readBack || !rows.length) return rows;
  const current = [];
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r2) => r2.id);
    const r = await db.prepare(
      "SELECT data FROM fixtures WHERE id IN (" + ids.map(() => "?").join(",") + ")"
    ).bind(...ids).all();
    current.push(...r.results.map((r2) => JSON.parse(r2.data)));
  }
  return current;
}

// src/daily-market-research.json
var daily_market_research_default = {
  version: "daily-market-v1",
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477",
  protocol: {
    version: "daily-market-v1",
    dataStatus: "Retrospective development on seasons already observed; not an independent new holdout.",
    population: "Identical fixtures to current winner policy: at most three daily favorites with win probability >=0.5, same ordering and sample eligibility.",
    constraint: "At most ONE non-winner selection per Lisbon calendar day across all selected fixtures. All other picks remain outright winners; never add or drop a fixture to improve hit rate.",
    policies: [
      "winner-only",
      "draw-protection",
      "largest-probability-gain"
    ],
    "draw-protection": "Replace the winner with its same-side double chance on the selected fixture with largest draw probability.",
    "largest-probability-gain": "Consider same-side double chance, over/under 1.5/2.5/3.5, BTTS yes/no. Replace at most one selection by the market with largest raw probability increase. Ties prefer same-side double chance, then fixture ordering.",
    selection: "Select policy using preceding season hit rate; ties prefer winner-only then draw-protection. Use mixture weights available before the selection period, then refit weights on past seasons as in the locked winner protocol. Evaluate 2025 and 2026 without further tuning.",
    promotion: "Same fixture IDs/counts, <=1 alternative per day, positive paired day-bootstrap95 lower bound for hit-rate improvement, and nonnegative improvement in each outer fold. Do not claim 80% minimum from point estimates.",
    bootstrap: {
      draws: 2e3,
      seed: 20261020,
      unit: "Lisbon calendar day"
    },
    limitations: "Different market targets: hit-rate change is not a pure improvement in winner prediction. No historical odds or ROI. Existing API source delays not simulated. Freeze live daily market assignment before kickoff to prevent multiple alternatives as games finish."
  },
  folds: [
    {
      season: 2025,
      selected: "draw-protection",
      development: [
        {
          policy: "winner-only",
          metrics: {
            n: 387,
            wins: 272,
            hitRate: 0.7028423772609819,
            days: 167,
            alternatives: 0,
            meanProbability: 0.6686825245980077,
            brier: 0.1964802429420781,
            logLoss: 0.5788376636589406,
            byMarket: {
              H: {
                n: 293,
                wins: 210
              },
              A: {
                n: 94,
                wins: 62
              }
            }
          }
        },
        {
          policy: "draw-protection",
          metrics: {
            n: 387,
            wins: 312,
            hitRate: 0.8062015503875969,
            days: 167,
            alternatives: 167,
            meanProbability: 0.7602817448775832,
            brier: 0.15096994409744055,
            logLoss: 0.4740875369570365,
            byMarket: {
              H: {
                n: 174,
                wins: 135
              },
              A: {
                n: 46,
                wins: 35
              },
              HX: {
                n: 119,
                wins: 103
              },
              XA: {
                n: 48,
                wins: 39
              }
            }
          }
        },
        {
          policy: "largest-probability-gain",
          metrics: {
            n: 387,
            wins: 310,
            hitRate: 0.8010335917312662,
            days: 167,
            alternatives: 167,
            meanProbability: 0.7670275083811924,
            brier: 0.1495302990715368,
            logLoss: 0.47006841664369475,
            byMarket: {
              H: {
                n: 176,
                wins: 136
              },
              A: {
                n: 44,
                wins: 30
              },
              HX: {
                n: 75,
                wins: 66
              },
              XA: {
                n: 28,
                wins: 24
              },
              O15: {
                n: 55,
                wins: 45
              },
              U35: {
                n: 9,
                wins: 9
              }
            }
          }
        }
      ],
      baseline: {
        n: 388,
        wins: 280,
        hitRate: 0.7216494845360825,
        days: 164,
        alternatives: 0,
        meanProbability: 0.6604189226719737,
        brier: 0.20181956599390458,
        logLoss: 0.5931962635002623,
        byMarket: {
          H: {
            n: 291,
            wins: 213
          },
          A: {
            n: 97,
            wins: 67
          }
        }
      },
      candidate: {
        n: 388,
        wins: 310,
        hitRate: 0.7989690721649485,
        days: 164,
        alternatives: 164,
        meanProbability: 0.7520598111489063,
        brier: 0.1520741894129634,
        logLoss: 0.47564182778111375,
        byMarket: {
          H: {
            n: 177,
            wins: 132
          },
          A: {
            n: 47,
            wins: 30
          },
          HX: {
            n: 114,
            wins: 104
          },
          XA: {
            n: 50,
            wins: 44
          }
        }
      }
    },
    {
      season: 2026,
      selected: "draw-protection",
      development: [
        {
          policy: "winner-only",
          metrics: {
            n: 388,
            wins: 280,
            hitRate: 0.7216494845360825,
            days: 164,
            alternatives: 0,
            meanProbability: 0.6604189226719737,
            brier: 0.20181956599390458,
            logLoss: 0.5931962635002623,
            byMarket: {
              H: {
                n: 291,
                wins: 213
              },
              A: {
                n: 97,
                wins: 67
              }
            }
          }
        },
        {
          policy: "draw-protection",
          metrics: {
            n: 388,
            wins: 310,
            hitRate: 0.7989690721649485,
            days: 164,
            alternatives: 164,
            meanProbability: 0.7520598111489063,
            brier: 0.1520741894129634,
            logLoss: 0.47564182778111375,
            byMarket: {
              H: {
                n: 177,
                wins: 132
              },
              A: {
                n: 47,
                wins: 30
              },
              HX: {
                n: 114,
                wins: 104
              },
              XA: {
                n: 50,
                wins: 44
              }
            }
          }
        },
        {
          policy: "largest-probability-gain",
          metrics: {
            n: 388,
            wins: 306,
            hitRate: 0.788659793814433,
            days: 164,
            alternatives: 164,
            meanProbability: 0.7579879454625159,
            brier: 0.15929863011792833,
            logLoss: 0.49141007792674996,
            byMarket: {
              H: {
                n: 177,
                wins: 133
              },
              A: {
                n: 47,
                wins: 31
              },
              HX: {
                n: 77,
                wins: 72
              },
              XA: {
                n: 31,
                wins: 28
              },
              O15: {
                n: 49,
                wins: 38
              },
              U35: {
                n: 7,
                wins: 4
              }
            }
          }
        }
      ],
      baseline: {
        n: 71,
        wins: 55,
        hitRate: 0.7746478873239436,
        days: 35,
        alternatives: 0,
        meanProbability: 0.6451793334320284,
        brier: 0.1798544105975361,
        logLoss: 0.5458183060837515,
        byMarket: {
          H: {
            n: 54,
            wins: 42
          },
          A: {
            n: 17,
            wins: 13
          }
        }
      },
      candidate: {
        n: 71,
        wins: 58,
        hitRate: 0.8169014084507042,
        days: 35,
        alternatives: 35,
        meanProbability: 0.7514357948268858,
        brier: 0.15132532571265922,
        logLoss: 0.4744101486264443,
        byMarket: {
          H: {
            n: 29,
            wins: 24
          },
          A: {
            n: 7,
            wins: 6
          },
          HX: {
            n: 25,
            wins: 20
          },
          XA: {
            n: 10,
            wins: 8
          }
        }
      }
    }
  ],
  pooled: {
    baseline: {
      n: 459,
      wins: 335,
      hitRate: 0.7298474945533769,
      days: 199,
      alternatives: 0,
      meanProbability: 0.6580616005891065,
      brier: 0.19842190579098049,
      logLoss: 0.5858676469935689,
      byMarket: {
        H: {
          n: 345,
          wins: 255
        },
        A: {
          n: 114,
          wins: 80
        }
      }
    },
    candidate: {
      n: 459,
      wins: 368,
      hitRate: 0.8017429193899782,
      days: 199,
      alternatives: 199,
      meanProbability: 0.7519632857483324,
      brier: 0.15195835210855907,
      logLoss: 0.4754513066046834,
      byMarket: {
        H: {
          n: 206,
          wins: 156
        },
        A: {
          n: 54,
          wins: 36
        },
        HX: {
          n: 139,
          wins: 124
        },
        XA: {
          n: 60,
          wins: 52
        }
      }
    },
    pairedDayBootstrap95: [
      0.049783549783549784,
      0.09545671685002895
    ],
    hitRateDayBootstrap95: [
      0.7666647597254005,
      0.8348479666708121
    ]
  },
  promoted: true,
  activePolicy: "draw-protection"
};

// src/market-expansion-research.json
var market_expansion_research_default = {
  version: "market-expansion-v1",
  datasetHash: "70e5dae1441488c37a742a69ce3dc01a848f082da43b66dcda64271129027477",
  protocol: {
    version: "market-expansion-v1",
    status: "Retrospective development on previously inspected seasons; no independent new holdout",
    baseline: "Current daily-market-v1: top three outright favorites, replace at most one winner with its same-side double chance at maximum draw gain",
    marketSets: [
      "draw",
      "standard",
      "team-goals",
      "broad-goals"
    ],
    draw: "Same-side double chance",
    standard: "Same-side double chance plus over/under 1.5, 2.5, 3.5 total goals and both teams to score yes/no",
    "team-goals": "standard plus favorite team over 0.5 and over 1.5 goals; no arbitrary extreme goal lines",
    listPolicies: [
      {
        cap: 3,
        extraMinProbability: 0.5
      },
      {
        cap: 4,
        extraMinProbability: 0.65
      },
      {
        cap: 4,
        extraMinProbability: 0.7
      },
      {
        cap: 4,
        extraMinProbability: 0.75
      },
      {
        cap: 5,
        extraMinProbability: 0.65
      },
      {
        cap: 5,
        extraMinProbability: 0.7
      },
      {
        cap: 5,
        extraMinProbability: 0.75
      }
    ],
    selection: "28 fixed policies. Select by preceding-season hit rate only; ties prefer fewer games then fewer market families. Original top three always retained. Extra fixtures require the fixed winner-probability threshold. At most one alternative market across the entire Lisbon calendar day, chosen by maximum probability gain. Use the existing frozen chronological mixture weights, trained before each development/test season.",
    evaluation: "Nested previous-season selection, outer 2025 and 2026. Compare rates on shared calendar days, preserving all baseline fixtures. Cluster paired bootstrap by day, 2000 draws, seed 20261021. Also report added games separately, per market and league, Brier and Log Loss for the selected event.",
    promotion: "Positive lower 95% paired day-bootstrap bound for hit-rate change, no deterioration in either outer fold, and at least as many games in each fold. Runtime policy is the policy selected using 2025 before 2026. Count increase must have separate positive evidence versus cap=3 using the same new market family, otherwise retain cap=3.",
    limitations: "Different markets cover different events and have different odds. Higher hit rate alone is not better winner prediction or profitability. No adequate historical odds, no ROI. Live API delays, intraday ranking changes and frozen reservations not simulated. Repeated research on already inspected seasons limits statistical evidence. Corners/cards/handicaps with pushes excluded: no validated event data or comparable settlement metrics. No 80% minimum guarantee.",
    "broad-goals": "team-goals plus over 0.5 / under 4.5 total goals, either team under 1.5 / under 2.5 goals, and favorite Asian handicap +1.5 (no push). Broader events can have very low odds; do not equate accuracy with value."
  },
  folds: [
    {
      season: 2025,
      selected: {
        id: "broad-goals-4-0.75",
        markets: "broad-goals",
        cap: 4,
        extraMinProbability: 0.75
      },
      development: [
        {
          policy: {
            id: "draw-3-0.5",
            markets: "draw",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 387,
            wins: 312,
            hitRate: 0.8062015503875969,
            meanProbability: 0.7602817448775832,
            brier: 0.15096994409744055,
            logLoss: 0.4740875369570365,
            alternatives: 167,
            byMarket: {
              H: {
                n: 174,
                wins: 135
              },
              A: {
                n: 46,
                wins: 35
              },
              HX: {
                n: 119,
                wins: 103
              },
              XA: {
                n: 48,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 58
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 54,
                wins: 42
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 68,
                wins: 51
              },
              "140": {
                n: 72,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "standard-3-0.5",
            markets: "standard",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 387,
            wins: 310,
            hitRate: 0.8010335917312662,
            meanProbability: 0.7670275083811924,
            brier: 0.1495302990715368,
            logLoss: 0.47006841664369475,
            alternatives: 167,
            byMarket: {
              H: {
                n: 176,
                wins: 136
              },
              A: {
                n: 44,
                wins: 30
              },
              HX: {
                n: 75,
                wins: 66
              },
              XA: {
                n: 28,
                wins: 24
              },
              O15: {
                n: 55,
                wins: 45
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 58
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 54,
                wins: 45
              },
              "94": {
                n: 72,
                wins: 57
              },
              "135": {
                n: 68,
                wins: 49
              },
              "140": {
                n: 72,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-3-0.5",
            markets: "team-goals",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 387,
            wins: 317,
            hitRate: 0.8191214470284238,
            meanProbability: 0.7774612756459857,
            brier: 0.13481894031309527,
            logLoss: 0.4313066462000799,
            alternatives: 167,
            byMarket: {
              H: {
                n: 174,
                wins: 131
              },
              A: {
                n: 46,
                wins: 33
              },
              HX: {
                n: 14,
                wins: 13
              },
              XA: {
                n: 4,
                wins: 4
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 101,
                wins: 93
              },
              AO05: {
                n: 41,
                wins: 36
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 59
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 54,
                wins: 46
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 68,
                wins: 52
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-3-0.5",
            markets: "broad-goals",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 387,
            wins: 329,
            hitRate: 0.8501291989664083,
            meanProbability: 0.8161023632784135,
            brier: 0.10957413779232214,
            logLoss: 0.35142231539878466,
            alternatives: 167,
            byMarket: {
              H: {
                n: 176,
                wins: 135
              },
              A: {
                n: 44,
                wins: 30
              },
              O05: {
                n: 86,
                wins: 84
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 21,
                wins: 20
              },
              HAP15: {
                n: 36,
                wins: 36
              },
              AAP15: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 63
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 54,
                wins: 43
              },
              "94": {
                n: 72,
                wins: 63
              },
              "135": {
                n: 68,
                wins: 57
              },
              "140": {
                n: 72,
                wins: 65
              }
            }
          }
        },
        {
          policy: {
            id: "draw-4-0.65",
            markets: "draw",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 411,
            wins: 327,
            hitRate: 0.7956204379562044,
            meanProbability: 0.7566911061465772,
            brier: 0.1573872188759385,
            logLoss: 0.4900342596660047,
            alternatives: 167,
            byMarket: {
              H: {
                n: 189,
                wins: 143
              },
              A: {
                n: 55,
                wins: 43
              },
              HX: {
                n: 121,
                wins: 104
              },
              XA: {
                n: 46,
                wins: 37
              }
            },
            byLeague: {
              "39": {
                n: 80,
                wins: 61
              },
              "61": {
                n: 52,
                wins: 42
              },
              "78": {
                n: 58,
                wins: 44
              },
              "94": {
                n: 74,
                wins: 62
              },
              "135": {
                n: 74,
                wins: 56
              },
              "140": {
                n: 73,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "standard-4-0.65",
            markets: "standard",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 411,
            wins: 328,
            hitRate: 0.7980535279805353,
            meanProbability: 0.7629611316221545,
            brier: 0.1520486973831123,
            logLoss: 0.4770073691809083,
            alternatives: 167,
            byMarket: {
              H: {
                n: 191,
                wins: 146
              },
              A: {
                n: 53,
                wins: 38
              },
              HX: {
                n: 76,
                wins: 66
              },
              XA: {
                n: 27,
                wins: 23
              },
              O15: {
                n: 55,
                wins: 46
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 80,
                wins: 62
              },
              "61": {
                n: 52,
                wins: 42
              },
              "78": {
                n: 58,
                wins: 48
              },
              "94": {
                n: 74,
                wins: 59
              },
              "135": {
                n: 74,
                wins: 54
              },
              "140": {
                n: 73,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-4-0.65",
            markets: "team-goals",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 411,
            wins: 334,
            hitRate: 0.8126520681265207,
            meanProbability: 0.7730401028308661,
            brier: 0.1420828361869713,
            logLoss: 0.4528987599406311,
            alternatives: 167,
            byMarket: {
              H: {
                n: 193,
                wins: 147
              },
              A: {
                n: 51,
                wins: 37
              },
              HX: {
                n: 12,
                wins: 11
              },
              XA: {
                n: 5,
                wins: 5
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 101,
                wins: 91
              },
              AO05: {
                n: 42,
                wins: 36
              }
            },
            byLeague: {
              "39": {
                n: 80,
                wins: 64
              },
              "61": {
                n: 52,
                wins: 42
              },
              "78": {
                n: 58,
                wins: 49
              },
              "94": {
                n: 74,
                wins: 62
              },
              "135": {
                n: 74,
                wins: 55
              },
              "140": {
                n: 73,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-4-0.65",
            markets: "broad-goals",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 411,
            wins: 346,
            hitRate: 0.8418491484184915,
            meanProbability: 0.8095098971134638,
            brier: 0.11626437031161267,
            logLoss: 0.37201683261719537,
            alternatives: 167,
            byMarket: {
              H: {
                n: 188,
                wins: 143
              },
              A: {
                n: 56,
                wins: 40
              },
              O05: {
                n: 88,
                wins: 85
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 22,
                wins: 21
              },
              HAP15: {
                n: 34,
                wins: 34
              },
              AAP15: {
                n: 8,
                wins: 8
              }
            },
            byLeague: {
              "39": {
                n: 80,
                wins: 67
              },
              "61": {
                n: 52,
                wins: 42
              },
              "78": {
                n: 58,
                wins: 47
              },
              "94": {
                n: 74,
                wins: 65
              },
              "135": {
                n: 74,
                wins: 60
              },
              "140": {
                n: 73,
                wins: 65
              }
            }
          }
        },
        {
          policy: {
            id: "draw-4-0.7",
            markets: "draw",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 395,
            wins: 316,
            hitRate: 0.8,
            meanProbability: 0.7597127774481215,
            brier: 0.15457752758860735,
            logLoss: 0.48335624590797693,
            alternatives: 167,
            byMarket: {
              H: {
                n: 179,
                wins: 137
              },
              A: {
                n: 49,
                wins: 38
              },
              HX: {
                n: 120,
                wins: 103
              },
              XA: {
                n: 47,
                wins: 38
              }
            },
            byLeague: {
              "39": {
                n: 74,
                wins: 58
              },
              "61": {
                n: 49,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 43
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 71,
                wins: 54
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "standard-4-0.7",
            markets: "standard",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 395,
            wins: 316,
            hitRate: 0.8,
            meanProbability: 0.7662811731142949,
            brier: 0.15108416664226818,
            logLoss: 0.47501125076647926,
            alternatives: 167,
            byMarket: {
              H: {
                n: 181,
                wins: 140
              },
              A: {
                n: 47,
                wins: 33
              },
              HX: {
                n: 76,
                wins: 66
              },
              XA: {
                n: 27,
                wins: 23
              },
              O15: {
                n: 55,
                wins: 45
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 74,
                wins: 59
              },
              "61": {
                n: 49,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 47
              },
              "94": {
                n: 72,
                wins: 57
              },
              "135": {
                n: 71,
                wins: 52
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-4-0.7",
            markets: "team-goals",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 395,
            wins: 322,
            hitRate: 0.8151898734177215,
            meanProbability: 0.776649592178705,
            brier: 0.13893547429966036,
            logLoss: 0.4442684705939078,
            alternatives: 167,
            byMarket: {
              H: {
                n: 179,
                wins: 136
              },
              A: {
                n: 49,
                wins: 35
              },
              HX: {
                n: 13,
                wins: 12
              },
              XA: {
                n: 4,
                wins: 4
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 103,
                wins: 93
              },
              AO05: {
                n: 40,
                wins: 35
              }
            },
            byLeague: {
              "39": {
                n: 74,
                wins: 60
              },
              "61": {
                n: 49,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 48
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 71,
                wins: 53
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-4-0.7",
            markets: "broad-goals",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 395,
            wins: 335,
            hitRate: 0.8481012658227848,
            meanProbability: 0.814461101977306,
            brier: 0.11219622071667505,
            logLoss: 0.3615570938178209,
            alternatives: 167,
            byMarket: {
              H: {
                n: 179,
                wins: 138
              },
              A: {
                n: 49,
                wins: 34
              },
              O05: {
                n: 88,
                wins: 85
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 21,
                wins: 20
              },
              HAP15: {
                n: 36,
                wins: 36
              },
              AAP15: {
                n: 7,
                wins: 7
              }
            },
            byLeague: {
              "39": {
                n: 74,
                wins: 64
              },
              "61": {
                n: 49,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 46
              },
              "94": {
                n: 72,
                wins: 63
              },
              "135": {
                n: 71,
                wins: 58
              },
              "140": {
                n: 72,
                wins: 65
              }
            }
          }
        },
        {
          policy: {
            id: "draw-4-0.75",
            markets: "draw",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 312,
            hitRate: 0.8041237113402062,
            meanProbability: 0.760337790358059,
            brier: 0.15280249694072726,
            logLoss: 0.47947866661212857,
            alternatives: 167,
            byMarket: {
              H: {
                n: 175,
                wins: 136
              },
              A: {
                n: 46,
                wins: 35
              },
              HX: {
                n: 119,
                wins: 102
              },
              XA: {
                n: 48,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 58
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 42
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 68,
                wins: 51
              },
              "140": {
                n: 72,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "standard-4-0.75",
            markets: "standard",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 310,
            hitRate: 0.7989690721649485,
            meanProbability: 0.7670661678732567,
            brier: 0.151366562340148,
            logLoss: 0.4754699048562955,
            alternatives: 167,
            byMarket: {
              H: {
                n: 177,
                wins: 137
              },
              A: {
                n: 44,
                wins: 30
              },
              HX: {
                n: 75,
                wins: 65
              },
              XA: {
                n: 28,
                wins: 24
              },
              O15: {
                n: 55,
                wins: 45
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 58
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 45
              },
              "94": {
                n: 72,
                wins: 57
              },
              "135": {
                n: 68,
                wins: 49
              },
              "140": {
                n: 72,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-4-0.75",
            markets: "team-goals",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 317,
            hitRate: 0.8170103092783505,
            meanProbability: 0.7775488484360442,
            brier: 0.13683345330723254,
            logLoss: 0.43784093980448924,
            alternatives: 167,
            byMarket: {
              H: {
                n: 175,
                wins: 132
              },
              A: {
                n: 46,
                wins: 33
              },
              HX: {
                n: 13,
                wins: 12
              },
              XA: {
                n: 4,
                wins: 4
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 102,
                wins: 93
              },
              AO05: {
                n: 41,
                wins: 36
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 59
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 46
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 68,
                wins: 52
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-4-0.75",
            markets: "broad-goals",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 330,
            hitRate: 0.8505154639175257,
            meanProbability: 0.8160594481085536,
            brier: 0.10938530621102345,
            logLoss: 0.3510870826779878,
            alternatives: 167,
            byMarket: {
              H: {
                n: 177,
                wins: 136
              },
              A: {
                n: 44,
                wins: 30
              },
              O05: {
                n: 87,
                wins: 85
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 21,
                wins: 20
              },
              HAP15: {
                n: 35,
                wins: 35
              },
              AAP15: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 63
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 44
              },
              "94": {
                n: 72,
                wins: 63
              },
              "135": {
                n: 68,
                wins: 57
              },
              "140": {
                n: 72,
                wins: 65
              }
            }
          }
        },
        {
          policy: {
            id: "draw-5-0.65",
            markets: "draw",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 424,
            wins: 336,
            hitRate: 0.7924528301886793,
            meanProbability: 0.754678392378378,
            brier: 0.15874987562849663,
            logLoss: 0.49215903476821465,
            alternatives: 167,
            byMarket: {
              H: {
                n: 199,
                wins: 149
              },
              A: {
                n: 58,
                wins: 45
              },
              HX: {
                n: 121,
                wins: 105
              },
              XA: {
                n: 46,
                wins: 37
              }
            },
            byLeague: {
              "39": {
                n: 82,
                wins: 63
              },
              "61": {
                n: 53,
                wins: 42
              },
              "78": {
                n: 61,
                wins: 46
              },
              "94": {
                n: 76,
                wins: 64
              },
              "135": {
                n: 76,
                wins: 56
              },
              "140": {
                n: 76,
                wins: 65
              }
            }
          }
        },
        {
          policy: {
            id: "standard-5-0.65",
            markets: "standard",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 424,
            wins: 335,
            hitRate: 0.7900943396226415,
            meanProbability: 0.7607929369880916,
            brier: 0.1551975124503969,
            logLoss: 0.4829227410200799,
            alternatives: 167,
            byMarket: {
              H: {
                n: 202,
                wins: 151
              },
              A: {
                n: 55,
                wins: 39
              },
              HX: {
                n: 73,
                wins: 64
              },
              XA: {
                n: 28,
                wins: 24
              },
              O15: {
                n: 57,
                wins: 48
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 82,
                wins: 63
              },
              "61": {
                n: 53,
                wins: 42
              },
              "78": {
                n: 61,
                wins: 49
              },
              "94": {
                n: 76,
                wins: 61
              },
              "135": {
                n: 76,
                wins: 54
              },
              "140": {
                n: 76,
                wins: 66
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-5-0.65",
            markets: "team-goals",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 424,
            wins: 344,
            hitRate: 0.8113207547169812,
            meanProbability: 0.7704993923929435,
            brier: 0.14145154120558098,
            logLoss: 0.4486273913952879,
            alternatives: 167,
            byMarket: {
              H: {
                n: 202,
                wins: 151
              },
              A: {
                n: 55,
                wins: 41
              },
              HX: {
                n: 14,
                wins: 13
              },
              XA: {
                n: 5,
                wins: 5
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 100,
                wins: 92
              },
              AO05: {
                n: 41,
                wins: 35
              }
            },
            byLeague: {
              "39": {
                n: 82,
                wins: 65
              },
              "61": {
                n: 53,
                wins: 43
              },
              "78": {
                n: 61,
                wins: 51
              },
              "94": {
                n: 76,
                wins: 64
              },
              "135": {
                n: 76,
                wins: 57
              },
              "140": {
                n: 76,
                wins: 64
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-5-0.65",
            markets: "broad-goals",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 424,
            wins: 353,
            hitRate: 0.8325471698113207,
            meanProbability: 0.8061671898969651,
            brier: 0.12013502800916291,
            logLoss: 0.3781136039131193,
            alternatives: 167,
            byMarket: {
              H: {
                n: 201,
                wins: 149
              },
              A: {
                n: 56,
                wins: 40
              },
              O05: {
                n: 89,
                wins: 87
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 24,
                wins: 23
              },
              HAP15: {
                n: 30,
                wins: 30
              },
              AAP15: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 82,
                wins: 67
              },
              "61": {
                n: 53,
                wins: 42
              },
              "78": {
                n: 61,
                wins: 48
              },
              "94": {
                n: 76,
                wins: 67
              },
              "135": {
                n: 76,
                wins: 62
              },
              "140": {
                n: 76,
                wins: 67
              }
            }
          }
        },
        {
          policy: {
            id: "draw-5-0.7",
            markets: "draw",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 398,
            wins: 318,
            hitRate: 0.7989949748743719,
            meanProbability: 0.7595595937162366,
            brier: 0.1544230686712919,
            logLoss: 0.4818133860407282,
            alternatives: 167,
            byMarket: {
              H: {
                n: 181,
                wins: 137
              },
              A: {
                n: 50,
                wins: 39
              },
              HX: {
                n: 120,
                wins: 104
              },
              XA: {
                n: 47,
                wins: 38
              }
            },
            byLeague: {
              "39": {
                n: 75,
                wins: 59
              },
              "61": {
                n: 50,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 43
              },
              "94": {
                n: 73,
                wins: 61
              },
              "135": {
                n: 71,
                wins: 54
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "standard-5-0.7",
            markets: "standard",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 398,
            wins: 318,
            hitRate: 0.7989949748743719,
            meanProbability: 0.7660475185290352,
            brier: 0.15096465362305686,
            logLoss: 0.47356737153333384,
            alternatives: 167,
            byMarket: {
              H: {
                n: 184,
                wins: 141
              },
              A: {
                n: 47,
                wins: 33
              },
              HX: {
                n: 75,
                wins: 66
              },
              XA: {
                n: 28,
                wins: 24
              },
              O15: {
                n: 55,
                wins: 45
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 75,
                wins: 60
              },
              "61": {
                n: 50,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 47
              },
              "94": {
                n: 73,
                wins: 58
              },
              "135": {
                n: 71,
                wins: 52
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-5-0.7",
            markets: "team-goals",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 398,
            wins: 325,
            hitRate: 0.8165829145728644,
            meanProbability: 0.7762594802007747,
            brier: 0.13759217734498128,
            logLoss: 0.43949307167650703,
            alternatives: 167,
            byMarket: {
              H: {
                n: 181,
                wins: 137
              },
              A: {
                n: 50,
                wins: 36
              },
              HX: {
                n: 14,
                wins: 13
              },
              XA: {
                n: 4,
                wins: 4
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 102,
                wins: 93
              },
              AO05: {
                n: 40,
                wins: 35
              }
            },
            byLeague: {
              "39": {
                n: 75,
                wins: 61
              },
              "61": {
                n: 50,
                wins: 40
              },
              "78": {
                n: 57,
                wins: 48
              },
              "94": {
                n: 73,
                wins: 61
              },
              "135": {
                n: 71,
                wins: 53
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-5-0.7",
            markets: "broad-goals",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 398,
            wins: 336,
            hitRate: 0.8442211055276382,
            meanProbability: 0.8138899184352506,
            brier: 0.11442956616274563,
            logLoss: 0.3667815279973827,
            alternatives: 167,
            byMarket: {
              H: {
                n: 182,
                wins: 139
              },
              A: {
                n: 49,
                wins: 34
              },
              O05: {
                n: 87,
                wins: 84
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 21,
                wins: 20
              },
              HAP15: {
                n: 36,
                wins: 36
              },
              AAP15: {
                n: 8,
                wins: 8
              }
            },
            byLeague: {
              "39": {
                n: 75,
                wins: 65
              },
              "61": {
                n: 50,
                wins: 39
              },
              "78": {
                n: 57,
                wins: 45
              },
              "94": {
                n: 73,
                wins: 64
              },
              "135": {
                n: 71,
                wins: 58
              },
              "140": {
                n: 72,
                wins: 65
              }
            }
          }
        },
        {
          policy: {
            id: "draw-5-0.75",
            markets: "draw",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 312,
            hitRate: 0.8041237113402062,
            meanProbability: 0.760337790358059,
            brier: 0.15280249694072726,
            logLoss: 0.47947866661212857,
            alternatives: 167,
            byMarket: {
              H: {
                n: 175,
                wins: 136
              },
              A: {
                n: 46,
                wins: 35
              },
              HX: {
                n: 119,
                wins: 102
              },
              XA: {
                n: 48,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 58
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 42
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 68,
                wins: 51
              },
              "140": {
                n: 72,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "standard-5-0.75",
            markets: "standard",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 310,
            hitRate: 0.7989690721649485,
            meanProbability: 0.7670661678732567,
            brier: 0.151366562340148,
            logLoss: 0.4754699048562955,
            alternatives: 167,
            byMarket: {
              H: {
                n: 177,
                wins: 137
              },
              A: {
                n: 44,
                wins: 30
              },
              HX: {
                n: 75,
                wins: 65
              },
              XA: {
                n: 28,
                wins: 24
              },
              O15: {
                n: 55,
                wins: 45
              },
              U35: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 58
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 45
              },
              "94": {
                n: 72,
                wins: 57
              },
              "135": {
                n: 68,
                wins: 49
              },
              "140": {
                n: 72,
                wins: 63
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-5-0.75",
            markets: "team-goals",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 317,
            hitRate: 0.8170103092783505,
            meanProbability: 0.7775488484360442,
            brier: 0.13683345330723254,
            logLoss: 0.43784093980448924,
            alternatives: 167,
            byMarket: {
              H: {
                n: 175,
                wins: 132
              },
              A: {
                n: 46,
                wins: 33
              },
              HX: {
                n: 13,
                wins: 12
              },
              XA: {
                n: 4,
                wins: 4
              },
              U35: {
                n: 7,
                wins: 7
              },
              HO05: {
                n: 102,
                wins: 93
              },
              AO05: {
                n: 41,
                wins: 36
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 59
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 46
              },
              "94": {
                n: 72,
                wins: 60
              },
              "135": {
                n: 68,
                wins: 52
              },
              "140": {
                n: 72,
                wins: 62
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-5-0.75",
            markets: "broad-goals",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 330,
            hitRate: 0.8505154639175257,
            meanProbability: 0.8160594481085536,
            brier: 0.10938530621102345,
            logLoss: 0.3510870826779878,
            alternatives: 167,
            byMarket: {
              H: {
                n: 177,
                wins: 136
              },
              A: {
                n: 44,
                wins: 30
              },
              O05: {
                n: 87,
                wins: 85
              },
              HU25: {
                n: 15,
                wins: 15
              },
              AU25: {
                n: 21,
                wins: 20
              },
              HAP15: {
                n: 35,
                wins: 35
              },
              AAP15: {
                n: 9,
                wins: 9
              }
            },
            byLeague: {
              "39": {
                n: 73,
                wins: 63
              },
              "61": {
                n: 48,
                wins: 38
              },
              "78": {
                n: 55,
                wins: 44
              },
              "94": {
                n: 72,
                wins: 63
              },
              "135": {
                n: 68,
                wins: 57
              },
              "140": {
                n: 72,
                wins: 65
              }
            }
          }
        }
      ],
      baseline: {
        n: 388,
        wins: 310,
        hitRate: 0.7989690721649485,
        meanProbability: 0.7520598111489063,
        brier: 0.1520741894129634,
        logLoss: 0.47564182778111375,
        alternatives: 164,
        byMarket: {
          H: {
            n: 177,
            wins: 132
          },
          A: {
            n: 47,
            wins: 30
          },
          HX: {
            n: 114,
            wins: 104
          },
          XA: {
            n: 50,
            wins: 44
          }
        },
        byLeague: {
          "39": {
            n: 62,
            wins: 46
          },
          "61": {
            n: 42,
            wins: 34
          },
          "78": {
            n: 59,
            wins: 47
          },
          "94": {
            n: 91,
            wins: 73
          },
          "135": {
            n: 71,
            wins: 58
          },
          "140": {
            n: 63,
            wins: 52
          }
        }
      },
      candidate: {
        n: 388,
        wins: 325,
        hitRate: 0.8376288659793815,
        meanProbability: 0.8080040835307383,
        brier: 0.12579084073361482,
        logLoss: 0.39770550157710094,
        alternatives: 164,
        byMarket: {
          H: {
            n: 178,
            wins: 135
          },
          A: {
            n: 46,
            wins: 33
          },
          O05: {
            n: 80,
            wins: 75
          },
          HU25: {
            n: 15,
            wins: 14
          },
          AU25: {
            n: 33,
            wins: 33
          },
          HAP15: {
            n: 26,
            wins: 25
          },
          AAP15: {
            n: 10,
            wins: 10
          }
        },
        byLeague: {
          "39": {
            n: 62,
            wins: 49
          },
          "61": {
            n: 42,
            wins: 36
          },
          "78": {
            n: 59,
            wins: 50
          },
          "94": {
            n: 91,
            wins: 74
          },
          "135": {
            n: 71,
            wins: 59
          },
          "140": {
            n: 63,
            wins: 57
          }
        }
      },
      pairedDayBootstrap95: [
        0.012950046499269344,
        0.06521881030763997
      ],
      hitRateDayBootstrap95: [
        0.803030303030303,
        0.8703291701874789
      ],
      days: 164,
      sameMarketCap3: {
        n: 388,
        wins: 325,
        hitRate: 0.8376288659793815,
        meanProbability: 0.8080040835307383,
        brier: 0.12579084073361482,
        logLoss: 0.39770550157710094,
        alternatives: 164,
        byMarket: {
          H: {
            n: 178,
            wins: 135
          },
          A: {
            n: 46,
            wins: 33
          },
          O05: {
            n: 80,
            wins: 75
          },
          HU25: {
            n: 15,
            wins: 14
          },
          AU25: {
            n: 33,
            wins: 33
          },
          HAP15: {
            n: 26,
            wins: 25
          },
          AAP15: {
            n: 10,
            wins: 10
          }
        },
        byLeague: {
          "39": {
            n: 62,
            wins: 49
          },
          "61": {
            n: 42,
            wins: 36
          },
          "78": {
            n: 59,
            wins: 50
          },
          "94": {
            n: 91,
            wins: 74
          },
          "135": {
            n: 71,
            wins: 59
          },
          "140": {
            n: 63,
            wins: 57
          }
        }
      },
      extraGames: {
        n: 0,
        wins: 0,
        hitRate: null
      }
    },
    {
      season: 2026,
      selected: {
        id: "broad-goals-3-0.5",
        markets: "broad-goals",
        cap: 3,
        extraMinProbability: 0.5
      },
      development: [
        {
          policy: {
            id: "draw-3-0.5",
            markets: "draw",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 388,
            wins: 310,
            hitRate: 0.7989690721649485,
            meanProbability: 0.7520598111489063,
            brier: 0.1520741894129634,
            logLoss: 0.47564182778111375,
            alternatives: 164,
            byMarket: {
              H: {
                n: 177,
                wins: 132
              },
              A: {
                n: 47,
                wins: 30
              },
              HX: {
                n: 114,
                wins: 104
              },
              XA: {
                n: 50,
                wins: 44
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 46
              },
              "61": {
                n: 42,
                wins: 34
              },
              "78": {
                n: 59,
                wins: 47
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 71,
                wins: 58
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "standard-3-0.5",
            markets: "standard",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 388,
            wins: 306,
            hitRate: 0.788659793814433,
            meanProbability: 0.7579879454625159,
            brier: 0.15929863011792833,
            logLoss: 0.49141007792674996,
            alternatives: 164,
            byMarket: {
              H: {
                n: 177,
                wins: 133
              },
              A: {
                n: 47,
                wins: 31
              },
              HX: {
                n: 77,
                wins: 72
              },
              XA: {
                n: 31,
                wins: 28
              },
              O15: {
                n: 49,
                wins: 38
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 42,
                wins: 33
              },
              "78": {
                n: 59,
                wins: 48
              },
              "94": {
                n: 91,
                wins: 72
              },
              "135": {
                n: 71,
                wins: 56
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-3-0.5",
            markets: "team-goals",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 388,
            wins: 318,
            hitRate: 0.8195876288659794,
            meanProbability: 0.7680040809442735,
            brier: 0.14355474832130685,
            logLoss: 0.4545359031738353,
            alternatives: 164,
            byMarket: {
              H: {
                n: 175,
                wins: 134
              },
              A: {
                n: 49,
                wins: 35
              },
              HX: {
                n: 24,
                wins: 23
              },
              XA: {
                n: 3,
                wins: 2
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 81
              },
              AO05: {
                n: 44,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 42,
                wins: 38
              },
              "78": {
                n: 59,
                wins: 50
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 71,
                wins: 57
              },
              "140": {
                n: 63,
                wins: 55
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-3-0.5",
            markets: "broad-goals",
            cap: 3,
            extraMinProbability: 0.5
          },
          metrics: {
            n: 388,
            wins: 325,
            hitRate: 0.8376288659793815,
            meanProbability: 0.8080040835307383,
            brier: 0.12579084073361482,
            logLoss: 0.39770550157710094,
            alternatives: 164,
            byMarket: {
              H: {
                n: 178,
                wins: 135
              },
              A: {
                n: 46,
                wins: 33
              },
              O05: {
                n: 80,
                wins: 75
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 33,
                wins: 33
              },
              HAP15: {
                n: 26,
                wins: 25
              },
              AAP15: {
                n: 10,
                wins: 10
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 49
              },
              "61": {
                n: 42,
                wins: 36
              },
              "78": {
                n: 59,
                wins: 50
              },
              "94": {
                n: 91,
                wins: 74
              },
              "135": {
                n: 71,
                wins: 59
              },
              "140": {
                n: 63,
                wins: 57
              }
            }
          }
        },
        {
          policy: {
            id: "draw-4-0.65",
            markets: "draw",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 400,
            wins: 318,
            hitRate: 0.795,
            meanProbability: 0.7505291806682635,
            brier: 0.1547900697525196,
            logLoss: 0.4826846297261625,
            alternatives: 164,
            byMarket: {
              H: {
                n: 187,
                wins: 139
              },
              A: {
                n: 49,
                wins: 32
              },
              HX: {
                n: 112,
                wins: 101
              },
              XA: {
                n: 52,
                wins: 46
              }
            },
            byLeague: {
              "39": {
                n: 64,
                wins: 46
              },
              "61": {
                n: 44,
                wins: 35
              },
              "78": {
                n: 63,
                wins: 51
              },
              "94": {
                n: 92,
                wins: 73
              },
              "135": {
                n: 73,
                wins: 60
              },
              "140": {
                n: 64,
                wins: 53
              }
            }
          }
        },
        {
          policy: {
            id: "standard-4-0.65",
            markets: "standard",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 400,
            wins: 312,
            hitRate: 0.78,
            meanProbability: 0.7563720270197217,
            brier: 0.16536407685763393,
            logLoss: 0.5071298917834492,
            alternatives: 164,
            byMarket: {
              H: {
                n: 186,
                wins: 139
              },
              A: {
                n: 50,
                wins: 34
              },
              HX: {
                n: 75,
                wins: 69
              },
              XA: {
                n: 32,
                wins: 29
              },
              O15: {
                n: 50,
                wins: 37
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 64,
                wins: 45
              },
              "61": {
                n: 44,
                wins: 34
              },
              "78": {
                n: 63,
                wins: 50
              },
              "94": {
                n: 92,
                wins: 72
              },
              "135": {
                n: 73,
                wins: 58
              },
              "140": {
                n: 64,
                wins: 53
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-4-0.65",
            markets: "team-goals",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 400,
            wins: 327,
            hitRate: 0.8175,
            meanProbability: 0.766371577391779,
            brier: 0.14558869428558996,
            logLoss: 0.46102242796658294,
            alternatives: 164,
            byMarket: {
              H: {
                n: 185,
                wins: 142
              },
              A: {
                n: 51,
                wins: 37
              },
              HX: {
                n: 22,
                wins: 21
              },
              XA: {
                n: 4,
                wins: 3
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 80
              },
              AO05: {
                n: 45,
                wins: 40
              }
            },
            byLeague: {
              "39": {
                n: 64,
                wins: 46
              },
              "61": {
                n: 44,
                wins: 39
              },
              "78": {
                n: 63,
                wins: 54
              },
              "94": {
                n: 92,
                wins: 73
              },
              "135": {
                n: 73,
                wins: 59
              },
              "140": {
                n: 64,
                wins: 56
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-4-0.65",
            markets: "broad-goals",
            cap: 4,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 400,
            wins: 334,
            hitRate: 0.835,
            meanProbability: 0.8052906566386472,
            brier: 0.12862155258432204,
            logLoss: 0.4083946309166288,
            alternatives: 164,
            byMarket: {
              H: {
                n: 188,
                wins: 143
              },
              A: {
                n: 48,
                wins: 35
              },
              O05: {
                n: 82,
                wins: 76
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 33,
                wins: 33
              },
              HAP15: {
                n: 23,
                wins: 22
              },
              AAP15: {
                n: 11,
                wins: 11
              }
            },
            byLeague: {
              "39": {
                n: 64,
                wins: 50
              },
              "61": {
                n: 44,
                wins: 37
              },
              "78": {
                n: 63,
                wins: 54
              },
              "94": {
                n: 92,
                wins: 74
              },
              "135": {
                n: 73,
                wins: 61
              },
              "140": {
                n: 64,
                wins: 58
              }
            }
          }
        },
        {
          policy: {
            id: "draw-4-0.7",
            markets: "draw",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 313,
            hitRate: 0.798469387755102,
            meanProbability: 0.7520291798393245,
            brier: 0.15223099685819563,
            logLoss: 0.4760065563851564,
            alternatives: 164,
            byMarket: {
              H: {
                n: 181,
                wins: 135
              },
              A: {
                n: 47,
                wins: 30
              },
              HX: {
                n: 112,
                wins: 102
              },
              XA: {
                n: 52,
                wins: 46
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 46
              },
              "61": {
                n: 44,
                wins: 35
              },
              "78": {
                n: 60,
                wins: 48
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 72,
                wins: 59
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "standard-4-0.7",
            markets: "standard",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 309,
            hitRate: 0.7882653061224489,
            meanProbability: 0.7578048329180366,
            brier: 0.15939384612075194,
            logLoss: 0.4917123998934784,
            alternatives: 164,
            byMarket: {
              H: {
                n: 181,
                wins: 136
              },
              A: {
                n: 47,
                wins: 31
              },
              HX: {
                n: 76,
                wins: 71
              },
              XA: {
                n: 33,
                wins: 30
              },
              O15: {
                n: 48,
                wins: 37
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 44,
                wins: 34
              },
              "78": {
                n: 60,
                wins: 49
              },
              "94": {
                n: 91,
                wins: 72
              },
              "135": {
                n: 72,
                wins: 57
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-4-0.7",
            markets: "team-goals",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 321,
            hitRate: 0.8188775510204082,
            meanProbability: 0.7677643145129877,
            brier: 0.14486048854982866,
            logLoss: 0.4591295528801716,
            alternatives: 164,
            byMarket: {
              H: {
                n: 179,
                wins: 138
              },
              A: {
                n: 49,
                wins: 35
              },
              HX: {
                n: 22,
                wins: 21
              },
              XA: {
                n: 4,
                wins: 3
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 80
              },
              AO05: {
                n: 45,
                wins: 40
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 44,
                wins: 39
              },
              "78": {
                n: 60,
                wins: 51
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 72,
                wins: 58
              },
              "140": {
                n: 63,
                wins: 55
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-4-0.7",
            markets: "broad-goals",
            cap: 4,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 328,
            hitRate: 0.8367346938775511,
            meanProbability: 0.8074203061160815,
            brier: 0.12752442027060515,
            logLoss: 0.40546545024008507,
            alternatives: 164,
            byMarket: {
              H: {
                n: 182,
                wins: 139
              },
              A: {
                n: 46,
                wins: 33
              },
              O05: {
                n: 80,
                wins: 74
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 33,
                wins: 33
              },
              HAP15: {
                n: 25,
                wins: 24
              },
              AAP15: {
                n: 11,
                wins: 11
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 49
              },
              "61": {
                n: 44,
                wins: 37
              },
              "78": {
                n: 60,
                wins: 51
              },
              "94": {
                n: 91,
                wins: 74
              },
              "135": {
                n: 72,
                wins: 60
              },
              "140": {
                n: 63,
                wins: 57
              }
            }
          }
        },
        {
          policy: {
            id: "draw-4-0.75",
            markets: "draw",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 310,
            hitRate: 0.7989690721649485,
            meanProbability: 0.7520598111489063,
            brier: 0.1520741894129634,
            logLoss: 0.47564182778111375,
            alternatives: 164,
            byMarket: {
              H: {
                n: 177,
                wins: 132
              },
              A: {
                n: 47,
                wins: 30
              },
              HX: {
                n: 114,
                wins: 104
              },
              XA: {
                n: 50,
                wins: 44
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 46
              },
              "61": {
                n: 42,
                wins: 34
              },
              "78": {
                n: 59,
                wins: 47
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 71,
                wins: 58
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "standard-4-0.75",
            markets: "standard",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 306,
            hitRate: 0.788659793814433,
            meanProbability: 0.7579879454625159,
            brier: 0.15929863011792833,
            logLoss: 0.49141007792674996,
            alternatives: 164,
            byMarket: {
              H: {
                n: 177,
                wins: 133
              },
              A: {
                n: 47,
                wins: 31
              },
              HX: {
                n: 77,
                wins: 72
              },
              XA: {
                n: 31,
                wins: 28
              },
              O15: {
                n: 49,
                wins: 38
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 42,
                wins: 33
              },
              "78": {
                n: 59,
                wins: 48
              },
              "94": {
                n: 91,
                wins: 72
              },
              "135": {
                n: 71,
                wins: 56
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-4-0.75",
            markets: "team-goals",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 318,
            hitRate: 0.8195876288659794,
            meanProbability: 0.7680040809442735,
            brier: 0.14355474832130685,
            logLoss: 0.4545359031738353,
            alternatives: 164,
            byMarket: {
              H: {
                n: 175,
                wins: 134
              },
              A: {
                n: 49,
                wins: 35
              },
              HX: {
                n: 24,
                wins: 23
              },
              XA: {
                n: 3,
                wins: 2
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 81
              },
              AO05: {
                n: 44,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 42,
                wins: 38
              },
              "78": {
                n: 59,
                wins: 50
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 71,
                wins: 57
              },
              "140": {
                n: 63,
                wins: 55
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-4-0.75",
            markets: "broad-goals",
            cap: 4,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 325,
            hitRate: 0.8376288659793815,
            meanProbability: 0.8080040835307383,
            brier: 0.12579084073361482,
            logLoss: 0.39770550157710094,
            alternatives: 164,
            byMarket: {
              H: {
                n: 178,
                wins: 135
              },
              A: {
                n: 46,
                wins: 33
              },
              O05: {
                n: 80,
                wins: 75
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 33,
                wins: 33
              },
              HAP15: {
                n: 26,
                wins: 25
              },
              AAP15: {
                n: 10,
                wins: 10
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 49
              },
              "61": {
                n: 42,
                wins: 36
              },
              "78": {
                n: 59,
                wins: 50
              },
              "94": {
                n: 91,
                wins: 74
              },
              "135": {
                n: 71,
                wins: 59
              },
              "140": {
                n: 63,
                wins: 57
              }
            }
          }
        },
        {
          policy: {
            id: "draw-5-0.65",
            markets: "draw",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 406,
            wins: 322,
            hitRate: 0.7931034482758621,
            meanProbability: 0.7497733004755289,
            brier: 0.15555949283316578,
            logLoss: 0.4844851798643378,
            alternatives: 164,
            byMarket: {
              H: {
                n: 191,
                wins: 141
              },
              A: {
                n: 51,
                wins: 34
              },
              HX: {
                n: 113,
                wins: 102
              },
              XA: {
                n: 51,
                wins: 45
              }
            },
            byLeague: {
              "39": {
                n: 65,
                wins: 46
              },
              "61": {
                n: 44,
                wins: 35
              },
              "78": {
                n: 64,
                wins: 51
              },
              "94": {
                n: 93,
                wins: 74
              },
              "135": {
                n: 75,
                wins: 62
              },
              "140": {
                n: 65,
                wins: 54
              }
            }
          }
        },
        {
          policy: {
            id: "standard-5-0.65",
            markets: "standard",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 406,
            wins: 316,
            hitRate: 0.7783251231527094,
            meanProbability: 0.7555297993439607,
            brier: 0.1659772338234262,
            logLoss: 0.5085691818912215,
            alternatives: 164,
            byMarket: {
              H: {
                n: 190,
                wins: 141
              },
              A: {
                n: 52,
                wins: 36
              },
              HX: {
                n: 76,
                wins: 70
              },
              XA: {
                n: 31,
                wins: 28
              },
              O15: {
                n: 50,
                wins: 37
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 65,
                wins: 45
              },
              "61": {
                n: 44,
                wins: 34
              },
              "78": {
                n: 64,
                wins: 50
              },
              "94": {
                n: 93,
                wins: 73
              },
              "135": {
                n: 75,
                wins: 60
              },
              "140": {
                n: 65,
                wins: 54
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-5-0.65",
            markets: "team-goals",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 406,
            wins: 333,
            hitRate: 0.8201970443349754,
            meanProbability: 0.7651335334198082,
            brier: 0.1448351497858366,
            logLoss: 0.4597833317454307,
            alternatives: 164,
            byMarket: {
              H: {
                n: 189,
                wins: 146
              },
              A: {
                n: 53,
                wins: 39
              },
              HX: {
                n: 23,
                wins: 22
              },
              XA: {
                n: 4,
                wins: 3
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 80
              },
              AO05: {
                n: 44,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 65,
                wins: 47
              },
              "61": {
                n: 44,
                wins: 39
              },
              "78": {
                n: 64,
                wins: 55
              },
              "94": {
                n: 93,
                wins: 74
              },
              "135": {
                n: 75,
                wins: 61
              },
              "140": {
                n: 65,
                wins: 57
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-5-0.65",
            markets: "broad-goals",
            cap: 5,
            extraMinProbability: 0.65
          },
          metrics: {
            n: 406,
            wins: 339,
            hitRate: 0.8349753694581281,
            meanProbability: 0.80382537973733,
            brier: 0.12748583935223687,
            logLoss: 0.4027115149823776,
            alternatives: 164,
            byMarket: {
              H: {
                n: 191,
                wins: 144
              },
              A: {
                n: 51,
                wins: 38
              },
              O05: {
                n: 80,
                wins: 75
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 35,
                wins: 35
              },
              HAP15: {
                n: 24,
                wins: 23
              },
              AAP15: {
                n: 10,
                wins: 10
              }
            },
            byLeague: {
              "39": {
                n: 65,
                wins: 51
              },
              "61": {
                n: 44,
                wins: 37
              },
              "78": {
                n: 64,
                wins: 54
              },
              "94": {
                n: 93,
                wins: 75
              },
              "135": {
                n: 75,
                wins: 63
              },
              "140": {
                n: 65,
                wins: 59
              }
            }
          }
        },
        {
          policy: {
            id: "draw-5-0.7",
            markets: "draw",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 313,
            hitRate: 0.798469387755102,
            meanProbability: 0.7520291798393245,
            brier: 0.15223099685819563,
            logLoss: 0.4760065563851564,
            alternatives: 164,
            byMarket: {
              H: {
                n: 181,
                wins: 135
              },
              A: {
                n: 47,
                wins: 30
              },
              HX: {
                n: 112,
                wins: 102
              },
              XA: {
                n: 52,
                wins: 46
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 46
              },
              "61": {
                n: 44,
                wins: 35
              },
              "78": {
                n: 60,
                wins: 48
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 72,
                wins: 59
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "standard-5-0.7",
            markets: "standard",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 309,
            hitRate: 0.7882653061224489,
            meanProbability: 0.7578048329180366,
            brier: 0.15939384612075194,
            logLoss: 0.4917123998934784,
            alternatives: 164,
            byMarket: {
              H: {
                n: 181,
                wins: 136
              },
              A: {
                n: 47,
                wins: 31
              },
              HX: {
                n: 76,
                wins: 71
              },
              XA: {
                n: 33,
                wins: 30
              },
              O15: {
                n: 48,
                wins: 37
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 44,
                wins: 34
              },
              "78": {
                n: 60,
                wins: 49
              },
              "94": {
                n: 91,
                wins: 72
              },
              "135": {
                n: 72,
                wins: 57
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-5-0.7",
            markets: "team-goals",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 321,
            hitRate: 0.8188775510204082,
            meanProbability: 0.7677643145129877,
            brier: 0.14486048854982866,
            logLoss: 0.4591295528801716,
            alternatives: 164,
            byMarket: {
              H: {
                n: 179,
                wins: 138
              },
              A: {
                n: 49,
                wins: 35
              },
              HX: {
                n: 22,
                wins: 21
              },
              XA: {
                n: 4,
                wins: 3
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 80
              },
              AO05: {
                n: 45,
                wins: 40
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 44,
                wins: 39
              },
              "78": {
                n: 60,
                wins: 51
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 72,
                wins: 58
              },
              "140": {
                n: 63,
                wins: 55
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-5-0.7",
            markets: "broad-goals",
            cap: 5,
            extraMinProbability: 0.7
          },
          metrics: {
            n: 392,
            wins: 328,
            hitRate: 0.8367346938775511,
            meanProbability: 0.8074203061160815,
            brier: 0.12752442027060515,
            logLoss: 0.40546545024008507,
            alternatives: 164,
            byMarket: {
              H: {
                n: 182,
                wins: 139
              },
              A: {
                n: 46,
                wins: 33
              },
              O05: {
                n: 80,
                wins: 74
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 33,
                wins: 33
              },
              HAP15: {
                n: 25,
                wins: 24
              },
              AAP15: {
                n: 11,
                wins: 11
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 49
              },
              "61": {
                n: 44,
                wins: 37
              },
              "78": {
                n: 60,
                wins: 51
              },
              "94": {
                n: 91,
                wins: 74
              },
              "135": {
                n: 72,
                wins: 60
              },
              "140": {
                n: 63,
                wins: 57
              }
            }
          }
        },
        {
          policy: {
            id: "draw-5-0.75",
            markets: "draw",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 310,
            hitRate: 0.7989690721649485,
            meanProbability: 0.7520598111489063,
            brier: 0.1520741894129634,
            logLoss: 0.47564182778111375,
            alternatives: 164,
            byMarket: {
              H: {
                n: 177,
                wins: 132
              },
              A: {
                n: 47,
                wins: 30
              },
              HX: {
                n: 114,
                wins: 104
              },
              XA: {
                n: 50,
                wins: 44
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 46
              },
              "61": {
                n: 42,
                wins: 34
              },
              "78": {
                n: 59,
                wins: 47
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 71,
                wins: 58
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "standard-5-0.75",
            markets: "standard",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 306,
            hitRate: 0.788659793814433,
            meanProbability: 0.7579879454625159,
            brier: 0.15929863011792833,
            logLoss: 0.49141007792674996,
            alternatives: 164,
            byMarket: {
              H: {
                n: 177,
                wins: 133
              },
              A: {
                n: 47,
                wins: 31
              },
              HX: {
                n: 77,
                wins: 72
              },
              XA: {
                n: 31,
                wins: 28
              },
              O15: {
                n: 49,
                wins: 38
              },
              U35: {
                n: 7,
                wins: 4
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 42,
                wins: 33
              },
              "78": {
                n: 59,
                wins: 48
              },
              "94": {
                n: 91,
                wins: 72
              },
              "135": {
                n: 71,
                wins: 56
              },
              "140": {
                n: 63,
                wins: 52
              }
            }
          }
        },
        {
          policy: {
            id: "team-goals-5-0.75",
            markets: "team-goals",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 318,
            hitRate: 0.8195876288659794,
            meanProbability: 0.7680040809442735,
            brier: 0.14355474832130685,
            logLoss: 0.4545359031738353,
            alternatives: 164,
            byMarket: {
              H: {
                n: 175,
                wins: 134
              },
              A: {
                n: 49,
                wins: 35
              },
              HX: {
                n: 24,
                wins: 23
              },
              XA: {
                n: 3,
                wins: 2
              },
              O15: {
                n: 1,
                wins: 1
              },
              U35: {
                n: 4,
                wins: 3
              },
              HO05: {
                n: 88,
                wins: 81
              },
              AO05: {
                n: 44,
                wins: 39
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 45
              },
              "61": {
                n: 42,
                wins: 38
              },
              "78": {
                n: 59,
                wins: 50
              },
              "94": {
                n: 91,
                wins: 73
              },
              "135": {
                n: 71,
                wins: 57
              },
              "140": {
                n: 63,
                wins: 55
              }
            }
          }
        },
        {
          policy: {
            id: "broad-goals-5-0.75",
            markets: "broad-goals",
            cap: 5,
            extraMinProbability: 0.75
          },
          metrics: {
            n: 388,
            wins: 325,
            hitRate: 0.8376288659793815,
            meanProbability: 0.8080040835307383,
            brier: 0.12579084073361482,
            logLoss: 0.39770550157710094,
            alternatives: 164,
            byMarket: {
              H: {
                n: 178,
                wins: 135
              },
              A: {
                n: 46,
                wins: 33
              },
              O05: {
                n: 80,
                wins: 75
              },
              HU25: {
                n: 15,
                wins: 14
              },
              AU25: {
                n: 33,
                wins: 33
              },
              HAP15: {
                n: 26,
                wins: 25
              },
              AAP15: {
                n: 10,
                wins: 10
              }
            },
            byLeague: {
              "39": {
                n: 62,
                wins: 49
              },
              "61": {
                n: 42,
                wins: 36
              },
              "78": {
                n: 59,
                wins: 50
              },
              "94": {
                n: 91,
                wins: 74
              },
              "135": {
                n: 71,
                wins: 59
              },
              "140": {
                n: 63,
                wins: 57
              }
            }
          }
        }
      ],
      baseline: {
        n: 71,
        wins: 58,
        hitRate: 0.8169014084507042,
        meanProbability: 0.7514357948268858,
        brier: 0.15132532571265922,
        logLoss: 0.4744101486264443,
        alternatives: 35,
        byMarket: {
          H: {
            n: 29,
            wins: 24
          },
          A: {
            n: 7,
            wins: 6
          },
          HX: {
            n: 25,
            wins: 20
          },
          XA: {
            n: 10,
            wins: 8
          }
        },
        byLeague: {
          "39": {
            n: 5,
            wins: 4
          },
          "61": {
            n: 5,
            wins: 2
          },
          "78": {
            n: 10,
            wins: 9
          },
          "94": {
            n: 23,
            wins: 19
          },
          "135": {
            n: 10,
            wins: 9
          },
          "140": {
            n: 18,
            wins: 15
          }
        }
      },
      candidate: {
        n: 71,
        wins: 66,
        hitRate: 0.9295774647887324,
        meanProbability: 0.816579191598726,
        brier: 0.09569558465244168,
        logLoss: 0.33187957265276696,
        alternatives: 35,
        byMarket: {
          H: {
            n: 32,
            wins: 29
          },
          A: {
            n: 4,
            wins: 4
          },
          O05: {
            n: 17,
            wins: 16
          },
          HU25: {
            n: 2,
            wins: 2
          },
          AU25: {
            n: 9,
            wins: 8
          },
          HAP15: {
            n: 4,
            wins: 4
          },
          AAP15: {
            n: 3,
            wins: 3
          }
        },
        byLeague: {
          "39": {
            n: 5,
            wins: 5
          },
          "61": {
            n: 5,
            wins: 4
          },
          "78": {
            n: 10,
            wins: 10
          },
          "94": {
            n: 23,
            wins: 21
          },
          "135": {
            n: 10,
            wins: 10
          },
          "140": {
            n: 18,
            wins: 16
          }
        }
      },
      pairedDayBootstrap95: [
        0.0491803278688524,
        0.18055555555555547
      ],
      hitRateDayBootstrap95: [
        0.8701298701298701,
        0.976331168831168
      ],
      days: 35,
      sameMarketCap3: {
        n: 71,
        wins: 66,
        hitRate: 0.9295774647887324,
        meanProbability: 0.816579191598726,
        brier: 0.09569558465244168,
        logLoss: 0.33187957265276696,
        alternatives: 35,
        byMarket: {
          H: {
            n: 32,
            wins: 29
          },
          A: {
            n: 4,
            wins: 4
          },
          O05: {
            n: 17,
            wins: 16
          },
          HU25: {
            n: 2,
            wins: 2
          },
          AU25: {
            n: 9,
            wins: 8
          },
          HAP15: {
            n: 4,
            wins: 4
          },
          AAP15: {
            n: 3,
            wins: 3
          }
        },
        byLeague: {
          "39": {
            n: 5,
            wins: 5
          },
          "61": {
            n: 5,
            wins: 4
          },
          "78": {
            n: 10,
            wins: 10
          },
          "94": {
            n: 23,
            wins: 21
          },
          "135": {
            n: 10,
            wins: 10
          },
          "140": {
            n: 18,
            wins: 16
          }
        }
      },
      extraGames: {
        n: 0,
        wins: 0,
        hitRate: null
      }
    }
  ],
  pooled: {
    baseline: {
      n: 459,
      wins: 368,
      hitRate: 0.8017429193899782,
      meanProbability: 0.7519632857483324,
      brier: 0.15195835210855907,
      logLoss: 0.4754513066046834,
      alternatives: 199,
      byMarket: {
        H: {
          n: 206,
          wins: 156
        },
        A: {
          n: 54,
          wins: 36
        },
        HX: {
          n: 139,
          wins: 124
        },
        XA: {
          n: 60,
          wins: 52
        }
      },
      byLeague: {
        "39": {
          n: 67,
          wins: 50
        },
        "61": {
          n: 47,
          wins: 36
        },
        "78": {
          n: 69,
          wins: 56
        },
        "94": {
          n: 114,
          wins: 92
        },
        "135": {
          n: 81,
          wins: 67
        },
        "140": {
          n: 81,
          wins: 67
        }
      }
    },
    candidate: {
      n: 459,
      wins: 391,
      hitRate: 0.8518518518518519,
      meanProbability: 0.8093305163691416,
      brier: 0.12113558325700634,
      logLoss: 0.38752327727725844,
      alternatives: 199,
      byMarket: {
        H: {
          n: 210,
          wins: 164
        },
        A: {
          n: 50,
          wins: 37
        },
        O05: {
          n: 97,
          wins: 91
        },
        HU25: {
          n: 17,
          wins: 16
        },
        AU25: {
          n: 42,
          wins: 41
        },
        HAP15: {
          n: 30,
          wins: 29
        },
        AAP15: {
          n: 13,
          wins: 13
        }
      },
      byLeague: {
        "39": {
          n: 67,
          wins: 54
        },
        "61": {
          n: 47,
          wins: 40
        },
        "78": {
          n: 69,
          wins: 60
        },
        "94": {
          n: 114,
          wins: 95
        },
        "135": {
          n: 81,
          wins: 69
        },
        "140": {
          n: 81,
          wins: 73
        }
      }
    },
    pairedDayBootstrap95: [
      0.024605760750960413,
      0.07407603578154424
    ],
    hitRateDayBootstrap95: [
      0.8210273731719469,
      0.8823529411764706
    ],
    days: 199
  },
  volumeImpact: {
    baseline: {
      n: 459,
      wins: 391,
      hitRate: 0.8518518518518519,
      meanProbability: 0.8093305163691416,
      brier: 0.12113558325700634,
      logLoss: 0.38752327727725844,
      alternatives: 199,
      byMarket: {
        H: {
          n: 210,
          wins: 164
        },
        A: {
          n: 50,
          wins: 37
        },
        O05: {
          n: 97,
          wins: 91
        },
        HU25: {
          n: 17,
          wins: 16
        },
        AU25: {
          n: 42,
          wins: 41
        },
        HAP15: {
          n: 30,
          wins: 29
        },
        AAP15: {
          n: 13,
          wins: 13
        }
      },
      byLeague: {
        "39": {
          n: 67,
          wins: 54
        },
        "61": {
          n: 47,
          wins: 40
        },
        "78": {
          n: 69,
          wins: 60
        },
        "94": {
          n: 114,
          wins: 95
        },
        "135": {
          n: 81,
          wins: 69
        },
        "140": {
          n: 81,
          wins: 73
        }
      }
    },
    candidate: {
      n: 459,
      wins: 391,
      hitRate: 0.8518518518518519,
      meanProbability: 0.8093305163691416,
      brier: 0.12113558325700634,
      logLoss: 0.38752327727725844,
      alternatives: 199,
      byMarket: {
        H: {
          n: 210,
          wins: 164
        },
        A: {
          n: 50,
          wins: 37
        },
        O05: {
          n: 97,
          wins: 91
        },
        HU25: {
          n: 17,
          wins: 16
        },
        AU25: {
          n: 42,
          wins: 41
        },
        HAP15: {
          n: 30,
          wins: 29
        },
        AAP15: {
          n: 13,
          wins: 13
        }
      },
      byLeague: {
        "39": {
          n: 67,
          wins: 54
        },
        "61": {
          n: 47,
          wins: 40
        },
        "78": {
          n: 69,
          wins: 60
        },
        "94": {
          n: 114,
          wins: 95
        },
        "135": {
          n: 81,
          wins: 69
        },
        "140": {
          n: 81,
          wins: 73
        }
      }
    },
    pairedDayBootstrap95: [
      0,
      0
    ],
    hitRateDayBootstrap95: [
      0.8210273731719469,
      0.8823529411764706
    ],
    days: 199
  },
  cap3MarketImpact: {
    baseline: {
      n: 459,
      wins: 368,
      hitRate: 0.8017429193899782,
      meanProbability: 0.7519632857483324,
      brier: 0.15195835210855907,
      logLoss: 0.4754513066046834,
      alternatives: 199,
      byMarket: {
        H: {
          n: 206,
          wins: 156
        },
        A: {
          n: 54,
          wins: 36
        },
        HX: {
          n: 139,
          wins: 124
        },
        XA: {
          n: 60,
          wins: 52
        }
      },
      byLeague: {
        "39": {
          n: 67,
          wins: 50
        },
        "61": {
          n: 47,
          wins: 36
        },
        "78": {
          n: 69,
          wins: 56
        },
        "94": {
          n: 114,
          wins: 92
        },
        "135": {
          n: 81,
          wins: 67
        },
        "140": {
          n: 81,
          wins: 67
        }
      }
    },
    candidate: {
      n: 459,
      wins: 391,
      hitRate: 0.8518518518518519,
      meanProbability: 0.8093305163691416,
      brier: 0.12113558325700634,
      logLoss: 0.38752327727725844,
      alternatives: 199,
      byMarket: {
        H: {
          n: 210,
          wins: 164
        },
        A: {
          n: 50,
          wins: 37
        },
        O05: {
          n: 97,
          wins: 91
        },
        HU25: {
          n: 17,
          wins: 16
        },
        AU25: {
          n: 42,
          wins: 41
        },
        HAP15: {
          n: 30,
          wins: 29
        },
        AAP15: {
          n: 13,
          wins: 13
        }
      },
      byLeague: {
        "39": {
          n: 67,
          wins: 54
        },
        "61": {
          n: 47,
          wins: 40
        },
        "78": {
          n: 69,
          wins: 60
        },
        "94": {
          n: 114,
          wins: 95
        },
        "135": {
          n: 81,
          wins: 69
        },
        "140": {
          n: 81,
          wins: 73
        }
      }
    },
    pairedDayBootstrap95: [
      0.024605760750960413,
      0.07407603578154424
    ],
    hitRateDayBootstrap95: [
      0.8210273731719469,
      0.8823529411764706
    ],
    days: 199
  },
  promoted: true,
  expanded: false,
  activePolicy: {
    id: "broad-goals-3-0.5",
    markets: "broad-goals",
    cap: 3,
    extraMinProbability: 0.5
  }
};

// src/odds-refresh.js
async function refreshOdds(env) {
  return (await reviewSelections(env)).checks;
}
async function runQueuedRefresh(env) {
  const now = Date.now();
  const job = await env.DB.prepare(
    "UPDATE maintenance_jobs SET started_at=? WHERE id=(SELECT id FROM maintenance_jobs WHERE kind='refresh-odds' AND started_at IS NULL AND requested_at<=? ORDER BY requested_at LIMIT 1) AND started_at IS NULL RETURNING id"
  ).bind(now, now).first();
  if (!job) return;
  let result;
  try {
    result = { ok: true, checks: await refreshOdds(env) };
  } catch (e) {
    result = { ok: false, code: e.code || "refresh_failed" };
  }
  await env.DB.prepare(
    "UPDATE maintenance_jobs SET finished_at=?,result=? WHERE id=?"
  ).bind(Date.now(), JSON.stringify(result), job.id).run();
}

// src/history-backfill.js
async function backfillHistory(env, plans, now = Date.now(), options = {}) {
  const db = env.DB, pending = [];
  let downloaded = false, attempts = 0, halted = false;
  const maximum = Math.min(4, Math.max(1, Number(options.maxDownloads) || 1));
  for (const { league, season } of plans) {
    let complete = true;
    for (const year of [season, season - 1, season - 2, season - 3]) {
      const path = historyPath(league, year, now), key = "api:" + path;
      const cached = await db.prepare("SELECT data,expires FROM cache WHERE key=?").bind(key).first();
      let payload;
      try {
        payload = cached ? JSON.parse(cached.data) : null;
      } catch {
      }
      const fresh = cached?.expires > now && Array.isArray(payload?.items);
      if (!fresh && (attempts >= maximum || halted)) {
        complete = false;
        continue;
      }
      try {
        if (!fresh) {
          downloaded = true;
          attempts++;
        }
        const result = await api(
          env,
          path,
          year === season ? 864e5 : 365 * 864e5
        );
        downloaded ||= result.fromCache === false;
        if (result.stale || result.refreshFailed || !result.data.length) {
          complete = false;
          continue;
        }
        const imported = await db.prepare("SELECT data FROM meta WHERE key=?").bind("history-import:" + path).first();
        if (!imported || JSON.parse(imported.data).at !== result.fetchedAt) {
          await saveFixtures(db, result.data, result.fetchedAt);
          await db.prepare(
            "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data"
          ).bind(
            "history-import:" + path,
            JSON.stringify({ at: result.fetchedAt })
          ).run();
        }
      } catch (e) {
        complete = false;
        pending.push({
          league,
          season: year,
          code: e.code || "history_unavailable"
        });
        if (["rate_limit", "rate_limit_cooldown", "daily_budget"].includes(e.code))
          halted = true;
      }
    }
    if (complete)
      await db.prepare(
        "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data"
      ).bind("bootstrap:" + league + ":" + season, JSON.stringify({ at: now })).run();
    else if (!pending.some((x) => x.league === league))
      pending.push({ league, code: "history_pending" });
  }
  return { pending, downloaded, attempts };
}
async function runHistoryCatchup(env) {
  const db = env.DB, now = Date.now();
  const row = await db.prepare("SELECT data FROM meta WHERE key='history:catchup'").first();
  if (!row) return { skipped: true };
  const job = JSON.parse(row.data);
  if (!job.active || !Number.isFinite(job.expiresAt) || job.expiresAt <= now)
    return { skipped: true };
  const lease = now + 12e4;
  const lock = await db.prepare(
    "INSERT INTO locks(key,until) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING key"
  ).bind(lease, now).first();
  if (!lock) return { skipped: true, active: true };
  try {
    const plans = [];
    for (const competition of configuredCompetitions(env)) {
      if (!Array.isArray(job.leagues) || !job.leagues.includes(competition.id))
        continue;
      const coverage = await db.prepare("SELECT data FROM meta WHERE key=?").bind("coverage:" + competition.id).first();
      const season = coverage ? JSON.parse(coverage.data).season : null;
      if (!Number.isInteger(season) || season < 2e3 || season > new Date(now).getUTCFullYear() + 1)
        throw new Error("catchup_coverage_missing");
      plans.push({ league: competition.id, season });
    }
    if (!plans.length) throw new Error("catchup_no_competitions");
    const result = await backfillHistory(env, plans, now, { maxDownloads: 4 });
    const next = {
      ...job,
      at: Date.now(),
      active: result.pending.length > 0,
      pending: result.pending,
      attempts: result.attempts
    };
    if (!next.active) next.finishedAt = Date.now();
    await db.prepare("UPDATE meta SET data=? WHERE key='history:catchup'").bind(JSON.stringify(next)).run();
    return { ...result, active: next.active };
  } finally {
    await db.prepare("DELETE FROM locks WHERE key='sync' AND until=?").bind(lease).run();
  }
}

// src/worker.js
var HOUR2 = 36e5;
var json = (v, status = 200) => Response.json(v, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});
var meta = async (db, k, v) => db.prepare(
  "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data"
).bind(k, JSON.stringify(v)).run();
async function sync(env, force = false, requestedLeague = null) {
  const now = Date.now(), db = env.DB, window = forecastWindow(now);
  const lock = await db.prepare(
    "INSERT INTO locks(key,until) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING key"
  ).bind(now + 10 * 6e4, now).first();
  if (!lock) return { skipped: true };
  let stale = false, processed = 0, upstreamDegraded = false, failedLeagues = [], enrichmentAvailable = true;
  try {
    const dailyPlans = await readDailyMarkets(db, now);
    const historyPlans = [], contextTasks = [], missingOpponents = [];
    const configured = configuredCompetitions(env).map((c) => c.id);
    const previous = await db.prepare("SELECT data FROM meta WHERE key='sync'").first();
    let pending = [];
    try {
      pending = JSON.parse(previous?.data || "{}").failedLeagues?.map(
        (x) => x.league
      ) || [];
    } catch {
    }
    const leagues = requestedLeague !== null ? configured.filter((id) => id === requestedLeague) : [
      .../* @__PURE__ */ new Set([
        ...pending.filter((id) => configured.includes(id)),
        ...configured
      ])
    ];
    for (const league of leagues) {
      try {
        const coverage = await api(
          env,
          "leagues?id=" + league + (COMPETITIONS.find((c) => c.id === league)?.validationPending ? "&current=true" : ""),
          24 * HOUR2,
          force
        );
        let leagueStale = coverage.stale;
        upstreamDegraded ||= !!coverage.refreshFailed;
        const info = coverage.data[0], seasons = (info?.seasons || []).filter((s) => s.current);
        if (!seasons.length)
          throw Object.assign(new Error("competition_coverage_unavailable"), {
            code: "competition_coverage_unavailable"
          });
        const season = seasons[0];
        if (info?.league?.id && info.league.id !== league)
          throw new Error("competition_identity_mismatch");
        await meta(db, "coverage:" + league, {
          id: info?.league?.id || league,
          name: info?.league?.name || COMPETITIONS.find((c) => c.id === league)?.name,
          checkedAt: Date.now(),
          season: season.year,
          coverage: season.coverage
        });
        const upcoming = await api(
          env,
          `fixtures?league=${league}&season=${season.year}&from=${new Date(now - 3 * 864e5).toISOString().slice(0, 10)}&to=${new Date(now + 7 * 864e5).toISOString().slice(0, 10)}`,
          30 * 6e4,
          force
        );
        leagueStale ||= upcoming.stale;
        upstreamDegraded ||= !!upcoming.refreshFailed;
        if (upcoming.fromCache === false && !upcoming.stale)
          await meta(db, "last_live_sync", { at: now, league });
        const fixtures = await saveFixtures(
          db,
          upcoming.data,
          upcoming.fetchedAt,
          true
        );
        const bootstrap = await db.prepare("SELECT data FROM meta WHERE key=?").bind("bootstrap:" + league + ":" + season.year).first();
        const historyIncomplete = !bootstrap;
        stale ||= leagueStale || historyIncomplete;
        historyPlans.push({ league, season: season.year });
        const european = COMPETITIONS.find((c) => c.id === league)?.kind === "european";
        const historyLeagues = european ? configured : [league];
        const needsForecast = fixtures.some(
          (f) => !f.finished && f.ts > now && f.ts < window.end && f.status === "NS"
        );
        const stored = needsForecast ? await db.prepare(
          "SELECT data FROM fixtures WHERE league IN (" + historyLeagues.map(() => "?").join(",") + ") AND finished=1 AND kickoff<? AND kickoff>? ORDER BY kickoff"
        ).bind(...historyLeagues, now, now - 3 * 365 * 864e5).all() : { results: [] };
        const state = fit2(
          stored.results.map((r) => JSON.parse(r.data)),
          now,
          validation_default.opts
        );
        let enriched = 0;
        const analyzed = fixtures.map((f) => ({
          f,
          p: !f.finished && f.ts > now && f.ts < window.end && f.status === "NS" ? competitionEvidence(predict2(state, f), league) : null
        }));
        if (typeof env.__openfootEnrich === "function") {
          const originalHistory = stored.results.map((r) => JSON.parse(r.data));
          for (const item of analyzed) {
            if (item.p) item.p = await env.__openfootEnrich(originalHistory, item.f, item.p, now);
          }
        }
        analyzed.sort(
          (a, b) => Number(
            b.p?.sample >= 12 && Math.max(b.p.probabilities.H, b.p.probabilities.A) >= 0.5
          ) - Number(
            a.p?.sample >= 12 && Math.max(a.p.probabilities.H, a.p.probabilities.A) >= 0.5
          ) || a.f.ts - b.f.ts
        );
        for (const { f, p } of analyzed) {
          if (f.finished) {
            await db.prepare(
              "INSERT INTO results(fixture_id,hg,ag,settled_at) VALUES(?,?,?,?) ON CONFLICT(fixture_id) DO UPDATE SET hg=excluded.hg,ag=excluded.ag,settled_at=excluded.settled_at"
            ).bind(f.id, f.hg, f.ag, now).run();
            continue;
          }
          if (f.ts <= now || f.ts >= window.end || f.status !== "NS") continue;
          let odds = {}, context = { injuries: null, lineups: null, updatedAt: now };
          let matchStale = leagueStale || historyIncomplete;
          p.historyIncomplete = historyIncomplete;
          if (european) {
            for (const [side, other] of [
              ["home", "away"],
              ["away", "home"]
            ]) {
              if ((p.teams?.[side]?.effectiveSample || 0) < 12) {
                const id = f[side], name = f[side + "Name"];
                missingOpponents.push({
                  id,
                  name,
                  priority: 100 + (p.teams?.[other]?.effectiveSample || 0)
                });
                p.risks.push(
                  "Hist\xF3rico do advers\xE1rio com cobertura nacional insuficiente; compara\xE7\xE3o entre ligas por validar."
                );
                const extra = await db.prepare("SELECT data FROM meta WHERE key=?").bind("opponent-history:" + id).first();
                context.opponentHistory ||= [];
                if (extra) context.opponentHistory.push(JSON.parse(extra.data));
              }
            }
          }
          if (historyIncomplete)
            p.risks.push(
              "Importa\xE7\xE3o hist\xF3rica incompleta; c\xE1lculo provis\xF3rio com a amostra dispon\xEDvel, mantendo o m\xEDnimo de 12 jogos efetivos por equipa."
            );
          if (coverage.refreshFailed || upcoming.refreshFailed)
            p.risks.push(
              "Consulta direta falhou; foram utilizados os dados dispon\xEDveis em cache."
            );
          odds = await cachedFixtureOdds(db, f.id, now);
          if (f.ts - now < 24 * HOUR2 && enriched++ < 8) {
            if (season.coverage?.injuries)
              contextTasks.push({
                path: "injuries?fixture=" + f.id,
                ttl: 6 * HOUR2
              });
            if (f.ts - now < 2 * HOUR2 && season.coverage?.fixtures?.lineups)
              contextTasks.push({
                path: "fixtures/lineups?fixture=" + f.id,
                ttl: 30 * 6e4
              });
            for (const [field, path] of [
              ["injuries", "injuries?fixture=" + f.id],
              ["lineups", "fixtures/lineups?fixture=" + f.id]
            ]) {
              const saved = await db.prepare("SELECT data,expires FROM cache WHERE key=?").bind("api:" + path).first();
              if (saved) {
                try {
                  const payload = JSON.parse(saved.data), items = Array.isArray(payload) ? payload : payload.items;
                  if (Array.isArray(items))
                    context[field] = items.map(
                      (x) => field === "injuries" ? {
                        team: x.team?.name,
                        player: x.player?.name,
                        type: x.player?.type,
                        reason: x.player?.reason
                      } : {
                        team: x.team?.name,
                        formation: x.formation,
                        players: x.startXI?.map((y) => y.player?.name)
                      }
                    );
                  context[field + "Stale"] = saved.expires <= now;
                } catch {
                }
              }
            }
          }
          if (season.coverage?.injuries && context.injuries === null)
            p.risks.push("Indisponibilidades n\xE3o verificadas.");
          if (season.coverage?.fixtures?.lineups && context.lineups === null)
            p.risks.push("Alinhamentos n\xE3o dispon\xEDveis.");
          if (matchStale)
            p.risks.push(
              "Atualiza\xE7\xE3o em atraso; sele\xE7\xE3o de valor suspensa, progn\xF3stico de vencedor apenas provis\xF3rio."
            );
          const predictionAt = Date.now();
          if (f.ts <= predictionAt) continue;
          let data = {
            fixture: f,
            prediction: p,
            // The daily overlay preserves the original winner for comparison.
            recommendation: null,
            winnerTip: winnerTip(
              p,
              p.contextAdjustment || p.xgEnrichment?.active || COMPETITIONS.find((c) => c.id === league)?.validationPending ? null : winner_multiscale_research_default.calibration,
              odds,
              {
                now: predictionAt,
                sourceUpdatedAt: upcoming.fetchedAt,
                stale: matchStale
              }
            ),
            odds,
            context,
            updatedAt: predictionAt,
            sourceUpdatedAt: upcoming.fetchedAt,
            stale: matchStale
          };
          if (data.winnerTip && COMPETITIONS.find((c) => c.id === league)?.validationPending) {
            data.winnerTip.reliability = null;
            data.winnerTip.calibrationStatus = "Valida\xE7\xE3o hist\xF3rica desta competi\xE7\xE3o pendente";
          }
          const phase = f.ts - predictionAt <= HOUR2 && !matchStale ? "final" : "preliminary";
          const snapshotVersion = p.version + "@" + f.ts;
          data.phase = phase;
          data = decorateDailyMarket(
            data,
            dailyPlans.find((p2) => p2.fixture_id === f.id),
            predictionAt
          );
          const final = await db.prepare(
            "SELECT data FROM forecasts WHERE fixture_id=? AND version=? AND phase='final' AND kickoff=?"
          ).bind(f.id, snapshotVersion, f.ts).first();
          if (!final)
            await db.prepare(
              "INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)"
            ).bind(
              f.id,
              snapshotVersion + (phase === "preliminary" ? ":" + predictionAt : ""),
              phase,
              predictionAt,
              f.ts,
              JSON.stringify(data)
            ).run();
          await db.prepare(
            "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires"
          ).bind(
            "forecast:" + f.id,
            final ? JSON.stringify(
              decorateDailyMarket(
                JSON.parse(final.data),
                dailyPlans.find((p2) => p2.fixture_id === f.id),
                now
              )
            ) : JSON.stringify(data),
            f.ts + 864e5
          ).run();
          processed++;
        }
      } catch (e) {
        stale = true;
        upstreamDegraded = true;
        failedLeagues.push({ league, code: e.code || "league_sync_failed" });
      }
    }
    await db.prepare(
      `INSERT INTO results(fixture_id,hg,ag,settled_at)
      SELECT f.id,json_extract(f.data,'$.hg'),json_extract(f.data,'$.ag'),?
      FROM (SELECT DISTINCT fixture_id FROM forecasts) p
      JOIN fixtures f ON f.id=p.fixture_id LEFT JOIN results r ON r.fixture_id=f.id
      WHERE f.finished=1
      AND (r.fixture_id IS NULL OR r.hg<>json_extract(f.data,'$.hg') OR r.ag<>json_extract(f.data,'$.ag'))
      ON CONFLICT(fixture_id) DO UPDATE SET hg=excluded.hg,ag=excluded.ag,settled_at=excluded.settled_at`
    ).bind(now).run();
    await invalidatePublicGames(db);
    const dailyMarkets = await finalizeDailyMarkets(db);
    const selectionReview = await reviewSelections(env);
    const opponentHistory = await collectOpponentHistory(env, missingOpponents);
    const historyBackfill = await backfillHistory(env, historyPlans);
    for (const task of contextTasks.slice(0, 8)) {
      try {
        await api(env, task.path, task.ttl);
      } catch {
        enrichmentAvailable = false;
        break;
      }
    }
    await meta(
      db,
      requestedLeague === null ? "sync" : "sync:competition:" + requestedLeague,
      {
        at: Date.now(),
        ok: true,
        dailyMarkets,
        selectionReview,
        opponentHistory,
        historyPending: historyBackfill.pending,
        stale,
        processed,
        contextAvailable: enrichmentAvailable,
        failedLeagues,
        upstreamDegraded
      }
    );
    await db.prepare("DELETE FROM cache WHERE expires<? AND key LIKE ?").bind(now - 30 * 864e5, "api:%").run();
    return {
      ok: true,
      processed,
      stale,
      failedLeagues,
      historyPending: historyBackfill.pending
    };
  } catch (e) {
    await meta(
      db,
      requestedLeague === null ? "sync" : "sync:competition:" + requestedLeague,
      {
        at: Date.now(),
        ok: false,
        code: e.code || "sync_failed"
      }
    );
    throw e;
  } finally {
    await db.prepare("DELETE FROM locks WHERE key='sync'").run();
  }
}
async function runRequestedSync(env) {
  const now = Date.now(), db = env.DB;
  const check = await db.prepare("SELECT data FROM meta WHERE key='provider:plan-check'").first();
  if (!check || now - JSON.parse(check.data).at > 6 * HOUR2) {
    await meta(db, "provider:plan-check", { at: now });
    try {
      const status = await api(env, "status", 6 * HOUR2);
      if (status.data[0])
        await meta(db, "provider:plan", { at: now, ...status.data[0] });
    } catch (e) {
      await meta(db, "provider:plan-error", {
        at: now,
        code: e.code || "status_failed"
      });
    }
    return;
  }
  await db.prepare(
    "UPDATE sync_requests SET started_at=NULL,requested_at=? WHERE finished_at IS NULL AND started_at<?"
  ).bind(now, now - 10 * 6e4).run();
  const job = await db.prepare(
    "UPDATE sync_requests SET started_at=?,attempts=attempts+1 WHERE id=(SELECT id FROM sync_requests WHERE finished_at IS NULL AND started_at IS NULL AND requested_at<=? AND attempts<12 ORDER BY requested_at,id LIMIT 1) AND started_at IS NULL RETURNING id,league_id,attempts"
  ).bind(now, now).first();
  if (!job) return;
  let result;
  try {
    result = await sync(env, false, job.league_id);
  } catch (e) {
    result = { ok: false, code: e.code || "sync_failed" };
  }
  if (result.skipped || !result.ok || result.failedLeagues?.length || result.historyPending?.length) {
    const lock = await db.prepare("SELECT until FROM locks WHERE key='api-cooldown'").first();
    await db.prepare(
      "UPDATE sync_requests SET started_at=NULL,requested_at=?,result=? WHERE id=?"
    ).bind(
      Math.max(Date.now() + 65e3, lock?.until || 0),
      JSON.stringify(result),
      job.id
    ).run();
  } else
    await db.prepare("UPDATE sync_requests SET finished_at=?,result=? WHERE id=?").bind(Date.now(), JSON.stringify(result), job.id).run();
}
async function authorized(req, secret) {
  if (!secret) return false;
  const token = (req.headers.get("Authorization") || "").replace(
    /^Bearer /,
    ""
  );
  const hash = async (x) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(x));
  const a = new Uint8Array(await hash(token)), b = new Uint8Array(await hash(secret));
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
var worker_default = {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    try {
      if (req.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "https://90carlosmachado-cpu.github.io",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Max-Age": "86400"
          }
        });
      if (u.pathname === "/api/admin/provider") {
        if (!await authorized(req, env.ADMIN_TOKEN))
          return json({ error: "N\xE3o autorizado" }, 401);
        if (u.searchParams.get("check") === "leagues") {
          try {
            const r = await api(env, "leagues?id=94", 24 * HOUR2);
            return json({ ok: true, count: r.data.length, stale: r.stale });
          } catch (e) {
            return json({ code: e.code || "error", reason: e.detail }, 502);
          }
        }
        try {
          const r = await providerFetch(env,"https://v3.football.api-sports.io/status", {
            headers: {
              "x-apisports-key": env.API_FOOTBALL_KEY,
              "User-Agent": "LuxTips/2.0",
              Accept: "application/json"
            },
            signal: AbortSignal.timeout(2e4),
            cache: "no-store"
          });
          const text = await r.text();
          let d;
          try {
            d = JSON.parse(text);
          } catch {
          }
          return json({
            http: r.status,
            rateLimit: Object.fromEntries(
              [...r.headers].filter(([k]) => k.includes("ratelimit"))
            ),
            type: r.headers.get("content-type"),
            errorCodes: Object.keys(d?.errors || {}),
            subscription: d?.response?.subscription,
            requests: d?.response?.requests,
            parsed: !!d
          });
        } catch (e) {
          return json(
            {
              kind: e.name,
              reason: String(e.message).replaceAll(env.API_FOOTBALL_KEY, "[redacted]").slice(0, 200)
            },
            502
          );
        }
      }
      if (u.pathname === "/api/admin/sync") {
        if (req.method !== "POST")
          return json({ error: "M\xE9todo n\xE3o permitido" }, 405);
        if (!await authorized(req, env.ADMIN_TOKEN))
          return json({ error: "N\xE3o autorizado" }, 401);
        return json(await sync(env, u.searchParams.get("force") === "1"));
      }
      if (req.method !== "GET")
        return json({ error: "M\xE9todo n\xE3o permitido" }, 405);
      let res;
      if (u.pathname === "/api/health") {
        const s = await env.DB.prepare(
          "SELECT data FROM meta WHERE key='sync'"
        ).first();
        const status = s ? JSON.parse(s.data) : null;
        const live = await env.DB.prepare(
          "SELECT data FROM meta WHERE key='last_live_sync'"
        ).first();
        res = json({
          service: "LuxTips",
          competitions: configuredCompetitions(env),
          version: VERSION2,
          sync: status,
          lastLiveRefresh: live ? JSON.parse(live.data) : null,
          ready: !!status?.ok && !status?.stale && Number.isFinite(status.at) && status.at <= Date.now() && Date.now() - status.at <= HOUR2
        });
      } else if (u.pathname === "/api/games") {
        if (!env.__contextPauseLegacy) ctx.waitUntil(
          runQueuedOpponentHistory(env).then(() => runHistoryCatchup(env)).then((result) => {
            if (result.active) return;
            return runRequestedSync(env).then(() => runQueuedRefresh(env));
          })
        );
        res = json(
          await cachedPublicGames(env, async () => {
            const r = await env.DB.prepare(
              "SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150"
            ).bind(Date.now(), forecastWindow().end).all();
            const { games: candidates, window } = publicGames(r.results);
            const games = await publishedGames(env.DB);
            const importState = await env.DB.prepare(
              "SELECT COUNT(*) pending FROM sync_requests WHERE finished_at IS NULL"
            ).first();
            return {
              games,
              competitions: configuredCompetitions(env),
              imports: { pending: importState?.pending || 0 },
              selectionPolicy: {
                version: PRICING_VERSION,
                minimumOdd: MIN_ODD,
                oddsMaxAgeHours: 6,
                maxAlternativePerDay: 1,
                maxGamesPerDay: 3,
                selectionVersion: SELECTION_POLICY,
                minimumWinnerProbability: MIN_WIN_PROBABILITY,
                minimumAlternativeProbability: MIN_ALTERNATIVE_PROBABILITY,
                historicalValidation: "pending-adequate-historical-odds"
              },
              window,
              updatedAt: games.reduce((n, g) => Math.max(n, g.updatedAt), 0),
              validation: {
                holdout: "Avalia\xE7\xE3o retrospetiva cronol\xF3gica do modelo de vencedor",
                holdoutMatches: winner_multiscale_research_default.pooled.candidate.n,
                model: VERSION2
              }
            };
          })
        );
      } else if (u.pathname === "/api/validation") {
        res = json({
          ...validation_default,
          activeModel: VERSION2,
          legacyModel: "luxg-1-opponent-poisson",
          winnerSelection: winner_review_default,
          luxg: luxg_validation_default,
          winnerModel: winner_multiscale_research_default,
          dailyMarket: daily_market_research_default,
          marketExpansion: market_expansion_research_default,
          pricePolicy: {
            version: PRICING_VERSION,
            minimumOdd: MIN_ODD,
            historicalValidation: null,
            reason: "Os estudos anteriores n\xE3o aplicam o m\xEDnimo de 1,25: faltam odds hist\xF3ricas adequadas."
          }
        });
      } else if (u.pathname === "/api/history") {
        const r = await env.DB.prepare(
          "SELECT COALESCE((SELECT pp.data FROM openfoot_current_picks pp WHERE pp.fixture_id=p.fixture_id AND pp.kickoff=p.kickoff ORDER BY pp.published_at LIMIT 1),p.data) data,r.hg,r.ag,r.settled_at FROM forecasts p JOIN results r ON p.fixture_id=r.fixture_id JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff WHERE f.finished=1 AND p.rowid=(SELECT p2.rowid FROM forecasts p2 WHERE p2.fixture_id=p.fixture_id AND p2.kickoff=p.kickoff ORDER BY p2.created_at DESC,p2.rowid DESC LIMIT 1) ORDER BY p.created_at DESC LIMIT 1000"
        ).all();
        const forecasts = r.results.map((r2) => {
          const f = JSON.parse(r2.data);
          return {
            ...f,
            result: { home: r2.hg, away: r2.ag },
            displayHit: f.displayTip ? outcome(f.displayTip.market, r2.hg, r2.ag) : null,
            winnerHit: f.winnerTip ? outcome(f.winnerTip.market, r2.hg, r2.ag) : null,
            hit: f.recommendation ? outcome(f.recommendation.market, r2.hg, r2.ag) : null
          };
        });
        const publishedRows = await env.DB.prepare(
          `SELECT p.data,p.published_at,r.hg,r.ag FROM (
          SELECT fixture_id,kickoff,published_at,data FROM openfoot_current_picks
          UNION ALL SELECT fixture_id,kickoff,published_at,data FROM openfoot_current_alternatives
        ) p JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff
          JOIN results r ON r.fixture_id=p.fixture_id WHERE f.finished=1 ORDER BY p.published_at DESC LIMIT 1000`
        ).all();
        const publishedSelections = publishedRows.results.map((row) => {
          const g = JSON.parse(row.data);
          return {
            ...g,
            published: { at: row.published_at },
            result: { home: row.hg, away: row.ag },
            winnerHit: g.winnerTip ? outcome(g.winnerTip.market, row.hg, row.ag) : null,
            displayHit: g.displayTip ? outcome(g.displayTip.market, row.hg, row.ag) : null
          };
        });
        const publishedPerformance = {
          total: publishedSelections.length,
          correct: 0,
          byMarket: {}
        };
        for (const g of publishedSelections) {
          const tip = g.displayTip || g.winnerTip;
          if (!tip) continue;
          const hit = outcome(tip.market, g.result.home, g.result.away);
          publishedPerformance.correct += hit === 1 ? 1 : 0;
          const m = publishedPerformance.byMarket[tip.market] ||= {
            total: 0,
            correct: 0
          };
          m.total++;
          m.correct += hit === 1 ? 1 : 0;
        }
        const metrics = {};
        for (const f of forecasts) {
          for (const [k, p] of Object.entries(f.prediction.probabilities)) {
            const y = outcome(k, f.result.home, f.result.away);
            metrics[k] ||= {
              n: 0,
              brier: 0,
              logLoss: 0,
              hits: 0,
              bins: Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }))
            };
            const m = metrics[k];
            m.n++;
            m.brier += (p - y) ** 2;
            m.logLoss -= y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p));
            m.hits += (p >= 0.5 ? 1 : 0) === y ? 1 : 0;
            const b = m.bins[Math.min(9, Math.floor(p * 10))];
            b.n++;
            b.p += p;
            b.y += y;
          }
        }
        for (const m of Object.values(metrics)) {
          m.brier /= m.n;
          m.logLoss /= m.n;
          m.accuracy = m.hits / m.n;
          m.ece = m.bins.reduce((s, b) => s + (b.n ? Math.abs(b.p - b.y) : 0), 0) / m.n;
        }
        res = json({
          forecasts,
          publishedSelections,
          publishedPerformance,
          historyScope: "published-selections-only",
          researchScope: "internal-unpublished-calculations-included",
          modelComparison: compareForecasts(forecasts),
          metrics,
          scope: "Sele\xE7\xE3o publicada quando dispon\xEDvel; nos registos anteriores, \xFAltimo progn\xF3stico pr\xE9-jogo. At\xE9 1000 jogos; resultados regulamentares"
        });
      } else if (u.pathname === "/" || u.pathname === "/index.html") {
        return new Response(index_default, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://luxtips.90carlosmachado.workers.dev; img-src 'self' data:; frame-ancestors 'self' https://web.telegram.org; base-uri 'none'; form-action 'none'"
          }
        });
      } else return json({ error: "N\xE3o encontrado" }, 404);
      res.headers.set(
        "Access-Control-Allow-Origin",
        "https://90carlosmachado-cpu.github.io"
      );
      return res;
    } catch {
      console.error(
        JSON.stringify({
          event: "request_failed",
          path: u.pathname.slice(0, 80)
        })
      );
      return json(
        { error: "Servi\xE7o temporariamente indispon\xEDvel. Tente novamente." },
        503
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runQueuedOpponentHistory(env).then(() => runHistoryCatchup(env)).then((result) => {
        if (result.active) return;
        return sync(env).then(() => runRequestedSync(env));
      }).catch(
        () => console.error(JSON.stringify({ event: "scheduled_sync_failed" }))
      )
    );
  }
};
export {
  worker_default as default
};

export { fit, predict, fit2, predict2, grid, mixtureProjection, competitionEvidence, api, fixtureOdds, normalize, winnerTip, applyPricing, publishDailyPicks, forecastWindow, extraGoalMarkets, parseOdds, publicGames, marketLabel, outcome };
