import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./db.js";
import {
  chooseDailyMarkets,
  decorateDailyMarket,
  finalizeDailyMarkets,
} from "../src/daily-markets.js";
const now = Date.parse("2026-10-18T08:00:00Z");
function game(id, H = 0.6, D = 0.25, ts = now + 3600000) {
  const A = 1 - H - D,
    market = H > A ? "H" : "A";
  return {
    fixture: {
      id,
      ts,
      home: id * 2,
      away: id * 2 + 1,
      homeName: "Home " + id,
      awayName: "Away " + id,
      league: 94,
      status: "NS",
      finished: false,
    },
    prediction: {
      version: "test",
      probabilities: { H, D, A, HX: H + D, XA: A + D },
    },
    winnerTip: {
      market,
      probability: Math.max(H, A),
      majority: Math.max(H, A) >= 0.5,
      sourceUpdatedAt: now,
      provisional: false,
      reliability: { n: 100 },
    },
    sourceUpdatedAt: now,
    updatedAt: now,
    phase: "preliminary",
    odds: {},
  };
}
async function seed(db, g) {
  await db
    .prepare("INSERT INTO fixtures VALUES(?,?,?,?,?,?)")
    .bind(g.fixture.id, 94, g.fixture.ts, 0, JSON.stringify(g.fixture), now)
    .run();
  await db
    .prepare("INSERT INTO cache VALUES(?,?,?)")
    .bind(
      "forecast:" + g.fixture.id,
      JSON.stringify(g),
      g.fixture.ts + 86400000,
    )
    .run();
}
test("same top-three fixtures, one alternative chosen by draw gain, not absolute double-chance probability", () => {
  const gs = [
    game(1, 0.8, 0.1),
    game(2, 0.65, 0.2),
    game(3, 0.55, 0.3),
    game(4, 0.5, 0.4),
  ];
  const before = JSON.stringify(gs),
    plans = chooseDailyMarkets(gs, now);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].fixture_id, 3);
  const decorated = gs.map((g) => decorateDailyMarket(g, plans[0], now));
  assert.equal(decorated.filter((g) => g.displayTip).length, 1);
  assert.deepEqual(
    decorated.map((g) => g.fixture.id),
    gs.map((g) => g.fixture.id),
  );
  assert.equal(JSON.stringify(gs), before);
  assert.ok(Math.abs(decorated[2].displayTip.probability - 0.85) < 1e-12);
  assert.equal(decorated[2].displayTip.odd, null);
  assert.equal(decorated[2].displayTip.reliability, null);
  assert.deepEqual(decorated[2].winnerTip, gs[2].winnerTip);
});
test("separate Lisbon days, deterministic ties, invalid source and started fixtures excluded", () => {
  const gs = [
    game(2),
    game(1),
    game(3, 0.6, 0.25, now + 86400000),
    game(4, 0.6, 0.25, now),
  ];
  const stale = game(5);
  stale.winnerTip.sourceUpdatedAt = now - 25 * 3600000;
  gs.push(stale);
  const plans = chooseDailyMarkets(gs, now);
  assert.deepEqual(
    plans.map((p) => p.fixture_id),
    [1, 3],
  );
  const away = game(7, 0.15, 0.25);
  const p = chooseDailyMarkets([away], now)[0];
  assert.equal(p.market, "XA");
  assert.match(
    decorateDailyMarket(away, p, now).displayTip.label,
    /Away 7 ou empate/,
  );
  const postponed = game(8);
  postponed.fixture.status = "PST";
  assert.equal(chooseDailyMarkets([postponed], now).length, 0);
});
test("reservation persists after kickoff; no second protection, no historical snapshot rewrite", async () => {
  const db = database(),
    a = game(1, 0.55, 0.3),
    b = game(2, 0.7, 0.15, now + 4 * 3600000);
  await seed(db, a);
  await seed(db, b);
  assert.deepEqual(await finalizeDailyMarkets(db, now), {
    reserved: 1,
    annotated: 1,
  });
  const original = await db.prepare("SELECT * FROM forecasts").all();
  const cache = JSON.parse(
    (await db.prepare("SELECT data FROM cache WHERE key='forecast:1'").first())
      .data,
  );
  assert.equal(cache.sourceUpdatedAt, now);
  assert.equal(cache.updatedAt, now);
  assert.equal(cache.displayTip.market, "HX");
  assert.deepEqual(await finalizeDailyMarkets(db, now + 1), {
    reserved: 1,
    annotated: 0,
  });
  assert.deepEqual(await finalizeDailyMarkets(db, now + 2 * 3600000), {
    reserved: 1,
    annotated: 0,
  });
  assert.deepEqual(await db.prepare("SELECT * FROM forecasts").all(), original);
  assert.equal(
    JSON.parse(
      (
        await db
          .prepare("SELECT data FROM cache WHERE key='forecast:2'")
          .first()
      ).data,
    ).displayTip,
    undefined,
  );
  await assert.rejects(
    db.prepare("UPDATE daily_markets SET market='XA'").run(),
    /immutable/,
  );
  await assert.rejects(
    db.prepare("DELETE FROM daily_markets").run(),
    /immutable/,
  );
  // Postponement or another model cannot recycle the same date.
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO daily_markets SELECT day,2,kickoff,'XA','new',created_at,data FROM daily_markets",
      )
      .run(),
    /UNIQUE/,
  );
});
test("a locked side and kickoff cannot silently switch, alternative odds are separate", () => {
  const g = game(1),
    plan = chooseDailyMarkets([g], now)[0];
  g.odds.H = { odd: 2, at: now, bookmaker: "x" };
  assert.equal(decorateDailyMarket(g, plan, now).displayTip.odd, null);
  g.odds.HX = { odd: 1.3, at: now, bookmaker: "x" };
  const d = decorateDailyMarket(g, plan, now);
  assert.equal(d.displayTip.odd, 1.3);
  assert.equal(d.displayTip.expectedValue, d.displayTip.probability * 1.3 - 1);
  assert.equal(
    decorateDailyMarket(
      { ...g, fixture: { ...g.fixture, ts: g.fixture.ts + 1 } },
      plan,
      now,
    ).displayTip,
    undefined,
  );
  assert.equal(
    decorateDailyMarket(
      { ...g, winnerTip: { ...g.winnerTip, market: "A" } },
      plan,
      now,
    ).displayTip,
    undefined,
  );
});
