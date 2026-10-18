import test from "node:test";
import assert from "node:assert/strict";
import { scoreProjection } from "../src/luxg.js";
import { fit, predict, grid } from "../src/model.js";
test("LuxG score mode is not a rounded mean; ordered joint probabilities", () => {
  const p = scoreProjection(2.8, 1.2);
  assert.deepEqual([p.topScores[0].home, p.topScores[0].away], [2, 1]);
  assert.ok(
    Math.abs(
      p.topScores[0].probability - ((Math.exp(-4) * 2.8 ** 2) / 2) * 1.2,
    ) < 1e-14,
  );
  assert.ok(
    p.topScores.every((x, i, a) => !i || a[i - 1].probability >= x.probability),
  );
  assert.ok(p.topThreeMass > 0 && p.topThreeMass < 1);
});
test("LuxG discrete goal ranges contain at least 80% model mass", () => {
  for (const h of [0.15, 1, 2.8, 5])
    for (const a of [0.15, 1, 3, 5]) {
      const p = scoreProjection(h, a);
      for (const r of [p.goalRanges.home, p.goalRanges.away])
        assert.ok(
          r.coverage >= 0.8 && r.coverage <= 1 + 1e-12 && r.high >= r.low,
        );
      assert.ok(p.topScores.every((s) => s.probability >= 0));
    }
});
test("LuxG validates intensities and preserves existing market probabilities", () => {
  for (const x of [0, -1, NaN, Infinity, 6])
    assert.throws(() => scoreProjection(x, 1), RangeError);
  const state = fit([], Date.UTC(2026, 0, 1));
  const p = predict(state, {
    home: 1,
    away: 2,
    league: 39,
    ts: Date.UTC(2026, 0, 2),
  });
  assert.deepEqual(p.probabilities, grid(p.homeGoals, p.awayGoals));
  assert.equal(p.luxg.eventXg, false);
});
