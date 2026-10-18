import { quoteFor } from "./pricing-policy.js";
import { fixtureOdds } from "./provider.js";
import { forecastWindow, publicGames } from "./window.js";
import { finalizeDailyMarkets } from "./daily-markets.js";
import { publishDailyPicks } from "./published-picks.js";
export async function refreshOdds(env) {
  const now = Date.now(),
    window = forecastWindow(now),
    db = env.DB;
  const r = await db
    .prepare(
      "SELECT c.key,c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150",
    )
    .bind(now, window.end)
    .all();
  const games = publicGames(r.results, now).games.filter(
    (g) => g.winnerTip?.majority && !quoteFor(g, g.winnerTip.market, now),
  );
  const checks = [];
  for (const g of games) {
    try {
      const r = await fixtureOdds(env, g.fixture.id, Date.now(), true, true);
      checks.push({
        id: g.fixture.id,
        markets: Object.keys(r.odds).length,
        pages: r.pages,
        records: r.records,
        refreshFailed: r.refreshFailed,
      });
    } catch (e) {
      checks.push({ id: g.fixture.id, code: e.code || "odds_refresh_failed" });
    }
  }
  await finalizeDailyMarkets(db);
  const fresh = await db
    .prepare(
      "SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150",
    )
    .bind(Date.now(), window.end)
    .all();
  await publishDailyPicks(db, publicGames(fresh.results, Date.now()).games);
  return checks;
}
// Only the authenticated Cloudflare/D1 control plane can enqueue a job.
// Public requests cannot choose operations, fixtures or bypass the daily budget.
export async function runQueuedRefresh(env) {
  const now = Date.now();
  const job = await env.DB.prepare(
    "UPDATE maintenance_jobs SET started_at=? WHERE id=(SELECT id FROM maintenance_jobs WHERE kind='refresh-odds' AND started_at IS NULL AND requested_at<=? ORDER BY requested_at LIMIT 1) AND started_at IS NULL RETURNING id",
  )
    .bind(now, now)
    .first();
  if (!job) return;
  let result;
  try {
    result = { ok: true, checks: await refreshOdds(env) };
  } catch (e) {
    result = { ok: false, code: e.code || "refresh_failed" };
  }
  await env.DB.prepare(
    "UPDATE maintenance_jobs SET finished_at=?,result=? WHERE id=?",
  )
    .bind(Date.now(), JSON.stringify(result), job.id)
    .run();
}
