import { api } from "./provider.js";
import { normalize } from "./model.js";
// Extra domestic/cup results improve source coverage. They do not automatically
// change a cross-league probability or inflate its effective training sample.
export async function collectOpponentHistory(env, requests, now = Date.now()) {
  const db = env.DB,
    checks = [];
  const unique = [
    ...new Map(
      requests
        .filter((x) => Number.isSafeInteger(x.id) && x.id > 0)
        .sort((a, b) => b.priority - a.priority)
        .map((x) => [x.id, x]),
    ).values(),
  ].slice(0, 2);
  for (const team of unique) {
    try {
      const response = await api(
        env,
        `fixtures?team=${team.id}&last=50&status=FT-AET-PEN`,
        86400000,
      );
      if (response.stale || response.refreshFailed)
        throw new Error("opponent_history_stale");
      const rows = response.data
        .slice(0, 50)
        .map(normalize)
        .filter(
          (f) =>
            f &&
            f.finished &&
            f.ts < now &&
            (f.home === team.id || f.away === team.id),
        );
      const marker = await db
        .prepare("SELECT data FROM meta WHERE key=?")
        .bind("opponent-history:" + team.id)
        .first();
      if (!marker || JSON.parse(marker.data).sourceAt !== response.fetchedAt) {
        for (let i = 0; i < rows.length; i += 25)
          await db.batch(
            rows
              .slice(i, i + 25)
              .map((f) =>
                db
                  .prepare(
                    "INSERT INTO opponent_history(team_id,fixture_id,kickoff,league_id,source_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT(team_id,fixture_id) DO UPDATE SET kickoff=excluded.kickoff,league_id=excluded.league_id,source_at=excluded.source_at,data=excluded.data WHERE excluded.source_at>opponent_history.source_at",
                  )
                  .bind(
                    team.id,
                    f.id,
                    f.ts,
                    f.league,
                    response.fetchedAt,
                    JSON.stringify(f),
                  ),
              ),
          );
        const data = {
          team: team.id,
          name: team.name,
          sourceAt: response.fetchedAt,
          count: rows.length,
          leagues: [...new Set(rows.map((f) => f.league))],
          trainingStatus: "cross-league-validation-pending",
        };
        await db
          .prepare(
            "INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
          )
          .bind("opponent-history:" + team.id, JSON.stringify(data))
          .run();
      }
      checks.push({ team: team.id, count: rows.length });
    } catch (e) {
      checks.push({
        team: team.id,
        code: e.code || "opponent_history_unavailable",
      });
      if (
        ["rate_limit", "rate_limit_cooldown", "daily_budget"].includes(e.code)
      )
        break;
    }
  }
  return checks;
}

export async function runQueuedOpponentHistory(env) {
  const row = await env.DB.prepare(
    "SELECT data FROM meta WHERE key='opponent-history:request'",
  ).first();
  if (!row) return;
  const job = JSON.parse(row.data),
    now = Date.now();
  if (
    !job.active ||
    !Number.isFinite(job.expiresAt) ||
    job.expiresAt <= now ||
    job.nextAt > now
  )
    return;
  const teams = Array.isArray(job.teams) ? job.teams.slice(0, 2) : [];
  if (!teams.length) return;
  const checks = await collectOpponentHistory(env, teams);
  const complete =
    checks.length === teams.length && checks.every((x) => x.count > 0);
  const lock = await env.DB.prepare(
    "SELECT until FROM locks WHERE key='api-cooldown'",
  ).first();
  await env.DB.prepare(
    "UPDATE meta SET data=? WHERE key='opponent-history:request'",
  )
    .bind(
      JSON.stringify({
        ...job,
        checks,
        active: !complete,
        at: Date.now(),
        nextAt: Math.max(Date.now() + 65000, lock?.until || 0),
      }),
    )
    .run();
}
