import { chooseDailyMarkets, MAX_DAILY_GAMES } from "./daily-markets.js";
import { lisbonDay, forecastWindow } from "./window.js";
export const MIN_WIN_PROBABILITY = 0.6;
export const MIN_ALTERNATIVE_PROBABILITY = 0.7;
export const SELECTION_POLICY = "global-favorites-v2";
// These are selection preferences, not calibrated accuracy guarantees.
export async function rankPublicationPool(db, candidates, now) {
  const w = forecastWindow(now);
  const saved = await db
    .prepare(
      "SELECT day,fixture_id,recovered,alternative FROM published_picks WHERE day>=? AND day<=?",
    )
    .bind(w.days[0], w.days[2])
    .all();
  const supplemental = await db
    .prepare("SELECT day FROM published_alternatives WHERE day>=? AND day<=?")
    .bind(w.days[0], w.days[2])
    .all();
  const usedAlternativeDays = new Set([
    ...saved.results.filter((x) => x.alternative).map((x) => x.day),
    ...supplemental.results.map((x) => x.day),
  ]);
  const alternatives = chooseDailyMarkets(candidates, now, {
    verifiedOnly: true,
    alternativeFirst: true,
    minimumProbability: MIN_ALTERNATIVE_PROBABILITY,
  }).filter((x) => !usedAlternativeDays.has(x.day));
  const ids = new Set(saved.results.map((x) => x.fixture_id));
  const selected = new Set(ids);
  for (const day of w.days) {
    const occupied = saved.results.filter(
      (x) => x.day === day && !x.recovered,
    ).length;
    const alt = alternatives.find((x) => x.day === day);
    const pool = candidates
      .filter((g) => lisbonDay(g.fixture.ts) === day && !ids.has(g.fixture.id))
      .map((g) => {
        const isAlt = alt?.fixture_id === g.fixture.id;
        const known =
          [g.odds?.[g.winnerTip.market]]
            .filter(Boolean)
            .some(
              (q) =>
                Number.isFinite(q.at) &&
                q.at <= now &&
                now - q.at < 6 * 3600000,
            ) ||
          (Number.isFinite(g.oddsCheckedAt) &&
            g.oddsCheckedAt <= now &&
            now - g.oddsCheckedAt < 3 * 3600000);
        const win = g.winnerTip.probability >= MIN_WIN_PROBABILITY;
        // An unpriced stronger favourite reserves a place; lower-ranked quoted games
        // must not consume all places just because their bookmaker replied first.
        return {
          g,
          score: isAlt
            ? g.winnerTip.probability + alt.gain
            : g.winnerTip.probability,
          eligible: isAlt || (win && (g.winnerTip.priceEligible || !known)),
        };
      })
      .filter((x) => x.eligible)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.g.fixture.ts - b.g.fixture.ts ||
          a.g.fixture.id - b.g.fixture.id,
      );
    for (const x of pool.slice(0, Math.max(0, MAX_DAILY_GAMES - occupied)))
      selected.add(x.g.fixture.id);
  }
  return candidates.filter((g) => selected.has(g.fixture.id));
}
