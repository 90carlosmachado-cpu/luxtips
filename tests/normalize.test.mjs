import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeXg, matchFixture } from '../src/openfoot/normalize.mjs';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/api-football-matched.json', import.meta.url)));
const samples = [39,140,78,135,61].map(l => JSON.parse(readFileSync(new URL(`./fixtures/openfoot-${l}.json`, import.meta.url))));
const now = Date.parse('2026-10-22T14:00:00Z');

test('all five real paid samples reconcile with shots and API-Football fixtures', () => {
  for (const p of samples) {
    const o = normalizeXg(p.match, p.xg, now);
    assert.equal(o.sourceId, p.match.id);
    assert.ok(o.homeShots + o.awayShots > 0);
    const mapped = matchFixture(p.match, fixtures);
    assert.equal(mapped.status, 'matched', p.match.id);
    assert.equal(mapped.fixture.hg, p.match.score.home);
    assert.equal(mapped.fixture.ag, p.match.score.away);
  }
});

test('full real 2025/26 archive maps 1750 fixtures and preserves two unresolved identities', () => {
  const p = JSON.parse(readFileSync(new URL('./fixtures/cross-provider-2025.json', import.meta.url)));
  const unresolved = [];
  let matched = 0;
  for (const m of p.external) {
    const result = matchFixture(m, p.local);
    if (result.status === 'matched') matched++;
    else unresolved.push(m.id);
  }
  assert.equal(matched, 1750);
  assert.deepEqual(unresolved.sort(), [
    'match_fmb_fr1_2025-26_20260517_nantes_toulouse',
    'match_fmb_it1_2025-26_20260524_torino_juventus',
  ]);
});

test('missing/null/derived xG never becomes zero or a shot-based observation', () => {
  const p = samples[0];
  for (const data of [{ ...p.xg.data, homeXG: null }, { analytics: { expectedGoals: { homeXG: 2, awayXG: 1 } } }, { ...p.xg.data, awayXG: '1.7' }]) {
    assert.throws(() => normalizeXg(p.match, { ...p.xg, data }, now), { code: 'invalid_xg_contract' });
  }
});

test('rejects inconsistent shot totals, duplicated shots and extra time', () => {
  const p = samples[0];
  assert.throws(() => normalizeXg(p.match, { ...p.xg, data: { ...p.xg.data, homeXG: 12 } }, now), { code: 'xg_shot_total_mismatch' });
  assert.throws(() => normalizeXg(p.match, { ...p.xg, data: { ...p.xg.data, shots: [...p.xg.data.shots, p.xg.data.shots[0]] } }, now), { code: 'invalid_shot_data' });
  assert.throws(() => normalizeXg({ ...p.match, period: 'ET' }, p.xg, now), { code: 'unfinished_or_invalid_match' });
});

test('does not match by timestamp, result, fuzzy team names or another competition', () => {
  const p = samples[1], f = matchFixture(p.match, fixtures).fixture;
  assert.equal(matchFixture({ ...p.match, competitionId: 'other' }, fixtures).status, 'unmatched');
  assert.equal(matchFixture({ ...p.match, homeTeam: { ...p.match.homeTeam, id: 'team_girona_b_unknown', name: 'Girona B' } }, fixtures).status, 'unmatched');
  assert.equal(matchFixture(p.match, [{ ...f, hg: 9 }]).status, 'result_mismatch');
  assert.equal(matchFixture(p.match, [f, { ...f, id: 999 }]).status, 'ambiguous');
  assert.equal(matchFixture(p.match, [{ ...f, home: f.away, away: f.home, homeName: f.awayName, awayName: f.homeName }]).status, 'unmatched');
  assert.equal(matchFixture(p.match, [{ ...f, season: 2024 }]).status, 'unmatched');
});
