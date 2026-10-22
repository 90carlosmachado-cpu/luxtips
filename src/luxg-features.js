// Every input is constructed from completed games before state.cutoff.
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
export const FEATURE_NAMES = [
  "intercept",
  "home",
  "logOwnBase",
  "logOtherBase",
  "eloAdvantage",
  "recentAttack",
  "opponentRecentDefense",
  "venueAttack",
  "opponentVenueDefense",
  "restAdvantage",
  "league39",
  "league61",
  "league78",
  "league94",
  "league135",
  "league140",
];
const logRatio = (observed, expected, prior) =>
  Math.log((observed + prior) / (expected + prior));
function recent(state, t, defense = false) {
  const x = state.teams[t];
  if (!x) return 0;
  let actual = 0,
    expected = 0;
  for (const r of x.recent) {
    const opponent = state.teams[r.opponentId];
    if (!opponent) continue;
    actual += defense ? r.ga : r.gf;
    expected += defense
      ? (r.side === "home" ? state.ba : state.bh) * opponent.attack * x.defense
      : (r.side === "home" ? state.bh : state.ba) * x.attack * opponent.defense;
  }
  return clip(
    logRatio(actual, expected, (4 * (state.bh + state.ba)) / 2),
    -1,
    1,
  );
}
function venue(state, t, side, defense = false) {
  const v = state.teams[t]?.[side];
  if (!v) return 0;
  return clip(
    logRatio(
      defense ? v.weightedGA || 0 : v.weightedGF || 0,
      defense ? v.expectedGA || 0 : v.expectedGF || 0,
      (8 * (state.bh + state.ba)) / 2,
    ),
    -1,
    1,
  );
}
export function luxgFeatures(state, f, baseHome, baseAway) {
  const h = state.teams[f.home],
    a = state.teams[f.away];
  const rest = (t) => clip((f.ts - (t?.last || f.ts)) / 86400000, 3, 14);
  const side = (home) => {
    const own = home ? h : a,
      other = home ? a : h,
      t = home ? f.home : f.away,
      o = home ? f.away : f.home;
    return [
      1,
      home ? 1 : 0,
      Math.log(home ? baseHome : baseAway),
      Math.log(home ? baseAway : baseHome),
      clip(((own?.elo || 1500) - (other?.elo || 1500)) / 400, -2, 2),
      recent(state, t),
      recent(state, o, true),
      venue(state, t, home ? "home" : "away"),
      venue(state, o, home ? "away" : "home", true),
      (rest(own) - rest(other)) / 7,
      ...[39, 61, 78, 94, 135, 140].map((l) => (f.league === l ? 1 : 0)),
    ];
  };
  return [side(true), side(false)];
}
