import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitNationalStrength, predictNationalStrength, nationalVenuePolicy,
  NATIONAL_STRENGTH_DEFAULTS,
} from '../bigodds-strength.mjs';

const DAY = 86400000, NOW = Date.parse('2026-11-16T08:00:00Z');
const game = (id, overrides = {}) => ({id, league: 5, home: 1, away: 2,
  hg: 2, ag: 1, status: 'FT', kickoff: NOW - (20 + id) * DAY,
  settled_at: NOW - (20 + id) * DAY + 7200000, ...overrides});
const target = {id: 99999, league: 5, home: 1, away: 2, kickoff: NOW + DAY};
const history = (n = 12) => Array.from({length: n}, (_, i) => game(i + 1));

test('Nations League final tournament keeps its existing neutral venue policy',()=>{
 const f={league:5,season:2026,nationsRound:'Final',kickoff:Date.parse('2027-06-13T19:00Z')};
 assert.deepEqual(nationalVenuePolicy(f),{neutral:true,basis:'nations_final_tournament_assumed_neutral'});
 assert.equal(nationalVenuePolicy({...f,neutralVerified:true,neutral:false}).neutral,false);
 assert.equal(nationalVenuePolicy({league:5,season:2026,nationsRound:'League A - 6',kickoff:NOW}).neutral,false);
});

test('official campaigns and both home/away roles contribute to one team strength', () => {
  const rows = Array.from({length: 8}, (_, i) => game(i + 1, {
    league: i < 4 ? 32 : 5, home: i % 2 ? 2 : 1, away: i % 2 ? 1 : 2,
  }));
  rows.push(game(91, {league: 10, hg: 40, ag: 0})); // Friendly is not official evidence.
  const state = fitNationalStrength(rows, NOW), prediction = predictNationalStrength(state, target);
  assert.equal(state.n, 8);
  assert.equal(prediction.homeSample, 8);
  assert.equal(prediction.awaySample, 8);
  assert.deepEqual(prediction.historyLeagues, [5, 32]);
  assert.equal(prediction.quality.eligible, true);
  assert.equal(state.audit.rejections.non_official_competition, 1);
});

test('the same goals against a strong defence carry more information than against weak opponents', () => {
  let id = 0;
  const rows = [], add = (home, away, hg, ag) => rows.push(game(++id, {
    home, away, hg, ag, kickoff: NOW - 10 * DAY, settled_at: NOW - 10 * DAY + 7200000,
  }));
  for (let i = 0; i < 12; i++) {
    add(1, 3, 2, 0); // Team 1 scores twice against the weak defence.
    add(2, 4, 2, 0); // Team 2 scores twice against the strong defence.
    add(3, 5 + i % 4, 0, 3);
    add(4, 5 + i % 4, 2, 0); // Shared opponents connect the two schedules.
  }
  const state = fitNationalStrength(rows, NOW);
  const fixture = {league: 5, away: 5, neutralVerified: true, neutral: true};
  const weakSchedule = predictNationalStrength(state, {...fixture, home: 1});
  const strongSchedule = predictNationalStrength(state, {...fixture, home: 2});
  assert.ok(state.teams[3].defense > state.teams[4].defense);
  assert.ok(strongSchedule.homeGoals > weakSchedule.homeGoals + .5);
  assert.equal(weakSchedule.homeSample, strongSchedule.homeSample);
});

test('unavailable, unfinished and future results cannot change a pre-match forecast', () => {
  const rows = history(), baseline = fitNationalStrength(rows, NOW);
  const augmented = fitNationalStrength([...rows,
    game(100, {hg: 12, settled_at: NOW + 1}),
    game(101, {hg: 15, settled_at: undefined}),
    game(102, {hg: 18, kickoff: NOW - 3600000, settled_at: NOW - 1}),
    game(103, {hg: 10, kickoff: NOW + DAY, settled_at: NOW + DAY + 7200000}),
    game(104, {hg: 11, finished: false}),
  ], NOW);
  assert.deepEqual(augmented.teams, baseline.teams);
  assert.deepEqual(predictNationalStrength(augmented, target), predictNationalStrength(baseline, target));
  assert.equal(augmented.audit.rejections.unavailable_at_cutoff, 4);
});

test('extra-time, penalties and missing goals are excluded rather than treated as 90-minute scores', () => {
  const state = fitNationalStrength([...history(),
    game(100, {status: 'AET', hg: 5}), game(101, {status: 'PEN', hg: 6}),
    game(102, {hg: null}), game(103, {ag: undefined}), game(104, {hg: '3'}),
  ], NOW);
  assert.equal(state.n, 12);
  assert.equal(state.audit.rejections.invalid_or_non_regular_time_result, 5);
});

