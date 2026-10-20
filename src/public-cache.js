import { forecastWindow, lisbonDay } from "./window.js";
export const PUBLIC_GAMES_CACHE = "public:games:v1";
export async function cachedPublicGames(env, compute, now = Date.now()) {
  const scope = lisbonDay(now) + ":" + String(env.LEAGUES || "default");
  const saved = await env.DB.prepare(
    "SELECT data,expires FROM cache WHERE key=?",
  )
    .bind(PUBLIC_GAMES_CACHE)
    .first();
  if (saved?.expires > now) {
    try {
      const payload = JSON.parse(saved.data);
      if (payload.scope === scope && Array.isArray(payload.value?.games))
        return { ...payload.value, window: forecastWindow(now) };
    } catch {}
  }
  const value = await compute();
  await env.DB.prepare(
    "INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires",
  )
    .bind(PUBLIC_GAMES_CACHE, JSON.stringify({ scope, value }), now + 60000)
    .run();
  return value;
}
export async function invalidatePublicGames(db) {
  await db
    .prepare("DELETE FROM cache WHERE key=?")
    .bind(PUBLIC_GAMES_CACHE)
    .run();
}
