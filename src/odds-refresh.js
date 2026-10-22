export async function refreshOdds(env) {
  return (await reviewSelections(env)).checks;
}
import { reviewSelections } from "./selection-review.js";
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
