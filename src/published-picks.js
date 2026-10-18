import { forecastWindow, lisbonDay } from "./window.js";
import { eligible, MAX_DAILY_GAMES } from "./daily-markets.js";
import { applyPricing } from "./pricing-policy.js";
import { outcome } from "./model.js";
export async function publishDailyPicks(db, games, now = Date.now()) {
  const candidates = games
    .map((g) => applyPricing(g, now))
    .filter(
      (g) => eligible(g, now) && (g.displayTip || g.winnerTip)?.priceEligible,
    )
    .sort(
      (a, b) =>
        b.winnerTip.probability - a.winnerTip.probability ||
        a.fixture.ts - b.fixture.ts ||
        a.fixture.id - b.fixture.id,
    );
  for (const g of candidates) {
    const tip = g.displayTip || g.winnerTip,
      day = lisbonDay(g.fixture.ts),
      alternative = +!["H", "A"].includes(tip.market);
    // Single atomic INSERT guards concurrent requests and never replaces a pick.
    await db
      .prepare(
        `INSERT OR IGNORE INTO published_picks(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM published_picks WHERE day=? AND recovered=0)<?`,
      )
      .bind(
        day,
        g.fixture.id,
        g.fixture.ts,
        tip.market,
        alternative,
        now,
        now,
        JSON.stringify(g),
        day,
        MAX_DAILY_GAMES,
      )
      .run();
  }
}
export async function publishedGames(db, now = Date.now()) {
  const w = forecastWindow(now);
  const rows = await db
    .prepare(
      `SELECT p.*, f.data current_fixture FROM published_picks p LEFT JOIN fixtures f ON f.id=p.fixture_id WHERE p.day>=? AND p.day<=? ORDER BY p.day,p.published_at,p.fixture_id`,
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
