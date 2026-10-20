import { api } from "./provider.js";
import { configuredCompetitions, historyPath } from "./competitions.js";
import { saveFixtures } from "./storage.js";
// One new historical dataset per sync, after current forecasts and prices.
// Previously imported datasets are skipped using their original source timestamp.
export async function backfillHistory(
  env,
  plans,
  now = Date.now(),
  options = {},
) {
  const db = env.DB,
    pending = [];
  let downloaded = false,
    attempts = 0,
    halted = false;
  const maximum = Math.min(4, Math.max(1, Number(options.maxDownloads) || 1));
  for (const { league, season } of plans) {
    let complete = true;
    for (const year of [season, season - 1, season - 2, season - 3]) {
      const path = historyPath(league, year, now),
        key = "api:" + path;
      const cached = await db
        .prepare("SELECT data,expires FROM cache WHERE key=?")
        .bind(key)
        .first();
      let payload;
      try {
        payload = cached ? JSON.parse(cached.data) : null;
      } catch {}
      const fresh = cached?.expires > now && Array.isArray(payload?.items);
      if (!fresh && (attempts >= maximum || halted)) {
        complete = false;
        continue;
      }
      try {
        // Bound attempts even when the provider fails before returning data.
        if (!fresh) {
          downloaded = true;
          attempts++;
        }
        const result = await api(
          env,
          path,
          year === season ? 86400000 : 365 * 86400000,
        );
        downloaded ||= result.fromCache === false;
        if (result.stale || result.refreshFailed || !result.data.length) {
          complete = false;
          continue;
        }
        const imported = await db
          .prepare("SELECT data FROM meta WHERE key=?")
          .bind("history-import:" + path)
          .first();
        if (!imported || JSON.parse(imported.data).at !== result.fetchedAt) {
          await saveFixtures(db, result.data, result.fetchedAt);
          await db
            .prepare(
              "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
            )
            .bind(
              "history-import:" + path,
              JSON.stringify({ at: result.fetchedAt }),
            )
            .run();
        }
      } catch (e) {
        complete = false;
        pending.push({
          league,
          season: year,
          code: e.code || "history_unavailable",
        });
        // A rate limit is global to network calls; cached calculations can continue.
        if (
          ["rate_limit", "rate_limit_cooldown", "daily_budget"].includes(e.code)
        )
          halted = true;
      }
    }
    if (complete)
      await db
        .prepare(
          "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
        )
        .bind("bootstrap:" + league + ":" + season, JSON.stringify({ at: now }))
        .run();
    else if (!pending.some((x) => x.league === league))
      pending.push({ league, code: "history_pending" });
  }
  return { pending, downloaded, attempts };
}

// Enabled only through authenticated D1 administration. No public request can
// choose leagues, seasons, quota or activate an extraordinary import.
export async function runHistoryCatchup(env) {
  const db = env.DB,
    now = Date.now();
  const row = await db
    .prepare("SELECT data FROM meta WHERE key='history:catchup'")
    .first();
  if (!row) return { skipped: true };
  const job = JSON.parse(row.data);
  if (!job.active || !Number.isFinite(job.expiresAt) || job.expiresAt <= now)
    return { skipped: true };
  const lease = now + 120000;
  const lock = await db
    .prepare(
      "INSERT INTO locks(key,until) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING key",
    )
    .bind(lease, now)
    .first();
  if (!lock) return { skipped: true };
  try {
    const plans = [];
    for (const competition of configuredCompetitions(env)) {
      if (!Array.isArray(job.leagues) || !job.leagues.includes(competition.id))
        continue;
      const coverage = await db
        .prepare("SELECT data FROM meta WHERE key=?")
        .bind("coverage:" + competition.id)
        .first();
      const season = coverage ? JSON.parse(coverage.data).season : null;
      if (
        !Number.isInteger(season) ||
        season < 2000 ||
        season > new Date(now).getUTCFullYear() + 1
      )
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
      attempts: result.attempts,
    };
    if (!next.active) next.finishedAt = Date.now();
    await db
      .prepare("UPDATE meta SET data=? WHERE key='history:catchup'")
      .bind(JSON.stringify(next))
      .run();
    return result;
  } finally {
    await db
      .prepare("DELETE FROM locks WHERE key='sync' AND until=?")
      .bind(lease)
      .run();
  }
}
