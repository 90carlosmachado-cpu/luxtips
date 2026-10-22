import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowPrediction, SHADOW_OPTIONS } from '../src/openfoot/shadow.mjs';
import { fit2, predict2 } from '../src/legacy-worker.mjs';
const DAY = 86_400_000, now = Date.parse('2026-10-22T12:00:00Z');
function scenario() {
  const history = Array.from({ length: 30 }, (_,i) => ({ id: i + 1, league: 39, ts: now - (i + 1) * 5 * DAY,
    home: i % 2 ? 2 : 1, away: i % 2 ? 1 : 2, homeName: i % 2 ? 'B' : 'A', awayName: i % 2 ? 'A' : 'B',
    hg: 1, ag: 1, finished: true, status: 'FT' }));
  const observations = history.map(f => ({ fixtureId: f.id, league: 39, kickoff: f.ts, observedAt: f.ts + DAY,
    result: { home: f.hg, away: f.ag },
    homeXg: f.home === 1 ? 3 : 0.3, awayXg: f.away === 1 ? 3 : 0.3 }));
  const fixture = { id: 100, league: 39, ts: now + DAY, home: 1, away: 2, homeName: 'A', awayName: 'B', finished: false, status: 'NS' };
  return { history, observations, fixture };
}

test('changes experimental probabilities without mutating history or publishing', () => {
  const { history, observations, fixture } = scenario(), before = structuredClone(history);
  const p = shadowPrediction(history, observations, fixture, now);
  assert.equal(p.status, 'ready');
  assert.equal(p.publicationEligible, false);
  assert.ok(p.probabilities.H > p.controlledBaseline.probabilities.H);
  assert.ok(Math.abs(p.probabilities.H + p.probabilities.D + p.probabilities.A - 1) < 1e-8);
  assert.deepEqual(history, before);
});

test('weight zero reproduces the deployed model under identical inputs', () => {
  const { history, observations, fixture } = scenario();
  const p = shadowPrediction(history, observations, fixture, now, { ...SHADOW_OPTIONS, xgWeight: 0 });
  assert.deepEqual(p.probabilities, predict2(fit2(history, now), fixture).probabilities);
  assert.deepEqual(p.probabilities, p.controlledBaseline.probabilities);
});

test('future/unobserved/wrong-fixture xG is excluded and sparse data abstains', () => {
  const { history, observations, fixture } = scenario();
  for (const bad of [observations.map(o => ({ ...o, observedAt: now + DAY })), observations.map(o => ({ ...o, kickoff: o.kickoff + 1 })), observations.slice(0, 3)]) {
    assert.equal(shadowPrediction(history, bad, fixture, now).status, 'insufficient_xg');
  }
  assert.equal(shadowPrediction(history, observations, { ...fixture, league: 94 }, now).status, 'unsupported_competition');
  assert.equal(shadowPrediction(history, observations, fixture, fixture.ts).status, 'not_prematch');
});

test('duplicate history and xG are rejected instead of biasing training', () => {
  const { history, observations, fixture } = scenario();
  assert.throws(() => shadowPrediction([...history,history[0]], observations, fixture, now), /duplicate_history_fixture/);
  assert.throws(() => shadowPrediction(history, [...observations,observations[0]], fixture, now), /duplicate_xg_fixture/);
});
