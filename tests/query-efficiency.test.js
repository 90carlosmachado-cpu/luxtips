import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./db.js";
import { cachedPublicGames, PUBLIC_GAMES_CACHE } from "../src/public-cache.js";
import { publishDailyPicks } from "../src/published-picks.js";
import { forecastWindow } from "../src/window.js";

test("homepage cache reuses the response, expires in 60 seconds and crosses Lisbon midnight safely", async () => {
  const DB = database(),
    env = { DB, LEAGUES: "94" },
    now = Date.parse("2026-10-20T22:59:30Z");
  let calls = 0;
  const compute = async () => ({
    games: [{ id: ++calls }],
    window: forecastWindow(now),
    updatedAt: 123,
  });
  await cachedPublicGames(env, compute, now);
  const hit = await cachedPublicGames(env, compute, now + 10000);
  assert.equal(calls, 1);
  assert.equal(hit.window.start, now + 10000);
  assert.equal(hit.updatedAt, 123);
  await cachedPublicGames(env, compute, now + 31000);
  assert.equal(
    calls,
    2,
    "a still-fresh response from yesterday must not survive Lisbon midnight",
  );
  await cachedPublicGames({ ...env, LEAGUES: "94,88" }, compute, now + 32000);
  assert.equal(
    calls,
    3,
    "competition configuration changes invalidate the cached scope",
  );
  await cachedPublicGames({ ...env, LEAGUES: "94,88" }, compute, now + 92001);
  assert.equal(calls, 4);
});

test("a newly published selection invalidates the response; replaying the same frozen pick preserves the cache", async () => {
  const DB = database(),
    env = { DB },
    now = Date.parse("2026-10-20T08:00:00Z");
  await cachedPublicGames(
    env,
    async () => ({ games: [], window: forecastWindow(now) }),
    now,
  );
  const g = {
    fixture: {
      id: 1,
      ts: now + 3600000,
      status: "NS",
      finished: false,
      home: 1,
      away: 2,
    },
    winnerTip: {
      market: "H",
      probability: 0.7,
      majority: true,
      sourceUpdatedAt: now,
    },
    odds: { H: { odd: 1.5, at: now, bookmaker: "Test" } },
    prediction: { probabilities: { H: 0.7, D: 0.2, A: 0.1 } },
  };
  await publishDailyPicks(DB, [g], now);
  assert.equal(
    await DB.prepare("SELECT data FROM cache WHERE key=?")
      .bind(PUBLIC_GAMES_CACHE)
      .first(),
    null,
  );
  await cachedPublicGames(
    env,
    async () => ({ games: [g], window: forecastWindow(now) }),
    now,
  );
  await publishDailyPicks(DB, [g], now + 1);
  assert.ok(
    await DB.prepare("SELECT data FROM cache WHERE key=?")
      .bind(PUBLIC_GAMES_CACHE)
      .first(),
  );
  assert.equal(
    (await DB.prepare("SELECT COUNT(*) n FROM published_picks").first()).n,
    1,
  );
});

test("upcoming search uses a bounded status/time index and latest snapshots use their fixture/kickoff index", () => {
  const DB = database();
  const plan = DB.sql
    .prepare(
      "EXPLAIN QUERY PLAN SELECT c.data,f.data fixture_data FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff LIMIT 150",
    )
    .all(1000, 2000)
    .map((x) => x.detail)
    .join("\n");
  assert.match(plan, /SEARCH f USING INDEX fixtures_status_time/);
  assert.doesNotMatch(plan, /SCAN f|TEMP B-TREE/);
  const historical = DB.sql
    .prepare(
      "EXPLAIN QUERY PLAN SELECT data FROM fixtures WHERE league IN (?) AND finished=1 AND kickoff<? AND kickoff>? ORDER BY kickoff",
    )
    .all(94, 2000, 1000)
    .map((x) => x.detail)
    .join("\n");
  assert.match(historical, /fixtures_league_time/);
  const latest = DB.sql
    .prepare(
      "EXPLAIN QUERY PLAN SELECT data FROM forecasts WHERE fixture_id=? AND kickoff=? ORDER BY created_at DESC,id DESC LIMIT 1",
    )
    .all(1, 2000)
    .map((x) => x.detail)
    .join("\n");
  assert.match(latest, /forecasts_fixture_kickoff_created/);
  assert.doesNotMatch(latest, /TEMP B-TREE/);
});
