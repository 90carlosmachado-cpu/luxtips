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
    /frame-ancestors 'self' https:\/\/web\.telegram\.org/,
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
    assert.ok(
      games.games[0].winnerTip,
      "a newly fetched source is eligible immediately",
    );
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
          "SELECT COUNT(*) n FROM forecasts WHERE fixture_id=99999999 AND phase='final' AND version NOT LIKE '%daily-market-v1%'",
        ).first()
      ).n,
      2,
    );
    await DB.prepare("INSERT INTO results VALUES(?,?,?,?)")
      .bind(99999999, 2, 0, Date.now())
      .run();
    await DB.prepare("UPDATE fixtures SET finished=1 WHERE id=99999999").run();
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) n FROM daily_markets").first()).n,
      games.games[0].winnerTip?.majority ? 1 : 0,
    );
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
test("a published preliminary winner is evaluated even without a final refresh", async () => {
  const DB = database(),
    now = Date.now(),
    kickoff = now - 3600000;
  const fixture = {
    id: 123456,
    ts: kickoff,
    league: 94,
    homeName: "A",
    awayName: "B",
  };
  const forecast = {
    fixture,
    phase: "preliminary",
    winnerTip: { market: "H", label: "A vence" },
    displayTip: { market: "HX", label: "A ou empate" },
    recommendation: null,
    prediction: { probabilities: { H: 0.6, D: 0.25, A: 0.15 } },
  };
  await DB.prepare("INSERT INTO fixtures VALUES(?,?,?,?,?,?)")
    .bind(fixture.id, 94, kickoff, 1, JSON.stringify(fixture), now)
    .run();
  await DB.prepare(
    "INSERT INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      fixture.id,
      "v3:old",
      "preliminary",
      kickoff - 7200000,
      kickoff,
      JSON.stringify({ ...forecast, winnerTip: { market: "A" } }),
    )
    .run();
  await DB.prepare(
    "INSERT INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      fixture.id,
      "v3:new",
      "preliminary",
      kickoff - 3600000,
      kickoff,
      JSON.stringify(forecast),
    )
    .run();
  await DB.prepare("INSERT INTO results VALUES(?,?,?,?)")
    .bind(fixture.id, 1, 1, now)
    .run();
  const r = await worker.fetch(
    new Request("https://test/api/history"),
    { DB },
    { waitUntil() {} },
  );
  const h = await r.json();
  assert.equal(h.forecasts.length, 1);
  assert.equal(h.forecasts[0].winnerHit, 0);
  assert.equal(h.forecasts[0].displayHit, 1);
  assert.equal(h.forecasts[0].phase, "preliminary");
});
test("one failed competition does not block another or delayed result settlement", async () => {
  const DB = database(),
    old = globalThis.fetch,
    now = Date.now(),
    kickoff = now - 7 * 86400000;
  const f = {
    id: 42,
    ts: kickoff,
    league: 94,
    finished: true,
    status: "FT",
    home: 1,
    away: 2,
    homeName: "A",
    awayName: "B",
    hg: 2,
    ag: 0,
  };
  await DB.prepare("INSERT INTO fixtures VALUES(?,?,?,?,?,?)")
    .bind(f.id, 94, kickoff, 1, JSON.stringify(f), now)
    .run();
  const forecast = {
    fixture: f,
    phase: "preliminary",
    winnerTip: { market: "H", label: "A vence" },
    recommendation: null,
    prediction: { probabilities: { H: 0.6, D: 0.25, A: 0.15 } },
  };
  await DB.prepare(
    "INSERT INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      f.id,
      "review",
      "preliminary",
      kickoff - 3600000,
      kickoff,
      JSON.stringify(forecast),
    )
    .run();
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/leagues" && u.searchParams.get("id") === "94")
      return Response.json({ errors: { rateLimit: "limited" }, response: [] });
    return Response.json({
      response:
        u.pathname === "/leagues"
          ? [{ seasons: [{ year: 2026, current: true, coverage: {} }] }]
          : [],
      errors: [],
      paging: { total: 1 },
    });
  };
  try {
    const r = await worker.fetch(
      new Request("https://test/api/admin/sync", {
        method: "POST",
        headers: { Authorization: "Bearer private" },
      }),
      {
        DB,
        ADMIN_TOKEN: "private",
        API_FOOTBALL_KEY: "test",
        LEAGUES: "94,39",
      },
      { waitUntil() {} },
    );
    assert.equal(r.status, 200);
    const result = await r.json();
    assert.equal(result.failedLeagues[0].league, 94);
    assert.ok(
      await DB.prepare("SELECT data FROM meta WHERE key='coverage:39'").first(),
    );
    const settlement = await DB.prepare(
      "SELECT hg,ag FROM results WHERE fixture_id=42",
    ).first();
    assert.deepEqual({ ...settlement }, { hg: 2, ag: 0 });
  } finally {
    globalThis.fetch = old;
  }
});
