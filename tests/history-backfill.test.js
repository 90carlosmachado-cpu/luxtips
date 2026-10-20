import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/worker.js";
import { database } from "./db.js";
import { saveFixtures } from "../src/storage.js";
import { backfillHistory } from "../src/history-backfill.js";
import { api } from "../src/provider.js";

test("sufficient stored history produces a priced provisional pick before historical rate limits; cooldown still blocks network", async () => {
  const DB = database(),
    now = Date.now(),
    old = globalThis.fetch,
    calls = [];
  const env = {
    DB,
    API_FOOTBALL_KEY: "test",
    ADMIN_TOKEN: "private",
    LEAGUES: "94",
    DAILY_BUDGET: "600",
  };
  const item = (id, ts, finished) => ({
    fixture: {
      id,
      date: new Date(ts).toISOString(),
      status: { short: finished ? "FT" : "NS" },
    },
    league: { id: 94, season: 2026, name: "Liga Portugal" },
    teams: { home: { id: 1, name: "Home" }, away: { id: 2, name: "Away" } },
    score: {
      fulltime: { home: finished ? 3 : null, away: finished ? 0 : null },
    },
  });
  await saveFixtures(
    DB,
    Array.from({ length: 100 }, (_, i) =>
      item(i + 1, now - (i + 1) * 86400000, true),
    ),
    now - 1000,
  );
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.pathname === "/leagues")
      return Response.json({
        errors: [],
        response: [
          {
            seasons: [
              {
                year: 2026,
                current: true,
                coverage: { odds: true, injuries: true },
              },
            ],
          },
        ],
      });
    if (u.pathname === "/fixtures" && u.searchParams.has("from"))
      return Response.json({
        errors: [],
        response: [
          item(99999, now + 3600000, false),
          item(99998, now + 3700000, false),
        ],
      });
    if (u.pathname === "/odds") {
      if (u.searchParams.get("fixture") === "99998")
        assert.equal(
          (await DB.prepare("SELECT COUNT(*) n FROM published_picks").first())
            .n,
          1,
          "first priced selection persists before the next network call",
        );
      return Response.json({
        errors: [],
        paging: { current: 1, total: 1 },
        response: [
          {
            fixture: { id: Number(u.searchParams.get("fixture")) },
            update: new Date(now - 1000).toISOString(),
            bookmakers: [
              {
                name: "Test",
                bets: [
                  {
                    name: "Match Winner",
                    values: [
                      { value: "Home", odd: "1.5" },
                      { value: "Draw", odd: "4" },
                      { value: "Away", odd: "7" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    return Response.json({
      errors: { rateLimit: "Too many requests" },
      response: [],
    });
  };
  try {
    const tasks = [];
    const r = await worker.fetch(
      new Request("https://test/api/admin/sync", {
        method: "POST",
        headers: { Authorization: "Bearer private" },
      }),
      env,
      { waitUntil: (p) => tasks.push(p) },
    );
    assert.equal(r.status, 200);
    await Promise.all(tasks);
    const g = JSON.parse(
      (
        await DB.prepare(
          "SELECT data FROM cache WHERE key='forecast:99999'",
        ).first()
      ).data,
    );
    assert.ok(g.prediction.sample >= 12);
    assert.equal(g.prediction.historyIncomplete, true);
    assert.equal(g.phase, "preliminary");
    assert.ok(g.winnerTip.priceEligible);
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) n FROM published_picks").first()).n,
      2,
    );
    assert.ok(
      calls.findIndex((x) => x.startsWith("/odds?")) <
        calls.findIndex((x) => x === "/fixtures?league=94&season=2026"),
    );
    assert.equal(
      await DB.prepare(
        "SELECT data FROM meta WHERE key='bootstrap:94:2026'",
      ).first(),
      null,
    );
    assert.ok(
      (
        await DB.prepare(
          "SELECT until FROM locks WHERE key='api-cooldown'",
        ).first()
      ).until > now,
    );
    const before = calls.length;
    await assert.rejects(
      api(env, "injuries?fixture=123", 1000),
      (e) => e.code === "rate_limit_cooldown",
    );
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = old;
  }
});

test("historical backfill makes at most one uncached attempt, even on failure", async () => {
  const DB = database(),
    old = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    throw new Error("offline");
  };
  try {
    const r = await backfillHistory(
      { DB, API_FOOTBALL_KEY: "test", DAILY_BUDGET: "600" },
      [
        { league: 94, season: 2026 },
        { league: 39, season: 2026 },
      ],
    );
    assert.equal(n, 1);
    assert.equal(r.pending.length, 2);
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) n FROM meta WHERE key LIKE 'bootstrap:%'",
        ).first()
      ).n,
      0,
    );
  } finally {
    globalThis.fetch = old;
  }
});

test("extraordinary catchup is private, bounded, resumable and disables itself after the missing seasons arrive", async () => {
  const { runHistoryCatchup } = await import("../src/history-backfill.js");
  const DB = database(),
    old = globalThis.fetch,
    now = Date.now();
  let calls = 0;
  const env = {
    DB,
    API_FOOTBALL_KEY: "test",
    LEAGUES: "88,848",
    DAILY_BUDGET: "600",
  };
  globalThis.fetch = async (url) => {
    calls++;
    const u = new URL(url),
      league = Number(u.searchParams.get("league")),
      season = Number(u.searchParams.get("season"));
    return Response.json({
      errors: [],
      response: [
        {
          fixture: {
            id: league * 10000 + season,
            date: new Date(now - 86400000).toISOString(),
            status: { short: "FT" },
          },
          league: { id: league, season, name: "Test" },
          teams: { home: { id: 1, name: "H" }, away: { id: 2, name: "A" } },
          score: { fulltime: { home: 1, away: 0 } },
        },
      ],
    });
  };
  try {
    assert.equal((await runHistoryCatchup(env)).skipped, true);
    assert.equal(calls, 0);
    for (const league of [88, 848])
      await DB.prepare("INSERT INTO meta(key,data) VALUES(?,?)")
        .bind("coverage:" + league, JSON.stringify({ season: 2026 }))
        .run();
    await DB.prepare("INSERT INTO meta(key,data) VALUES('history:catchup',?)")
      .bind(
        JSON.stringify({
          active: true,
          leagues: [88, 848, 9999],
          expiresAt: now + 3600000,
        }),
      )
      .run();
    const first = await runHistoryCatchup(env);
    assert.equal(first.attempts, 4);
    assert.equal(calls, 4);
    assert.equal(first.pending.length, 1);
    assert.ok(
      await DB.prepare(
        "SELECT data FROM meta WHERE key='bootstrap:88:2026'",
      ).first(),
    );
    assert.equal(
      await DB.prepare(
        "SELECT data FROM meta WHERE key='bootstrap:848:2026'",
      ).first(),
      null,
    );
    await runHistoryCatchup(env);
    assert.equal(calls, 8);
    const saved = JSON.parse(
      (
        await DB.prepare(
          "SELECT data FROM meta WHERE key='history:catchup'",
        ).first()
      ).data,
    );
    assert.equal(saved.active, false);
    assert.ok(saved.finishedAt);
    assert.equal((await runHistoryCatchup(env)).skipped, true);
    assert.equal(calls, 8);
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) n FROM fixtures").first()).n,
      8,
    );
    assert.equal(
      await DB.prepare("SELECT * FROM locks WHERE key='sync'").first(),
      null,
    );
  } finally {
    globalThis.fetch = old;
  }
});

