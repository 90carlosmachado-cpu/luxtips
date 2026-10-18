import { forecastWindow, lisbonDay, publicGames } from "./window.js";
import { marketProbabilities, marketLabel } from "./market-probabilities.js";
import { MIN_ODD, quoteFor, applyPricing } from "./pricing-policy.js";
import { parseOdds } from "./provider.js";
export const POLICY_VERSION = "daily-market-v3-priced";
export const MAX_DAILY_GAMES = 3;
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
    .filter((g) => eligible(g, now) && quoteFor(g, g.winnerTip.market, now))
    .sort(
      (a, b) =>
        b.winnerTip.probability - a.winnerTip.probability ||
        a.fixture.ts - b.fixture.ts ||
        a.fixture.id - b.fixture.id,
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
        home ? "HAP15" : "AAP15",
      ];
      for (const market of allowed) {
        const gain = p[market] - p[g.winnerTip.market];
        if (
          !Number.isFinite(gain) ||
          gain <= 0 ||
          p[market] > 1 ||
          !quoteFor(g, market, now)
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
    }
    return best ? [best] : [];
  });
}
export function decorateDailyMarket(g, plan, now) {
  g = applyPricing(g, now);
  if (
    !plan ||
    !eligible(g, now) ||
    plan.fixture_id !== g.fixture.id ||
    plan.kickoff !== g.fixture.ts ||
    plan.day !== lisbonDay(g.fixture.ts) ||
    !marketLabel(plan.market, g.fixture) ||
    !quoteFor(g, plan.market, now)
  )
    return g;
  // Team-specific choices keep the reserved side; never reinterpret the market.
  const homeMarkets = ["HX", "HO05", "HO15", "HAP15"],
    awayMarkets = ["XA", "AO05", "AO15", "AAP15"];
  if (
    (homeMarkets.includes(plan.market) && g.winnerTip.market !== "H") ||
    (awayMarkets.includes(plan.market) && g.winnerTip.market !== "A")
  )
    return g;
  const probabilities = marketProbabilities(g.prediction);
  const probability = probabilities[plan.market];
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
  return {
    ...g,
    prediction: { ...g.prediction, probabilities },
    displayTip: {
      minimumMarketOdd: MIN_ODD,
      priceEligible: true,
      market: plan.market,
      label: marketLabel(plan.market, g.fixture),
      probability,
      selectionType:
        plan.policy_version === "daily-market-v1"
          ? "daily-draw-protection"
          : "daily-alternative",
      policyVersion: plan.policy_version,
      provisional: g.winnerTip.provisional,
      sourceUpdatedAt: g.winnerTip.sourceUpdatedAt,
      reliability: null,
      calibrationStatus:
        "Regra com odd mínima de 1,25 ainda sem validação histórica adequada",
      fairOdd: 1 / probability,
      minimumOdd: Math.ceil((1.03 / probability) * 100) / 100,
      odd: valid ? o.odd : null,
      bookmaker: valid ? o.bookmaker : null,
      oddsAt: valid ? o.at : null,
      expectedValue: valid ? probability * o.odd - 1 : null,
      valueStatus: valid
        ? probability * o.odd > 1
          ? "Valor esperado positivo estimado; rentabilidade não demonstrada."
          : "A odd não oferece valor esperado positivo segundo o modelo."
        : "Valor por confirmar: sem odds reais recentes.",
      reason:
        "Um mercado alternativo por dia, escolhido pelo maior aumento de probabilidade entre os três favoritos. A seleção original fica registada.",
      risks: [
        ...(g.winnerTip.risks || []),
        "Este mercado pode cobrir mais resultados do que a vitória; uma maior taxa de acerto não demonstra lucro.",
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
  const { games: storedGames } = publicGames(rows.results, now);
  const games = [];
  for (const original of storedGames) {
    let odds = { ...original.odds };
    // Reuse already downloaded prices; no extra provider requests or quota.
    const cached = await db
      .prepare(
        "SELECT data FROM cache WHERE key IN (?,?) ORDER BY CASE WHEN key LIKE 'api:odds-complete%' THEN 0 ELSE 1 END LIMIT 1",
      )
      .bind(
        "api:odds-complete?fixture=" + original.fixture.id,
        "api:odds?fixture=" + original.fixture.id,
      )
      .first();
    if (cached) {
      try {
        const payload = JSON.parse(cached.data),
          fresh = parseOdds(
            Array.isArray(payload) ? payload : payload.items || [],
            original.fixture.id,
            now,
          );
        if (
          Object.keys(fresh).length &&
          Math.max(...Object.values(fresh).map((q) => q.at)) >=
            Math.max(
              0,
              ...Object.values(odds).map((q) =>
                Number.isFinite(q.at) ? q.at : 0,
              ),
            )
        )
          odds = fresh;
      } catch {
        /* Missing or invalid prices never qualify. */
      }
    }
    games.push(applyPricing({ ...original, odds }, now));
  }
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
    const old = rows.results.find(
      (r) => JSON.parse(r.data).fixture.id === g.fixture.id,
    ).data;
    if (JSON.stringify(decorated) === old) continue;
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
