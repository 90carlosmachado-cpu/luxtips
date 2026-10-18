import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fit, predict, VERSION } from "../src/forecast.js";
import { grid } from "../src/model.js";
import { mixtureProjection } from "../src/luxg.js";
import { compareForecasts } from "../src/comparison.js";
import { recalculate } from "../scripts/recalculate-cache.js";
const golden = JSON.parse(
  fs.readFileSync(new URL("./winner-golden.json", import.meta.url)),
);
test("active mixture matches Python research; convex market probabilities remain coherent", () => {
  const states = golden.base.map(([h, a], i) => ({
    weight: golden.weights[i],
    state: { teams: {}, bh: h, ba: a, n: 0, cutoff: 0, opts: {} },
  }));
  const p = predict(states, { id: 1, home: 1, away: 2, ts: 1, league: 39 });
  for (const [i, k] of ["H", "D", "A"].entries())
    assert.ok(Math.abs(p.probabilities[k] - golden.probabilities[i]) < 1e-12);
  assert.ok(
    Math.abs(p.probabilities.H + p.probabilities.D + p.probabilities.A - 1) <
      1e-12,
  );
  assert.ok(Math.abs(p.probabilities.O25 + p.probabilities.U25 - 1) < 1e-12);
  assert.ok(Math.abs(p.probabilities.BY + p.probabilities.BN - 1) < 1e-12);
  assert.ok(
    Math.abs(p.probabilities.HX - p.probabilities.H - p.probabilities.D) <
      1e-12,
  );
});
test("mixture score probabilities mix distributions, not averaged goal intensities", () => {
  const c = [
    { weight: 0.25, homeGoals: 1, awayGoals: 3 },
    { weight: 0.75, homeGoals: 3, awayGoals: 1 },
  ];
  const p = mixtureProjection(c);
  for (const s of p.topScores) {
    const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));
    const expected = c.reduce(
      (sum, x) =>
        sum +
        (x.weight *
          Math.exp(-x.homeGoals - x.awayGoals) *
          x.homeGoals ** s.home *
          x.awayGoals ** s.away) /
          factorial(s.home) /
          factorial(s.away),
      0,
    );
    assert.ok(Math.abs(s.probability - expected) < 1e-12);
  }
  assert.throws(
    () => mixtureProjection([{ weight: 2, homeGoals: 1, awayGoals: 1 }]),
    RangeError,
  );
});
test("active mixture excludes future results and preserves inputs", () => {
  const now = Date.UTC(2026, 9, 18),
    fixture = {
      id: 1,
      home: 1,
      away: 2,
      homeName: "Home",
      awayName: "Away",
      league: 39,
      ts: now + 86400000,
      status: "NS",
    };
  const history = Array.from({ length: 30 }, (_, i) => ({
    ...fixture,
    id: i + 2,
    ts: now - (i + 1) * 86400000,
    hg: i % 3,
    ag: i % 2,
    finished: true,
  }));
  const copy = JSON.stringify(history),
    p = predict(fit(history, now), fixture);
  const future = { ...fixture, hg: 20, ag: 0, finished: true };
  assert.deepEqual(p, predict(fit([...history, future], now), fixture));
  assert.equal(JSON.stringify(history), copy);
  assert.equal(p.version, VERSION);
  assert.deepEqual(
    p.baselineProbabilities,
    grid(p.components[0].homeGoals, p.components[0].awayGoals),
  );
});
test("rollout keeps source timestamps and appends a new preliminary calculation only", () => {
  const now = Date.UTC(2026, 9, 18),
    g = {
      fixture: {
        id: 1,
        home: 1,
        away: 2,
        league: 39,
        ts: now + 100000,
        status: "NS",
      },
      prediction: { version: "old" },
      sourceUpdatedAt: now - 3600000,
      updatedAt: now - 2000,
      phase: "final",
      stale: false,
    };
  const copy = JSON.stringify(g),
    out = recalculate([], [g], now);
  assert.equal(out[0].sourceUpdatedAt, g.sourceUpdatedAt);
  assert.equal(out[0].phase, "preliminary");
  assert.equal(out[0].updatedAt, now);
  assert.equal(JSON.stringify(g), copy);
  assert.equal(recalculate([], [out[0]], now).length, 0);
  assert.equal(
    recalculate([], [{ ...g, fixture: { ...g.fixture, ts: now } }], now).length,
    0,
  );
});
test("prospective comparison scores frozen paired probabilities; ignores legacy rows", () => {
  const p = { H: 0.7, D: 0.2, A: 0.1 },
    base = { H: 0.5, D: 0.3, A: 0.2 };
  const c = compareForecasts([
    {
      prediction: { probabilities: p, baselineProbabilities: base },
      result: { home: 2, away: 0 },
    },
    { prediction: { probabilities: p }, result: { home: 2, away: 0 } },
  ]);
  assert.equal(c.n, 1);
  assert.ok(Math.abs(c.currentLogLoss + Math.log(0.7)) < 1e-12);
  assert.ok(c.currentBrier < c.baselineBrier);
  assert.equal(compareForecasts([]).currentLogLoss, null);
});
