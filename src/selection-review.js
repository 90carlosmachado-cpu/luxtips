import { fixtureOdds, parseOdds } from "./provider.js";
import { forecastWindow, publicGames, lisbonDay } from "./window.js";
import { applyPricing } from "./pricing-policy.js";
import { eligible } from "./daily-markets.js";
import { publishDailyPicks } from "./published-picks.js";
export async function cachedFixtureOdds(db, id, now = Date.now()) {
  const row = await db
    .prepare(
      "SELECT data FROM cache WHERE key IN (?,?) ORDER BY CASE WHEN key LIKE 'api:odds-complete%' THEN 0 ELSE 1 END LIMIT 1",
    )
    .bind("api:odds-complete?fixture=" + id, "api:odds?fixture=" + id)
    .first();
  if (!row) return {};
  try {
    const p = JSON.parse(row.data);
    return parseOdds(Array.isArray(p) ? p : p.items || [], id, now);
  } catch {
    return {};
  }
}
export async function reviewSelections(env, now = Date.now()) {
  const db = env.DB,
    w = forecastWindow(now);
  const rows = await db
    .prepare(
      "SELECT c.data,f.data fixture_data FROM fixtures f LEFT JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 250",
    )
    .bind(now, w.end)
    .all();
  const missingDays = new Set(
    rows.results
      .filter((r) => !r.data && JSON.parse(r.fixture_data).status === "NS")
      .map((r) => lisbonDay(JSON.parse(r.fixture_data).ts)),
  );
  let games = publicGames(
    rows.results.filter((r) => r.data),
    now,
  ).games.map((g) => applyPricing(g, now));
  const candidates = games
    .filter((g) => eligible(g, now))
    .sort(
      (a, b) =>
        lisbonDay(a.fixture.ts).localeCompare(lisbonDay(b.fixture.ts)) ||
        b.winnerTip.probability - a.winnerTip.probability ||
        a.fixture.ts - b.fixture.ts ||
        a.fixture.id - b.fixture.id,
    );
  const checks = [];
  let requests = 0;
  for (const g of candidates) {
    const cached = await cachedFixtureOdds(db, g.fixture.id, now);
    if (Object.keys(cached).length) g.odds = cached;
    const reusable = Object.values(cached).some(
      (q) => Number.isFinite(q.at) && q.at <= now && now - q.at < 6 * 3600000,
    );
    try {
      if (!reusable && requests >= 9) continue;
      if (!reusable) requests++;
      const result = reusable
        ? { odds: cached, refreshFailed: false }
        : await fixtureOdds(env, g.fixture.id, now);
      if (result.refreshFailed) throw new Error("odds_refresh_failed");
      g.odds = result.odds;
      g.oddsCheckedAt = Date.now();
      const updated = applyPricing(g, Date.now());
      Object.assign(g, updated);
      await db
        .prepare("UPDATE cache SET data=? WHERE key=?")
        .bind(JSON.stringify(g), "forecast:" + g.fixture.id)
        .run();
      checks.push({ id: g.fixture.id, markets: Object.keys(g.odds).length });
    } catch (e) {
      checks.push({ id: g.fixture.id, code: e.code || "odds_unavailable" });
    }
    // The complete cross-league pool is present before any publication. A failed
    // or slower quote cannot promote a lower-ranked match into a reserved place.
    games = games.map((x) => (x.fixture.id === g.fixture.id ? g : x));
    await publishDailyPicks(
      db,
      games.filter((x) => !missingDays.has(lisbonDay(x.fixture.ts))),
      Date.now(),
    );
    const lock = await db
      .prepare("SELECT until FROM locks WHERE key='api-cooldown'")
      .first();
    if (lock?.until > Date.now()) break;
  }
  await publishDailyPicks(
    db,
    games.filter((x) => !missingDays.has(lisbonDay(x.fixture.ts))),
    Date.now(),
  );
  return { checks, waitingDays: [...missingDays] };
}
