import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/worker.js";
import { database } from "./db.js";
test("HTTP routing, CORS, CSP and admin authentication", async () => {
  const env = { DB: database(), ADMIN_TOKEN: "private" },
    ctx = { waitUntil() {} };
  for (const path of [
    "/api/health",
    "/api/games",
    "/api/history",
    "/api/validation",
  ]) {
    const r = await worker.fetch(
      new Request("https://example.com" + path),
      env,
      ctx,
    );
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("Access-Control-Allow-Origin"));
  }
  let r = await worker.fetch(new Request("https://example.com/"), env, ctx);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /LuxTips/);
  assert.match(
    r.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
  r = await worker.fetch(
    new Request("https://example.com/api/admin/sync", { method: "POST" }),
    env,
    ctx,
  );
  assert.equal(r.status, 401);
  r = await worker.fetch(
    new Request("https://example.com/?url=https://evil.com&key=x"),
    env,
    ctx,
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Content-Type"), /html/);
  r = await worker.fetch(
    new Request("https://example.com/api/games", { method: "POST" }),
    env,
    ctx,
  );
  assert.equal(r.status, 405);
});
test("full synchronization, cached repeat, immutable final forecast and settlement", async () => {
  const DB = database(),
    env = {
      DB,
      ADMIN_TOKEN: "private",
      API_FOOTBALL_KEY: "test",
      LEAGUES: "94",
      DAILY_BUDGET: "100",
    },
    tasks = [],
    ctx = {
      waitUntil(p) {
        tasks.push(p);
      },
    },
    old = globalThis.fetch;
  const future = {
    fixture: {
      id: 99999999,
      date: new Date(Date.now() + 40 * 60000).toISOString(),
      status: { short: "NS" },
    },
    league: { id: 94, season: 2026, name: "Liga Portugal" },
    teams: {
      home: { id: 211, name: "Benfica" },
      away: { id: 212, name: "Porto" },
    },
    score: { fulltime: { home: null, away: null } },
  };
  globalThis.fetch = async (url) => {
    const u = new URL(url),
      year = u.searchParams.get("season");
    let response = [];
    if (u.pathname === "/leagues")
      response = [{ seasons: [{ year: 2026, current: true, coverage: {} }] }];
    else if (u.pathname === "/fixtures" && u.searchParams.has("from"))
      response = [future];
    else if (u.pathname === "/fixtures")
      response =
        year === "2026"
          ? Array.from({ length: 100 }, (_, i) => ({
              fixture: {
                id: 800000 + i,
                date: new Date(
                  Date.now() - (101 - i) * 3 * 86400000,
                ).toISOString(),
                status: { short: "FT" },
              },
              league: { id: 94, season: 2026, name: "Test league" },
              teams: {
                home: { id: i % 2 ? 211 : 212, name: "H" },
                away: { id: i % 2 ? 212 : 211, name: "A" },
              },
              score: { fulltime: { home: i % 4, away: i % 3 } },
            }))
          : [];
    return Response.json({ response, errors: [], paging: { total: 1 } });
  };
  try {
    let r = await worker.fetch(
      new Request("https://test/api/admin/sync", {
        method: "POST",
        headers: { Authorization: "Bearer private" },
      }),
      env,
      ctx,
    );
    assert.equal(r.status, 200);
    await Promise.all(tasks);
    let health = await (
      await worker.fetch(new Request("https://test/api/health"), env, ctx)
    ).json();
    assert.equal(health.sync.ok, true);
    let games = await (
      await worker.fetch(new Request("https://test/api/games"), env, ctx)
    ).json();
    assert.equal(games.games.length, 1);
    assert.equal(games.games[0].phase, "final");
    assert.ok(games.games[0].prediction.sample > 12);
    const original = await DB.prepare(
      "SELECT data FROM forecasts WHERE fixture_id=99999999",
    ).first();
    await worker.fetch(
      new Request("https://test/api/admin/sync", {
        method: "POST",
        headers: { Authorization: "Bearer private" },
      }),
      env,
      ctx,
    );
    await Promise.all(tasks);
    assert.deepEqual(
      await DB.prepare(
        "SELECT data FROM forecasts WHERE fixture_id=99999999",
      ).first(),
      original,
    );
    future.fixture.date = new Date(Date.now() + 50 * 60000).toISOString();
    await DB.prepare("DELETE FROM cache WHERE key LIKE '%from=%'").run();
    await worker.fetch(
      new Request("https://test/api/admin/sync", {
        method: "POST",
        headers: { Authorization: "Bearer private" },
      }),
      env,
      ctx,
    );
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) n FROM forecasts WHERE fixture_id=99999999 AND phase='final'",
        ).first()
      ).n,
      2,
    );
    await DB.prepare("INSERT INTO results VALUES(?,?,?,?)")
      .bind(99999999, 2, 0, Date.now())
      .run();
    // Multiple versions remain archived but one final per fixture is evaluated.
    await DB.prepare(
      "INSERT INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) SELECT fixture_id,version||'-review',phase,created_at+1,kickoff,data FROM forecasts WHERE fixture_id=99999999 AND phase='final' ORDER BY kickoff DESC LIMIT 1",
    ).run();
    r = await worker.fetch(new Request("https://test/api/history"), env, ctx);
    assert.equal((await r.json()).forecasts.length, 1);
  } finally {
    globalThis.fetch = old;
  }
});
