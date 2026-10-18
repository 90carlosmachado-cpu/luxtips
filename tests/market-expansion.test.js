import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { extraGoalMarkets } from "../src/market-probabilities.js";
import {
  chooseDailyMarkets,
  decorateDailyMarket,
  finalizeDailyMarkets,
} from "../src/daily-markets.js";
import { outcome } from "../src/model.js";
import { parseOdds } from "../src/provider.js";
import { database } from "./db.js";
const golden = JSON.parse(
  fs.readFileSync(new URL("./market-expansion-golden.json", import.meta.url)),
);
const keys = [
  "H",
  "D",
  "A",
  "HX",
  "XA",
  "O15",
  "U15",
  "O25",
  "U25",
  "O35",
  "U35",
  "BY",
  "BN",
  "HO05",
  "AO05",
  "HO15",
  "AO15",
  "O05",
  "U45",
  "HU15",
  "AU15",
  "HU25",
  "AU25",
  "HAP15",
  "AAP15",
];
function gamesFor(day) {
  const now = Date.parse(day.day + "T06:00:00Z");
  return {
    now,
    games: day.games.map((r) => ({
      fixture: {
        id: r.id,
        ts: r.ts,
        home: r.id * 2,
        away: r.id * 2 + 1,
        homeName: "Casa",
        awayName: "Fora",
        status: "NS",
        finished: false,
      },
      prediction: {
        version: "test",
        components: r.components,
        probabilities: Object.fromEntries(
          keys.slice(0, 13).map((k, i) => [k, r.p[i]]),
        ),
      },
      winnerTip: {
        market: keys[r.k],
        probability: r.p[r.k],
        majority: true,
        sourceUpdatedAt: now,
      },
      sourceUpdatedAt: now,
      updatedAt: now,
      phase: "preliminary",
      // Synthetic quotes exercise selector parity only; these are NOT historical odds.
      odds: Object.fromEntries(
        keys.map((k) => [k, { odd: 1.5, at: now, bookmaker: "Test" }]),
      ),
    })),
  };
}
test("new markets and daily choice match independent Python joint-distribution research", () => {
  for (const day of golden) {
    const { now, games } = gamesFor(day);
    for (const [i, g] of games.entries())
      for (const [k, p] of Object.entries(
        extraGoalMarkets(g.prediction.components),
      ))
        assert.ok(Math.abs(p - day.games[i].p[keys.indexOf(k)]) < 1e-10, k);
    const plans = chooseDailyMarkets(games, now);
    assert.equal(plans.length, 1);
    const actual = games.slice(0, 3).map((g) => {
      const d = decorateDailyMarket(g, plans[0], now),
        tip = d.displayTip || d.winnerTip;
      return {
        id: g.fixture.id,
        market: tip.market,
        probability: tip.probability,
      };
    });
    assert.deepEqual(
      actual.map((x) => [x.id, x.market]),
      day.selected.map((x) => [x.id, x.market]),
    );
    actual.forEach((x, i) =>
      assert.ok(Math.abs(x.probability - day.selected[i].probability) < 1e-10),
    );
    assert.ok(actual.length <= 3);
    assert.equal(
      actual.filter((x) => !["H", "A"].includes(x.market)).length,
      1,
    );
  }
});
test("team-goal probability uses mixture of distributions; settlement separates scoring from winning", () => {
  const parts = [
    { weight: 0.5, homeGoals: 1, awayGoals: 2 },
    { weight: 0.5, homeGoals: 3, awayGoals: 1 },
  ];
  const p = extraGoalMarkets(parts);
  assert.ok(Math.abs(p.HO05 - (1 - (Math.exp(-1) + Math.exp(-3)) / 2)) < 1e-12);
  assert.ok(Math.abs(p.HO05 - (1 - Math.exp(-2))) > 0.01);
  assert.ok(p.HO15 < p.HO05);
  assert.deepEqual(
    extraGoalMarkets([{ weight: 2, homeGoals: 1, awayGoals: 1 }]),
    {},
  );
  assert.equal(outcome("HO05", 1, 3), 1);
  assert.equal(outcome("H", 1, 3), 0);
  assert.equal(outcome("HO15", 1, 3), 0);
  assert.equal(outcome("AO15", 1, 3), 1);
  assert.equal(outcome("AO05", 1, 0), 0);
});
test("odds map only the full-match team market; no borrowing a winner or half-time price", () => {
  const now = Date.now(),
    f = {
      fixture: { id: 9 },
      update: new Date(now).toISOString(),
      bookmakers: [
        {
          name: "Book",
          bets: [
            { name: "Match Winner", values: [{ value: "Home", odd: "2.00" }] },
            {
              name: "Total - Home",
              values: [
                { value: "Over 0.5", odd: "1.22" },
                { value: "Over 1.5", odd: "1.80" },
              ],
            },
            {
              name: "Away Team Score a Goal",
              values: [{ value: "Yes", odd: "1.45" }],
            },
            {
              name: "Home Team Score a Goal (1st Half)",
              values: [{ value: "Yes", odd: "3.0" }],
            },
          ],
        },
      ],
    };
  const odds = parseOdds([f], 9, now);
  assert.equal(odds.HO05.odd, 1.22);
  assert.equal(odds.HO15.odd, 1.8);
  assert.equal(odds.AO05.odd, 1.45);
  assert.equal(odds.AO15, undefined);
});
test("schema expansion preserves old reservations byte for byte and prevents a second market", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0001.sql", "0002_daily_markets.sql"])
    db.exec(fs.readFileSync("migrations/" + file, "utf8"));
  db.prepare("INSERT INTO daily_markets VALUES(?,?,?,?,?,?,?)").run(
    "2026-10-18",
    1,
    200,
    "XA",
    "daily-market-v1",
    100,
    '{"original":true}',
  );
  const before = db.prepare("SELECT * FROM daily_markets").all();
  db.exec(fs.readFileSync("migrations/0003_market_choices.sql", "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM daily_markets").all(), before);
  assert.deepEqual(
    db.prepare("SELECT * FROM daily_markets_v1_archive").all(),
    before,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO daily_markets VALUES('2026-10-18',2,200,'HO05','daily-market-v2',100,'{}')",
        )
        .run(),
    /UNIQUE/,
  );
  assert.throws(
    () => db.exec("UPDATE daily_markets SET market='HO05'"),
    /immutable/,
  );
  assert.throws(() => db.exec("DELETE FROM daily_markets"), /immutable/);
  db.prepare(
    "INSERT INTO daily_markets VALUES('2026-10-19',2,200,'HO05','daily-market-v2',100,'{}')",
  ).run();
});
test("expanded market is frozen before kickoff, repeated update cannot create another on the same day", async () => {
  const day = golden.find((d) => d.selected.some((s) => s.market === "O05"));
  const { now, games } = gamesFor(day),
    db = database();
  for (const g of games) {
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
  await finalizeDailyMarkets(db, now);
  const reservation = await db.prepare("SELECT * FROM daily_markets").first();
  assert.equal(reservation.market, "O05");
  const snap = await db.prepare("SELECT * FROM forecasts").first();
  assert.ok(snap.created_at < snap.kickoff);
  assert.equal(JSON.parse(snap.data).sourceUpdatedAt, now);
  await finalizeDailyMarkets(db, now + 1);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM forecasts").first()).n,
    games.length,
  );
  await finalizeDailyMarkets(db, reservation.kickoff + 1);
  assert.deepEqual(
    await db.prepare("SELECT * FROM daily_markets").first(),
    reservation,
  );
});

