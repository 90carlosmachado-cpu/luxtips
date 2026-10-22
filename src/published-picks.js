import {
  rankPublicationPool,
  MIN_WIN_PROBABILITY,
  MIN_ALTERNATIVE_PROBABILITY,
  SELECTION_POLICY,
} from "./publication-ranking.js";
import { invalidatePublicGames } from "./public-cache.js";
import { forecastWindow, lisbonDay } from "./window.js";
import {
  eligible,
  MAX_DAILY_GAMES,
  chooseDailyMarkets,
  decorateDailyMarket,
} from "./daily-markets.js";
import { applyPricing } from "./pricing-policy.js";
import { outcome } from "./model.js";
export async function publishDailyPicks(db, games, now = Date.now()) {
  let modified = false;
  // Old daily_markets rows are research/reservation records, not publications.
  // Strip their overlays before selecting; only an actually published alternative
  // consumes the daily allowance.
  const pool = games
    .map((g) => {
      const clean = { ...g };
      delete clean.displayTip;
      return applyPricing(clean, now);
    })
    .filter((g) => eligible(g, now))
    .sort(
      (a, b) =>
        b.winnerTip.probability - a.winnerTip.probability ||
        a.fixture.ts - b.fixture.ts ||
        a.fixture.id - b.fixture.id,
    );
  const candidates = await rankPublicationPool(db, pool, now);
  for (const choice of chooseDailyMarkets(candidates, now, {
    verifiedOnly: true,
    alternativeFirst: true,
    minimumProbability: MIN_ALTERNATIVE_PROBABILITY,
  })) {
    const g = decorateDailyMarket(
      choice.game,
      { ...choice, policy_version: "published-alternative-v1" },
      now,
    );
    if (!g.displayTip) continue;
    g.selectionPolicy = SELECTION_POLICY;
    const existing = await db
      .prepare(
        "SELECT fixture_id FROM published_picks WHERE day=? AND fixture_id=?",
      )
      .bind(choice.day, choice.fixture_id)
      .first();
    const params = [
      choice.day,
      choice.fixture_id,
      choice.kickoff,
      choice.market,
      now,
      now,
      JSON.stringify(g),
      choice.day,
      choice.day,
    ];
    if (existing) {
      const write = await db
        .prepare(
          `INSERT OR IGNORE INTO published_alternatives(day,fixture_id,kickoff,market,published_at,recorded_at,data)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM published_picks WHERE day=? AND alternative=1)
        AND NOT EXISTS(SELECT 1 FROM published_alternatives WHERE day=?)`,
        )
        .bind(...params)
        .run();
      modified ||= !!write.meta?.changes;
    } else {
      const write = await db
        .prepare(
          `INSERT OR IGNORE INTO published_picks(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data)
        SELECT ?,?,?,?,1,?,?,? WHERE NOT EXISTS(SELECT 1 FROM published_picks WHERE day=? AND alternative=1)
        AND NOT EXISTS(SELECT 1 FROM published_alternatives WHERE day=?)
        AND (SELECT COUNT(*) FROM published_picks WHERE day=? AND recovered=0)<?`,
        )
        .bind(...params, choice.day, MAX_DAILY_GAMES)
        .run();
      modified ||= !!write.meta?.changes;
    }
  }
  for (const g of candidates.filter(
    (g) =>
      g.winnerTip?.priceEligible &&
      g.winnerTip.probability >= MIN_WIN_PROBABILITY,
  )) {
    const day = lisbonDay(g.fixture.ts),
      tip = g.winnerTip;
    g.selectionPolicy = SELECTION_POLICY;
    const write = await db
      .prepare(
        `INSERT OR IGNORE INTO published_picks(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data)
      SELECT ?,?,?,?,0,?,?,? WHERE (SELECT COUNT(*) FROM published_picks WHERE day=? AND recovered=0)<?`,
      )
      .bind(
        day,
        g.fixture.id,
        g.fixture.ts,
        tip.market,
        now,
        now,
        JSON.stringify(g),
        day,
        MAX_DAILY_GAMES,
      )
      .run();
    modified ||= !!write.meta?.changes;
  }
  if (modified) await invalidatePublicGames(db);
}

export async function publishedGames(db, now = Date.now()) {
  const w = forecastWindow(now);
  const rows = await db
    .prepare(
      `SELECT p.*, f.data current_fixture FROM (
        SELECT day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data FROM published_picks
        UNION ALL SELECT day,fixture_id,kickoff,market,1,published_at,recorded_at,0,data FROM published_alternatives
      ) p LEFT JOIN fixtures f ON f.id=p.fixture_id WHERE p.day>=? AND p.day<=? ORDER BY p.day,p.published_at,p.fixture_id`,
    )
    .bind(w.days[0], w.days[2])
    .all();
  return rows.results.map((row) => {
    const g = JSON.parse(row.data),
      current = row.current_fixture
        ? JSON.parse(row.current_fixture)
        : g.fixture;
    // Original fixture, market, probability and price are never overwritten.
    const tip = g.displayTip || g.winnerTip;
    const finished =
      current.finished &&
      Number.isInteger(current.hg) &&
      Number.isInteger(current.ag) &&
      current.ts === g.fixture.ts;
    return {
      ...g,
      published: {
        at: row.published_at,
        recordedAt: row.recorded_at,
        recovered: !!row.recovered,
        day: row.day,
        alternative: !!row.alternative,
      },
      currentFixture: current,
      result: finished
        ? {
            home: current.hg,
            away: current.ag,
            hit: outcome(tip.market, current.hg, current.ag),
          }
        : null,
    };
  });
}
