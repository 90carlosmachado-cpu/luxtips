import { forecastWindow, lisbonDay, publicGames } from "./window.js";
export const POLICY_VERSION = "daily-market-v1";
const HOUR = 3600000;
export function eligible(g, now) {
  const f = g.fixture,
    w = g.winnerTip;
  return (
    f?.status === "NS" &&
    !f.finished &&
    f.ts > now &&
    f.ts < forecastWindow(now).end &&
    w?.majority &&
    ["H", "A"].includes(w.market) &&
    Number.isFinite(w.probability) &&
    w.probability >= 0.5 &&
    w.probability <= 1 &&
    Number.isFinite(w.sourceUpdatedAt) &&
    w.sourceUpdatedAt <= now &&
    now - w.sourceUpdatedAt <= 24 * HOUR
  );
}
export function chooseDailyMarkets(games, now) {
  const days = new Map();
  for (const g of games
    .filter((g) => eligible(g, now))
    .sort(
      (a, b) =>
        b.winnerTip.probability - a.winnerTip.probability ||
        a.fixture.ts - b.fixture.ts ||
        a.fixture.id - b.fixture.id,
    )) {
    const day = lisbonDay(g.fixture.ts);
    if (!days.has(day)) days.set(day, []);
    if (days.get(day).length < 3) days.get(day).push(g);
  }
  return [...days].flatMap(([day, selected]) => {
    let best = null;
    for (const g of selected) {
      const market = g.winnerTip.market === "H" ? "HX" : "XA";
      const p = g.prediction.probabilities,
        gain = p[market] - p[g.winnerTip.market];
      if (
        !Number.isFinite(gain) ||
        gain <= 0 ||
        p[market] > 1 ||
        Math.abs(gain - p.D) > 1e-6
      )
        continue;
      if (!best || gain > best.gain)
        best = {
          day,
          fixture_id: g.fixture.id,
          kickoff: g.fixture.ts,
          market,
          policy_version: POLICY_VERSION,
          gain,
          game: g,
        };
    }
    return best ? [best] : [];
  });
}
export function decorateDailyMarket(g, plan, now) {
  if (
    !plan ||
    !eligible(g, now) ||
    plan.fixture_id !== g.fixture.id ||
    plan.kickoff !== g.fixture.ts ||
    plan.day !== lisbonDay(g.fixture.ts) ||
    plan.market !== (g.winnerTip.market === "H" ? "HX" : "XA")
  )
    return g;
  const probability = g.prediction.probabilities[plan.market];
  if (
    !Number.isFinite(probability) ||
    probability < g.winnerTip.probability ||
    probability > 1
  )
    return g;
  const o = g.odds?.[plan.market];
  const valid =
    o &&
    Number.isFinite(o.odd) &&
    o.odd > 1 &&
    Number.isFinite(o.at) &&
    o.at <= now &&
    now - o.at < 6 * HOUR;
  const team = plan.market === "HX" ? g.fixture.homeName : g.fixture.awayName;
  return {
    ...g,
    displayTip: {
      market: plan.market,
      label: `${team} ou empate`,
      probability,
      selectionType: "daily-draw-protection",
      policyVersion: plan.policy_version,
      provisional: g.winnerTip.provisional,
      sourceUpdatedAt: g.winnerTip.sourceUpdatedAt,
      reliability: null,
      calibrationStatus:
        "Política retrospetiva; confirmação prospetiva pendente",
      fairOdd: 1 / probability,
      minimumOdd: Math.ceil((1.03 / probability) * 100) / 100,
      odd: valid ? o.odd : null,
      bookmaker: valid ? o.bookmaker : null,
      oddsAt: valid ? o.at : null,
      expectedValue: valid ? probability * o.odd - 1 : null,
      valueStatus: valid
        ? "Valor estimado; rentabilidade não demonstrada."
        : "Valor por confirmar: sem odds reais recentes.",
      reason:
        "Proteção do empate reservada a um único jogo por dia, escolhida pelo maior aumento de probabilidade entre os três favoritos.",
      risks: [
        ...(g.winnerTip.risks || []),
        "A dupla hipótese cobre dois resultados; uma maior taxa de acerto não demonstra lucro.",
      ],
    },
  };
}
export async function readDailyMarkets(db, now) {
  const days = forecastWindow(now).days;
  return (
    await db
      .prepare("SELECT * FROM daily_markets WHERE day>=? AND day<=?")
      .bind(days[0], days[2])
      .all()
  ).results;
}
// Reservations survive kickoff, cancellation and policy updates. Never recycle a day.
export async function finalizeDailyMarkets(db, now = Date.now()) {
  const rows = await db
    .prepare(
      "SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150",
    )
    .bind(now, forecastWindow(now).end)
    .all();
  const { games } = publicGames(rows.results, now);
  let plans = await readDailyMarkets(db, now);
  for (const choice of chooseDailyMarkets(games, now)) {
    if (plans.some((p) => p.day === choice.day)) continue;
    const g = decorateDailyMarket(choice.game, choice, now);
    await db
      .prepare(
        "INSERT OR IGNORE INTO daily_markets(day,fixture_id,kickoff,market,policy_version,created_at,data) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        choice.day,
        choice.fixture_id,
        choice.kickoff,
        choice.market,
        POLICY_VERSION,
        now,
        JSON.stringify(g),
      )
      .run();
  }
  plans = await readDailyMarkets(db, now);
  let annotated = 0;
  for (const g of games) {
    const decorated = decorateDailyMarket(
      g,
      plans.find((p) => p.fixture_id === g.fixture.id),
      now,
    );
    if (
      !decorated.displayTip ||
      JSON.stringify(decorated) === JSON.stringify(g)
    )
      continue;
    const data = JSON.stringify(decorated),
      phase = g.phase === "final" ? "final" : "preliminary";
    const version = `${g.prediction.version || "forecast"}@${g.fixture.ts}:${POLICY_VERSION}:${now}`;
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
        )
        .bind(g.fixture.id, version, phase, now, g.fixture.ts, data),
      db
        .prepare("UPDATE cache SET data=? WHERE key=? AND data=?")
        .bind(
          data,
          "forecast:" + g.fixture.id,
          rows.results.find(
            (r) => JSON.parse(r.data).fixture.id === g.fixture.id,
          ).data,
        ),
    ]);
    annotated++;
  }
  return { reserved: plans.length, annotated };
}