test("accelerated import stops network requests on the first rate limit and respects expiration and another sync lease", async () => {
  const { runHistoryCatchup } = await import("../src/history-backfill.js");
  const DB = database(),
    old = globalThis.fetch,
    now = Date.now();
  let calls = 0;
  const env = {
    DB,
    API_FOOTBALL_KEY: "test",
    LEAGUES: "88",
    DAILY_BUDGET: "600",
  };
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      errors: { rateLimit: "Too many requests" },
      response: [],
    });
  };
  try {
    await DB.prepare("INSERT INTO meta(key,data) VALUES('coverage:88',?)")
      .bind(JSON.stringify({ season: 2026 }))
      .run();
    const job = { active: true, leagues: [88], expiresAt: now + 3600000 };
    await DB.prepare("INSERT INTO meta(key,data) VALUES('history:catchup',?)")
      .bind(JSON.stringify(job))
      .run();
    await DB.prepare("INSERT INTO locks(key,until) VALUES('sync',?)")
      .bind(now + 60000)
      .run();
    assert.equal((await runHistoryCatchup(env)).skipped, true);
    assert.equal(calls, 0);
    await DB.prepare("DELETE FROM locks WHERE key='sync'").run();
    const first = await runHistoryCatchup(env);
    assert.equal(first.attempts, 1);
    assert.equal(calls, 1);
    assert.ok(first.pending.length);
    await runHistoryCatchup(env);
    assert.equal(calls, 1, "provider cooldown blocks the next batch");
    await DB.prepare("UPDATE meta SET data=? WHERE key='history:catchup'")
      .bind(JSON.stringify({ ...job, expiresAt: now - 1 }))
      .run();
    assert.equal((await runHistoryCatchup(env)).skipped, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = old;
  }
});
