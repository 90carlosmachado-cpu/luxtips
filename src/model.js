// All features are derived strictly from completed matches before the cutoff.
export const VERSION = "poisson-opponent-v1-favorites-v2";
const DAY = 86400000;
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
export function normalize(f) {
  const id = f?.fixture?.id,
    ts = Date.parse(f?.fixture?.date),
    home = f?.teams?.home,
    away = f?.teams?.away;
  if (
    !Number.isInteger(id) ||
    !Number.isFinite(ts) ||
    !Number.isInteger(home?.id) ||
    !Number.isInteger(away?.id) ||
    home.id === away.id ||
    !Number.isInteger(f?.league?.id)
  )
    return null;
  const full = f.score?.fulltime;
  const hg = full?.home,
    ag = full?.away;
  const finished =
    ["FT", "AET", "PEN"].includes(f.fixture.status?.short) &&
    Number.isInteger(hg) &&
    Number.isInteger(ag) &&
    hg >= 0 &&
    ag >= 0;
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
    neutral: f.fixture.venue?.id === null,
  };
}
export function fit(history, cutoff, opts = {}) {
  const half = opts.halfLife || 180,
    prior = opts.prior || 8;
  // Two-hour exclusion also prevents same-kickoff / in-progress match leakage.
  const rows = history
    .filter(
      (r) =>
        r.finished &&
        r.ts + 2 * 3600000 < cutoff &&
        r.ts > cutoff - 3 * 365 * DAY,
    )
    .map((r) => ({ ...r }))
    .sort((a, b) => a.ts - b.ts);
  const teams = {};
  let sw = 0,
    sh = 0,
    sa = 0;
  for (const r of rows) {
    r._w = Math.exp((-Math.log(2) * (cutoff - r.ts)) / DAY / half);
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
        away: { n: 0, gf: 0, ga: 0 },
      };
    for (const [t, side, gf, ga] of [
      [r.home, "home", r.hg, r.ag],
      [r.away, "away", r.ag, r.hg],
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
      });
      x.recent = x.recent.slice(-5);
      x[side].n++;
      x[side].gf += gf;
      x[side].ga += ga;
    }
    const h = teams[r.home],
      a = teams[r.away],
      expected = 1 / (1 + 10 ** ((a.elo - h.elo - 60) / 400)),
      actual = r.hg > r.ag ? 1 : r.hg === r.ag ? 0.5 : 0;
    h.elo += 20 * (actual - expected);
    a.elo -= 20 * (actual - expected);
  }
  const bh = (sh + 15) / (sw + 10),
    ba = (sa + 12) / (sw + 10);
  // Alternating regularised Poisson strength estimates with opponent correction.
  for (let it = 0; it < 25; it++) {
    const sums = {};
    for (const t of Object.keys(teams))
      sums[t] = { gf: prior, ef: prior, ga: prior, ea: prior };
    for (const r of rows) {
      const w = r._w,
        h = teams[r.home],
        a = teams[r.away],
        hs = sums[r.home],
        as = sums[r.away];
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
        0.5 * x.attack + (0.5 * sums[t].gf) / sums[t].ef,
        0.25,
        3,
      );
      x.defense = clip(
        0.5 * x.defense + (0.5 * sums[t].ga) / sums[t].ea,
        0.25,
        3,
      );
    }
  }
  return { teams, bh, ba, n: rows.length, cutoff, opts };
}
export function grid(lh, la) {
  const hp = [Math.exp(-lh)],
    ap = [Math.exp(-la)];
  for (let i = 1; i <= 22; i++) {
    hp[i] = (hp[i - 1] * lh) / i;
    ap[i] = (ap[i - 1] * la) / i;
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
    HA: out.H + out.A,
  };
}
export const LABELS = {
  H: "Vitória da casa",
  D: "Empate",
  A: "Vitória de fora",
  HX: "Casa ou empate",
  XA: "Empate ou fora",
  HA: "Sem empate",
  O15: "Mais de 1,5 golos",
  U15: "Menos de 1,5 golos",
  O25: "Mais de 2,5 golos",
  U25: "Menos de 2,5 golos",
  O35: "Mais de 3,5 golos",
  U35: "Menos de 3,5 golos",
  BY: "Ambas marcam · Sim",
  BN: "Ambas marcam · Não",
};
export function predict(state, f) {
  const h = state.teams[f.home],
    a = state.teams[f.away];
  const lh = clip(state.bh * (h?.attack || 1) * (a?.defense || 1), 0.15, 5),
    la = clip(state.ba * (a?.attack || 1) * (h?.defense || 1), 0.15, 5);
  const ew = state.opts.eloWeight || 0,
    delta = clip(((h?.elo || 1500) - (a?.elo || 1500)) / 400, -1, 1);
  const homeGoals = clip(lh * Math.exp(ew * delta), 0.15, 5),
    awayGoals = clip(la * Math.exp(-ew * delta), 0.15, 5);
  const probabilities = grid(homeGoals, awayGoals),
    sample = Math.min(h?.w || 0, a?.w || 0);
  const risks = [
    "Modelo de golos; não representa xG medido por eventos.",
    "Ausências e alinhamentos não ajustam probabilidades sem validação histórica.",
  ];
  if (sample < 12)
    risks.push("Amostra efetiva insuficiente ou equipa recém-promovida.");
  if (
    Math.max(state.cutoff - (h?.last || 0), state.cutoff - (a?.last || 0)) >
    45 * DAY
  )
    risks.push("Uma equipa tem dados recentes limitados.");
  const team = (x) =>
    x
      ? {
          attack: x.attack,
          defense: x.defense,
          elo: x.elo,
          n: x.n,
          effectiveSample: x.w,
          recent: x.recent,
          home: x.home,
          away: x.away,
          restDays: Math.floor((f.ts - x.last) / DAY),
        }
      : null;
  return {
    version: VERSION,
    league: f.league,
    homeName: f.homeName,
    awayName: f.awayName,
    cutoff: state.cutoff,
    homeGoals,
    awayGoals,
    probabilities,
    sample,
    quality: sample >= 20 ? "Boa" : sample >= 12 ? "Moderada" : "Insuficiente",
    teams: { home: team(h), away: team(a) },
    risks,
  };
}
export function outcome(k, h, a) {
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
  }[k]
    ? 1
    : 0;
}
export function wilson(w, n) {
  if (!n) return [0, 1];
  const z = 1.96,
    p = w / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - m, c + m];
}
// Adjacent bins avoid rejecting strong favorites solely because a narrow
// 10-point bin is sparse. Never pool competitions' eligibility or change gates.
export function calibrationBin(market, p) {
  const bins = market?.bins || [];
  const direct = bins.find((b) => p >= b.low && p < b.high);
  if (direct?.n >= 100) return direct;
  const windows = [];
  for (let start = 0; start < bins.length; start++) {
    for (let end = start; end < Math.min(start + 3, bins.length); end++) {
      const bs = bins.slice(start, end + 1),
        low = bs[0].low,
        high = bs.at(-1).high;
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
        interval: wilson(wins, n),
      });
    }
  }
  // Window choice uses counts/probabilities only, never observed hit rates.
  return (
    windows.sort(
      (a, b) =>
        a.high - a.low - (b.high - b.low) ||
        Math.abs(a.mean - p) - Math.abs(b.mean - p),
    )[0] || null
  );
}
export function select(pred, validation, odds = {}, now = Date.now()) {
  if (pred.sample < 12) return null;
  const candidates = [];
  for (const [k, p] of Object.entries(pred.probabilities)) {
    const v = validation?.markets?.[k],
      bin = ["H", "A"].includes(k)
        ? calibrationBin(v, p)
        : v?.bins?.find((b) => p >= b.low && p < b.high);
    // Reliability measured on untouched holdout, distinct from model probability.
    if (
      !v?.enabled ||
      !v.byLeague?.[pred.league]?.enabled ||
      !bin ||
      bin.n < 100 ||
      Math.abs(bin.rate - bin.mean) > 0.08 ||
      p < 0.65
    )
      continue;
    const o = odds[k],
      validOdd =
        o &&
        Number.isFinite(o.odd) &&
        o.odd > 1 &&
        o.at <= now &&
        now - o.at < 6 * 3600000;
    const ev = validOdd ? p * o.odd - 1 : null;
    if (ev !== null && ev < 0.03) continue;
    candidates.push({
      market: k,
      label:
        k === "H"
          ? `${pred.homeName || "Equipa da casa"} vence`
          : k === "A"
            ? `${pred.awayName || "Equipa visitante"} vence`
            : LABELS[k],
      selectionType: ["H", "A"].includes(k) ? "favorite" : "alternative",
      fairOdd: 1 / p,
      minimumOdd: Math.ceil((1.03 / p) * 100) / 100,
      probability: p,
      reliability: {
        n: bin.n,
        observed: bin.rate,
        interval: bin.interval,
        low: bin.low,
        high: bin.high,
      },
      odd: validOdd ? o.odd : null,
      bookmaker: validOdd ? o.bookmaker : null,
      oddsAt: validOdd ? o.at : null,
      expectedValue: ev,
      reason: `${["H", "A"].includes(k) ? "Favorito com superioridade estimada após ajuste à força dos adversários. " : "Alternativa elegível pelos critérios de calibração. "}${pred.homeGoals.toFixed(2)}–${pred.awayGoals.toFixed(2)} golos estimados; pelo menos ${Math.floor(pred.sample)} jogos efetivos por equipa.`,
      valueStatus:
        ev === null
          ? "Valor não avaliado: sem odds reais recentes."
          : "Valor esperado estimado; rentabilidade não demonstrada.",
    });
  }
  // Prefer a qualified outright favorite. A double chance is a separate fallback,
  // never a way to inflate the probability shown for an eligible outright pick.
  return (
    candidates.sort(
      (a, b) =>
        Number(b.selectionType === "favorite") -
          Number(a.selectionType === "favorite") ||
        b.probability - a.probability,
    )[0] || null
  );
}
