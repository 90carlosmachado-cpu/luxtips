import test from 'node:test';
import assert from 'node:assert/strict';
import { compareShadow } from '../src/openfoot/report.mjs';
function row() {
  const p = { H: 0.6, D: 0.25, A: 0.15 }, improved = { H: 0.7, D: 0.2, A: 0.1 };
  return { createdAt: 1000, data: { fixture: { id: 1, ts: 2000, league: 39, home: 1, away: 2 }, baseline: { cutoff: 900, probabilities: p },
    candidate: { cutoff: 1000, probabilities: improved, controlledBaseline: { probabilities: p } } },
    current: { id: 1, ts: 2000, home: 1, away: 2, finished: true, status: 'FT', hg: 2, ag: 0 } };
}
test('scores paired forecasts and keeps promotion disabled even with positive results', () => {
  const r = compareShadow([row()]);
  assert.equal(r.groups.all.n, 1);
  assert.ok(r.groups.all.logLossImprovementVsControl > 0);
  assert.equal(r.promotionEligible, false);
  assert.equal(r.profitabilityEvaluated, false);
});
test('excludes predictions recorded after kickoff, rescheduled games and stale identities', () => {
  const invalid = [row(), row(), row(), row()];
  invalid[0].createdAt = 2000;
  invalid[1].current.ts++;
  invalid[2].current.home = 9;
  invalid[3].data.candidate.cutoff = 3000;
  assert.deepEqual(compareShadow(invalid).groups, {});
});