test("handicap +1.5 has no push and goal limits settle at the correct boundary", () => {
  assert.equal(outcome("HAP15", 0, 1), 1);
  assert.equal(outcome("HAP15", 0, 2), 0);
  assert.equal(outcome("AAP15", 1, 0), 1);
  assert.equal(outcome("AAP15", 2, 0), 0);
  assert.equal(outcome("HU25", 2, 0), 1);
  assert.equal(outcome("HU25", 3, 0), 0);
  assert.equal(outcome("O05", 0, 0), 0);
  assert.equal(outcome("O05", 0, 1), 1);
  assert.equal(outcome("U45", 2, 2), 1);
  assert.equal(outcome("U45", 2, 3), 0);
});
test("odds use one bookmaker with valid coverage, including broad markets, and reject half-time or push lines", () => {
  const now = Date.now(),
    data = [
      {
        fixture: { id: 1 },
        update: new Date(now).toISOString(),
        bookmakers: [
          {
            name: "Sparse",
            bets: [
              { name: "Match Winner", values: [{ value: "Home", odd: "5" }] },
            ],
          },
          {
            name: "Full",
            bets: [
              { name: "Match Winner", values: [{ value: "Home", odd: "2" }] },
              {
                name: "Asian Handicap",
                values: [
                  { value: "Home +1.5", odd: "1.12" },
                  { value: "Home +1", odd: "1.3" },
                ],
              },
              {
                name: "Goals Over/Under",
                values: [{ value: "Over 0.5", odd: "1.04" }],
              },
              {
                name: "Total - Away",
                values: [{ value: "Under 2.5", odd: "1.08" }],
              },
              {
                name: "Asian Handicap - First Half",
                values: [{ value: "Home +1.5", odd: "1.01" }],
              },
            ],
          },
        ],
      },
    ];
  const o = parseOdds(data, 1, now);
  assert.equal(o.H.odd, 2);
  assert.equal(o.HAP15.odd, 1.12);
  assert.equal(o.O05.odd, 1.04);
  assert.equal(o.AU25.odd, 1.08);
  assert.ok(Object.values(o).every((v) => v.bookmaker === "Full"));
});