test('identical observations are deduplicated and conflicting results remove that fixture', () => {
  const rows = history();
  const duplicate = fitNationalStrength([...rows, {...rows[0]}], NOW);
  assert.equal(duplicate.n, rows.length);
  assert.deepEqual(duplicate.teams, fitNationalStrength(rows, NOW).teams);
  const conflict = fitNationalStrength([...rows, {...rows[0], hg: 3}], NOW);
  assert.equal(conflict.n, rows.length - 1);
  assert.deepEqual(conflict.audit.conflictingFixtures, [rows[0].id]);
  assert.deepEqual(conflict.teams, fitNationalStrength(rows.slice(1), NOW).teams);
});

test('verified neutral ground is symmetric when teams exchange fixture roles', () => {
  const state = fitNationalStrength(history(), NOW);
  const neutral = {...target, neutralVerified: true, neutral: true};
  const forward = predictNationalStrength(state, neutral);
  const reverse = predictNationalStrength(state, {...neutral, home: 2, away: 1});
  assert.equal(forward.homeGoals, reverse.awayGoals);
  assert.equal(forward.awayGoals, reverse.homeGoals);
  assert.equal(forward.venue.basis, 'verified_venue');
});

test('legacy missing-venue flags are ignored and final-tournament neutrality is labelled as an assumption', () => {
  assert.deepEqual(nationalVenuePolicy({league: 5, neutral: true}), {
    neutral: false, basis: 'home_advantage_assumed',
  });
  for (const league of [1, 4]) {
    assert.deepEqual(nationalVenuePolicy({league}), {
      neutral: true, basis: 'final_tournament_assumed_neutral',
    });
    assert.deepEqual(nationalVenuePolicy({league, neutral: false, neutralVerified: true}), {
      neutral: false, basis: 'verified_venue',
    });
  }
  const a = fitNationalStrength(history(), NOW);
  const b = fitNationalStrength(history().map(row => ({...row, neutral: true})), NOW);
  assert.deepEqual(a.teams, b.teams);
});

test('no history does not manufacture a confident prior-only prediction', () => {
  const state = fitNationalStrength([], NOW), prediction = predictNationalStrength(state, target);
  assert.equal(prediction.homeGoals, null);
  assert.equal(prediction.awayGoals, null);
  assert.equal(prediction.quality.eligible, false);
  assert.deepEqual(prediction.quality.reasons, ['home_history_missing', 'away_history_missing']);
  const one = predictNationalStrength(fitNationalStrength(history(), NOW), {...target, away: 9999});
  assert.equal(one.homeGoals, null);
  assert.equal(one.awayGoals, null);
});

test('raw sample, weighted sample and recency are independent declared quality checks', () => {
  const few = predictNationalStrength(fitNationalStrength(history(3), NOW), target);
  assert.equal(few.homeSample, 3);
  assert.ok(Number.isFinite(few.homeGoals));
  assert.equal(few.quality.eligible, false);
  assert.ok(few.quality.reasons.includes('home_sample_below_minimum'));
  const stale = history(9).map(row => ({...row, kickoff: NOW - 800 * DAY,
    settled_at: NOW - 800 * DAY + 7200000}));
  const old = predictNationalStrength(fitNationalStrength(stale, NOW), target);
  assert.equal(old.homeSample, 9);
  assert.ok(old.homeWeighted < NATIONAL_STRENGTH_DEFAULTS.minEffectiveGames);
  assert.ok(old.quality.reasons.includes('home_weighted_sample_below_minimum'));
  assert.ok(old.quality.reasons.includes('home_history_stale'));
  assert.ok(!old.quality.reasons.includes('home_sample_below_minimum'));
  assert.equal(old.quality.calibrated, false);
});

test('target already present in fitted results or impossible identity never returns a forecast', () => {
  const state = fitNationalStrength(history(), NOW);
  for (const fixture of [{...target, id: 1}, {...target, away: 1}, {...target, league: 10},
    {...target, kickoff: NOW - 1}]) {
    const prediction = predictNationalStrength(state, fixture);
    assert.equal(prediction.quality.eligible, false);
    assert.equal(prediction.homeGoals, null);
    assert.equal(prediction.awayGoals, null);
  }
});

test('fit is deterministic, serializable, does not mutate input and never uses odds', () => {
  const rows = history(), original = structuredClone(rows);
  const first = fitNationalStrength(rows, NOW);
  const reversed = fitNationalStrength([...rows].reverse(), NOW);
  assert.deepEqual(first, reversed);
  assert.deepEqual(rows, original);
  assert.deepEqual(predictNationalStrength(JSON.parse(JSON.stringify(first)), target),
    predictNationalStrength(first, target));
  const priced = fitNationalStrength(rows.map(row => ({...row, odd: 100, probability: .99})), NOW);
  assert.deepEqual(priced, first);
});

test('invalid model options and invalid clocks fail explicitly', () => {
  for (const options of [{prior: 0}, {halfLifeDays: NaN}, {iterations: 0},
    {minEffectiveGames: -1}, {unrecognizedOption: 1}]) {
    assert.throws(() => fitNationalStrength([], NOW, options), TypeError);
  }
  assert.throws(() => fitNationalStrength([], Infinity), TypeError);
  assert.throws(() => fitNationalStrength(null, NOW), TypeError);
});
