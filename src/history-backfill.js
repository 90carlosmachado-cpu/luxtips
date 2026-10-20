import { api } from "./provider.js";
import { historyPath } from "./competitions.js";
import { saveFixtures } from "./storage.js";
// One new historical dataset per sync, after current forecasts and prices.
// Previously imported datasets are skipped using their original source timestamp.
export async function backfillHistory(env, plans, now = Date.now()) {
  const db = env.DB,
    pending = [];
  let downloaded = false;
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
      if (!fresh && downloaded) {
        complete = false;
        continue;
      }
      try {
        // Bound attempts even when the provider fails before returning data.
        if (!fresh) downloaded = true;
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
          downloaded = true;
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
  return { pending, downloaded };
}
