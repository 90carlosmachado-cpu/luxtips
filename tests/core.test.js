import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  grid,
  fit,
  predict,
  normalize,
  outcome,
  select,
  wilson,
} from "../src/model.js";
import { api, parseOdds } from "../src/provider.js";
import { database } from "./db.js";
test("score distribution normalized, complementary markets coherent", () => {
  for (const h of [0.15, 1, 2.5, 5])
    for (const a of [0.15, 1, 2.5, 5]) {
      const p = grid(h, a);
      assert.ok(Math.abs(p.H + p.D + p.A - 1) < 1e-10);
      for (const v of Object.values(p)) assert.ok(v >= 0 && v <= 1);
      assert.ok(p.O15 >= p.O25 && p.O25 >= p.O35);
      assert.ok(Math.abs(p.BY + p.BN - 1) < 1e-10);
    }
});
test("future outcomes cannot affect fitted state and input remains immutable", () => {
  const r = {
    id: 1,
    ts: 1000,
    home: 1,
    away: 2,
    homeName: "H",
    awayName: "A",
    hg: 2,
    ag: 1,
    finished: true,
  };
  const before = JSON.stringify(r),
    cutoff = 3 * 3600000;
  assert.deepEqual(
    fit([r], cutoff),
    fit([r, { ...r, ts: cutoff + 1000, hg: 99 }], cutoff),
  );
  assert.equal(JSON.stringify(r), before);
});
test("insufficient data never recommends", () => {
  const p = predict(fit([], Date.now()), {
    home: 1,
    away: 2,
    ts: Date.now() + 100000,
    league: 94,
  });
  assert.equal(select(p, {}), null);
  assert.equal(p.quality, "Insuficiente");
});
test("regulation goals used for extra-time and penalties", () => {
  const r = normalize({
    fixture: { id: 1, date: "2026-10-01", status: { short: "PEN" } },
    league: { id: 1 },
    teams: { home: { id: 1 }, away: { id: 2 } },
    goals: { home: 4, away: 3 },
    score: { fulltime: { home: 1, away: 1 } },
  });
  assert.equal(r.hg, 1);
  assert.equal(r.ag, 1);
});
test("bad or missing goals are not silently zeros", () => {
  assert.equal(normalize({}), null);
  assert.equal(outcome("BY", 0, 1), 0);
  assert.equal(outcome("HX", 1, 1), 1);
});
test("negative EV, disabled competition and stale odds are distinguished", () => {
  const pred = {
      sample: 20,
      league: 94,
      homeGoals: 2,
      awayGoals: 1,
      probabilities: { H: 0.75 },
    },
    bin = {
      low: 0.7,
      high: 0.8,
      n: 200,
      mean: 0.75,
      rate: 0.74,
      interval: [0.68, 0.8],
    },
    validation = {
      markets: {
        H: { enabled: true, byLeague: { 94: { enabled: true } }, bins: [bin] },
      },
    };
  assert.equal(
    select(pred, validation, { H: { odd: 1.2, at: Date.now() } }),
    null,
  );
  assert.equal(select(pred, validation).expectedValue, null);
  assert.equal(
    select(pred, validation, { H: { odd: 1.8, at: Date.now() - 7 * 3600000 } })
      .odd,
    null,
  );
  assert.equal(select({ ...pred, league: 39 }, validation), null);
});
test("Wilson interval covers empirical frequency and shrinks with samples", () => {
  const a = wilson(7, 10),
    b = wilson(700, 1000);
  assert.ok(a[0] < 0.7 && a[1] > 0.7);
  assert.ok(b[1] - b[0] < a[1] - a[0]);
});
test("D1 snapshot uniqueness, time check and update/delete guards", async () => {
  const db = database(),
    q = db.prepare(
      "INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)",
    );
  await q.bind(1, "v", "final", 1, 2, "original").run();
  await q.bind(1, "v", "final", 1, 2, "changed").run();
  assert.equal(
    (await db.prepare("SELECT data FROM forecasts").first()).data,
    "original",
  );
  await assert.rejects(db.prepare("UPDATE forecasts SET data='x'").run());
  await assert.rejects(db.prepare("DELETE FROM forecasts").run());
  await q.bind(2, "v", "final", 3, 2, "late").run();
  assert.equal(
    await db.prepare("SELECT * FROM forecasts WHERE fixture_id=2").first(),
    null,
  );
});
test("provider caches requests, respects quota and falls back explicitly", async () => {
  const db = database(),
    env = { DB: db, API_FOOTBALL_KEY: "test", DAILY_BUDGET: "1" };
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      response: [{ id: 1 }],
      errors: [],
      paging: { total: 1 },
    });
  };
  try {
    assert.equal((await api(env, "leagues", 60000)).stale, false);
    await api(env, "leagues", 60000);
    assert.equal(calls, 1);
    assert.equal((await api(env, "leagues", 60000, true)).stale, false);
    assert.equal(calls, 1);
    await db.prepare("UPDATE cache SET expires=0").run();
    assert.equal((await api(env, "leagues")).stale, true);
    await assert.rejects(api(env, "fixtures"), /daily_budget/);
  } finally {
    globalThis.fetch = original;
  }
});
test("API semantic errors and unhandled pagination rejected", async () => {
  const db = database(),
    old = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ response: [], errors: { plan: "not allowed" } });
    await assert.rejects(
      api({ DB: db, API_FOOTBALL_KEY: "test" }, "x"),
      /upstream_data/,
    );
    globalThis.fetch = async () =>
      Response.json({ response: [], errors: [], paging: { total: 2 } });
    await assert.rejects(
      api({ DB: db, API_FOOTBALL_KEY: "test" }, "y"),
      /pagination_required/,
    );
  } finally {
    globalThis.fetch = old;
  }
});
test("real odds parsed only for supported markets and fresh timestamps", () => {
  const now = Date.now(),
    r = [
      {
        fixture: { id: 1 },
        update: new Date(now).toISOString(),
        bookmakers: [
          {
            name: "book",
            bets: [
              { name: "Match Winner", values: [{ value: "Home", odd: "2.1" }] },
            ],
          },
        ],
      },
    ];
  assert.equal(parseOdds(r, 1, now).H.odd, 2.1);
  assert.deepEqual(parseOdds(r, 2, now), {});
  assert.deepEqual(parseOdds(r, 1, now + 7 * 3600000), {});
});
