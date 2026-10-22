import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./db.js";
import { publishDailyPicks, publishedGames } from "../src/published-picks.js";
import { reviewSelections } from "../src/selection-review.js";
import { collectOpponentHistory } from "../src/opponent-history.js";
const now = Date.parse("2026-10-22T08:00:00Z");
function game(id, p = 0.7, priced = true) {
  return {
    fixture: {
      id,
      ts: now + 3600000,
      status: "NS",
      finished: false,
      home: id * 2,
      away: id * 2 + 1,
      homeName: "H" + id,
      awayName: "A" + id,
      league: id % 2 ? 94 : 88,
    },
    prediction: { probabilities: { H: p, D: 0.15, A: 1 - p - 0.15 } },
    winnerTip: {
      market: "H",
      probability: p,
      majority: p >= 0.5,
      sourceUpdatedAt: now,
    },
    odds: priced ? { H: { odd: 1.5, at: now, bookmaker: "Test" } } : {},
  };
}

test("publication compares all leagues, rejects marginal winners and reserves places for stronger unpriced favourites", async () => {
  const db = database(),
    pending = game(1, 0.8, false),
    gs = [game(5, 0.505), game(4, 0.65), game(3, 0.68), game(2, 0.7), pending];
  await publishDailyPicks(db, gs, now);
  let saved = await publishedGames(db, now);
  assert.deepEqual(saved.map((g) => g.fixture.id).sort(), [2, 3]);
  pending.odds.H = { odd: 1.3, at: now, bookmaker: "Test" };
  await publishDailyPicks(db, gs.reverse(), now + 1);
  saved = await publishedGames(db, now);
  assert.deepEqual(saved.map((g) => g.fixture.id).sort(), [1, 2, 3]);
});

test("a known price below 1.25 does not reserve a place and a late better favourite cannot rewrite a published selection", async () => {
  const db = database(),
    cheap = game(1, 0.9);
  cheap.odds.H.odd = 1.1;
  const gs = [cheap, game(2, 0.8), game(3, 0.75), game(4, 0.7)];
  await publishDailyPicks(db, gs, now);
  const before = (
    await db
      .prepare("SELECT data FROM published_picks ORDER BY fixture_id")
      .all()
  ).results;
  assert.deepEqual(
    (await publishedGames(db, now)).map((g) => g.fixture.id).sort(),
    [2, 3, 4],
  );
  await publishDailyPicks(db, [game(5, 0.95)], now + 1);
  assert.deepEqual(
    (
      await db
        .prepare("SELECT data FROM published_picks ORDER BY fixture_id")
        .all()
    ).results,
    before,
  );
});

test("the new alternative floor is 70%, with one alternative per Lisbon day", async () => {
  const db = database(),
    g = game(1, 0.6);
  g.prediction.probabilities.O25 = 0.69;
  g.odds.O25 = { odd: 1.8, at: now, bookmaker: "Test" };
  await publishDailyPicks(db, [g], now);
  assert.equal((await publishedGames(db, now))[0].displayTip, undefined);
  const db2 = database();
  g.prediction.probabilities.O25 = 0.75;
  await publishDailyPicks(db2, [g, game(2, 0.7)], now);
  const r = await publishedGames(db2, now);
  assert.equal(r.filter((x) => x.displayTip).length, 1);
  assert.ok(r.find((x) => x.displayTip).displayTip.probability >= 0.7);
});

test("supplemental opponent data validates team and time, reuses API cache and never enters the training fixture table", async () => {
  const db = database(),
    old = globalThis.fetch,
    stamp = Date.now();
  let calls = 0;
  const item = (id, team, ts) => ({
    fixture: { id, date: new Date(ts).toISOString(), status: { short: "FT" } },
    league: { id: 318, season: 2026, name: "Cyprus" },
    teams: { home: { id: team, name: "H" }, away: { id: 9, name: "A" } },
    score: { fulltime: { home: 1, away: 0 } },
  });
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      errors: [],
      response: [
        item(11, 3402, stamp - 86400000),
        item(12, 3402, stamp + 86400000),
        item(13, 99, stamp - 86400000),
      ],
    });
  };
  try {
    const env = { DB: db, API_FOOTBALL_KEY: "test", DAILY_BUDGET: "600" };
    const result = await collectOpponentHistory(
      env,
      [{ id: 3402, name: "Omonia", priority: 1 }],
      stamp,
    );
    assert.equal(result[0].count, 1);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM opponent_history").first()).n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM fixtures").first()).n,
      0,
    );
    await collectOpponentHistory(
      env,
      [{ id: 3402, name: "Omonia", priority: 1 }],
      stamp,
    );
    assert.equal(calls, 1);
    const status = JSON.parse(
      (
        await db
          .prepare("SELECT data FROM meta WHERE key='opponent-history:3402'")
          .first()
      ).data,
    );
    assert.equal(status.trainingStatus, "cross-league-validation-pending");
  } finally {
    globalThis.fetch = old;
  }
});

test("global review holds publication when a league fixture has not been analysed", async () => {
  const db = database(),
    stamp = Date.now(),
    g = game(1, 0.8);
  g.fixture.ts = stamp + 3600000;
  g.winnerTip.sourceUpdatedAt = stamp;
  g.odds.H.at = stamp;
  for (const id of [1, 2]) {
    const f = { ...g.fixture, id };
    await db
      .prepare("INSERT INTO fixtures VALUES(?,?,?,?,?,?)")
      .bind(id, 94, f.ts, 0, JSON.stringify(f), stamp)
      .run();
  }
  await db
    .prepare("INSERT INTO cache VALUES(?,?,?)")
    .bind("forecast:1", JSON.stringify(g), stamp + 86400000)
    .run();
  await db
    .prepare("INSERT INTO cache VALUES(?,?,?)")
    .bind(
      "api:odds-complete?fixture=1",
      JSON.stringify({
        items: [
          {
            fixture: { id: 1 },
            update: new Date(stamp).toISOString(),
            bookmakers: [
              {
                name: "Test",
                bets: [
                  {
                    name: "Match Winner",
                    values: [{ value: "Home", odd: "1.5" }],
                  },
                ],
              },
            ],
          },
        ],
        fetchedAt: stamp,
      }),
      stamp + 3600000,
    )
    .run();
  const result = await reviewSelections(
    { DB: db, API_FOOTBALL_KEY: "test" },
    stamp,
  );
  assert.equal(result.waitingDays.length, 1);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM published_picks").first()).n,
    0,
  );
});
