import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./db.js";
import { publishDailyPicks, publishedGames } from "../src/published-picks.js";
import { fixtureOdds } from "../src/provider.js";
import { runQueuedRefresh } from "../src/odds-refresh.js";
const now = Date.parse("2026-10-18T08:00:00Z");
function game(id = 1) {
  return {
    fixture: {
      id,
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
    odds: { H: { odd: 1.5, at: now, bookmaker: "Book" } },
    prediction: { probabilities: { H: 0.7, D: 0.2, A: 0.1 } },
  };
}
test("published selection survives kickoff, stale prices, changed predictions and a loss until Lisbon midnight", async () => {
  const db = database(),
    g = game();
  await publishDailyPicks(db, [g], now);
  let rows = await publishedGames(db, now + 10 * 3600000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].winnerTip.odd, 1.5);
  g.winnerTip.market = "A";
  g.odds.A = { odd: 2, at: now + 1000, bookmaker: "Other" };
  await publishDailyPicks(db, [g], now + 1000);
  const f = { ...g.fixture, finished: true, status: "FT", hg: 0, ag: 1 };
  await db
    .prepare("INSERT INTO fixtures VALUES(?,?,?,?,?,?)")
    .bind(1, 39, f.ts, 1, JSON.stringify(f), now + 7200000)
    .run();
  rows = await publishedGames(db, now + 10 * 3600000);
  assert.equal(rows[0].winnerTip.market, "H");
  assert.equal(rows[0].result.hit, 0);
  assert.equal(rows[0].winnerTip.odd, 1.5);
  assert.equal(
    (await publishedGames(db, Date.parse("2026-10-18T23:00:00Z"))).length,
    0,
  );
  await assert.rejects(
    db.prepare("DELETE FROM published_picks").run(),
    /immutable/,
  );
});
test("multiple winners, maximum one alternative and no replacement by a later higher probability", async () => {
  const db = database(),
    games = [game(1), game(2), game(3), game(4)];
  for (const g of games.slice(0, 2)) {
    g.odds.HX = { odd: 1.25, at: now, bookmaker: "Book" };
    g.displayTip = { market: "HX", probability: 0.9 };
  }
  await publishDailyPicks(db, games, now);
  const r = await publishedGames(db, now);
  assert.equal(r.length, 3);
  assert.equal(r.filter((g) => g.displayTip).length, 1);
  const better = game(5);
  better.winnerTip.probability = 0.99;
  await publishDailyPicks(db, [better], now + 1000);
  assert.equal(
    (await publishedGames(db, now)).some((g) => g.fixture.id === 5),
    false,
  );
});
test("fixture odds follow all pages, retain bookmaker identity and reuse cached paging metadata", async () => {
  const db = database(),
    original = globalThis.fetch;
  let calls = 0;
  const stamp = Date.now();
  globalThis.fetch = async (url) => {
    calls++;
    const page = new URL(url).searchParams.get("page") || "1";
    return Response.json({
      errors: [],
      paging: { current: Number(page), total: 2 },
      response: [
        {
          fixture: { id: 123 },
          update: new Date(stamp).toISOString(),
          bookmakers:
            page === "1"
              ? [
                  {
                    name: "Incomplete",
                    bets: [
                      {
                        name: "Both Teams Score",
                        values: [{ value: "Yes", odd: "1.8" }],
                      },
                    ],
                  },
                ]
              : [
                  {
                    name: "Full",
                    bets: [
                      {
                        name: "Match Winner",
                        values: [
                          { value: "Home", odd: "1.4" },
                          { value: "Away", odd: "6" },
                          { value: "Draw", odd: "4" },
                        ],
                      },
                    ],
                  },
                ],
        },
      ],
    });
  };
  try {
    const env = { DB: db, API_FOOTBALL_KEY: "test", DAILY_BUDGET: 600 };
    const r = await fixtureOdds(env, 123, stamp);
    assert.equal(r.odds.H.odd, 1.4);
    assert.equal(r.odds.H.bookmaker, "Full");
    assert.equal(calls, 2);
    assert.equal((await fixtureOdds(env, 123, stamp)).odds.H.odd, 1.4);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
test("an absent control-plane maintenance job makes no provider request", async () => {
  const db = database();
  await runQueuedRefresh({ DB: db });
  assert.equal((await db.prepare("SELECT count(*) n FROM quota").first()).n, 0);
});

test("provider minute limit pauses new network requests without exposing credentials", async () => {
  const db = database(),
    old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      errors: { rateLimit: "Too many requests" },
      response: [],
    });
  };
  try {
    const env = {
      DB: db,
      API_FOOTBALL_KEY: "private-test-key",
      DAILY_BUDGET: 600,
    };
    await assert.rejects(fixtureOdds(env, 123), /rate_limit/);
    await assert.rejects(fixtureOdds(env, 124), /rate_limit_cooldown/);
    assert.equal(calls, 1);
    const row = await db
      .prepare(
        "SELECT data FROM meta WHERE key='provider-error:odds?fixture=123'",
      )
      .first();
    assert.ok(!row.data.includes("private-test-key"));
  } finally {
    globalThis.fetch = old;
  }
});
test("history evaluates the published selection, not a later changed forecast", async () => {
  const { default: worker } = await import("../dist/worker.js");
  const db = database(),
    g = game(),
    f = { ...g.fixture, finished: true, status: "FT", hg: 0, ag: 1 };
  await publishDailyPicks(db, [g], now);
  await db
    .prepare("INSERT INTO fixtures VALUES(?,?,?,?,?,?)")
    .bind(f.id, 39, f.ts, 1, JSON.stringify(f), now + 7200000)
    .run();
  await db
    .prepare("INSERT INTO results VALUES(?,?,?,?)")
    .bind(f.id, 0, 1, now + 7200000)
    .run();
  const later = { ...g, winnerTip: { ...g.winnerTip, market: "A" } };
  await db
    .prepare(
      "INSERT INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
    )
    .bind(f.id, "later", "preliminary", now + 1000, f.ts, JSON.stringify(later))
    .run();
  const r = await worker.fetch(
    new Request("https://test/api/history"),
    { DB: db },
    { waitUntil() {} },
  );
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.forecasts[0].winnerTip.market, "H");
  assert.equal(body.forecasts[0].winnerHit, 0);
});
