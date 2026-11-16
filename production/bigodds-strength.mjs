import {nationsFinalsVenue} from './nations-league.mjs';
/**
 * National-team goals model for Bigodes. Pure functions; no odds, I/O or fitting
 * to the current ticket. Attack and defence are shared across official campaigns
 * and fitted against the actual opponents instead of isolated home/away averages.
 *
 * The defaults are a conservative specification, not calibrated confidence
 * limits: prior=8 regularizes relative strengths towards 1; a 365-day half-life
 * retains information between international windows. Report validation separately.
 */
export const NATIONAL_STRENGTH_VERSION = 'national-opponent-goals-v1';
export const NATIONAL_STRENGTH_LEAGUES = Object.freeze([1, 4, 5, 32, 960]);
export const NATIONAL_STRENGTH_DEFAULTS = Object.freeze({
  prior: 8,
  halfLifeDays: 365,
  maxAgeDays: 3 * 365,
  iterations: 40,
  minTeamGames: 8,
  minEffectiveGames: 4,
  maxTeamAgeDays: 180,
});
const DAY = 86400000;
const RESULT_DELAY = 2 * 3600000;
const official = new Set(NATIONAL_STRENGTH_LEAGUES);
const finite = Number.isFinite;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const bounded = (value, min, max) => Math.max(min, Math.min(max, value));

function optionsFor(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Invalid national strength options');
  }
  for (const name of Object.keys(overrides)) {
    if (!Object.hasOwn(NATIONAL_STRENGTH_DEFAULTS, name)) {
      throw new TypeError(`Unknown national strength option: ${name}`);
    }
  }
  const options = {...NATIONAL_STRENGTH_DEFAULTS, ...overrides};
  for (const key of ['prior', 'halfLifeDays', 'maxAgeDays', 'maxTeamAgeDays']) {
    if (!finite(options[key]) || options[key] <= 0) throw new TypeError(`Invalid ${key}`);
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 200 ||
      !Number.isInteger(options.minTeamGames) || options.minTeamGames < 0 ||
      !finite(options.minEffectiveGames) || options.minEffectiveGames < 0) {
    throw new TypeError('Invalid national strength sample/iteration policy');
  }
  return options;
}

/**
 * Legacy `neutral` was derived from a missing venue ID and is not evidence of a
 * neutral ground. Only a verified flag overrides this policy. World/European
 * Championship final tournaments use an explicit neutral-ground assumption;
 * this is not a claim that the actual venue or host advantage was verified.
 */
export function nationalVenuePolicy(fixture) {
  if (fixture?.neutralVerified === true &&
      [true, false, 0, 1].includes(fixture.neutral)) {
    return {neutral: Boolean(fixture.neutral), basis: 'verified_venue'};
  }
  if (fixture?.league === 1 || fixture?.league === 4) {
    return {neutral: true, basis: 'final_tournament_assumed_neutral'};
  }
  if (nationsFinalsVenue({...fixture,ts:fixture?.ts??fixture?.kickoff})) {
    return {neutral: true, basis: 'nations_final_tournament_assumed_neutral'};
  }
  return {neutral: false, basis: 'home_advantage_assumed'};
}

function normalizeHistory(history, cutoff, options) {
  const byId = new Map(), conflicts = new Set(), rejections = {};
  const reject = reason => { rejections[reason] = (rejections[reason] || 0) + 1; };
  for (const input of history) {
    if (!input || !positiveId(input.id)) { reject('invalid_fixture_identity'); continue; }
    if (!official.has(input.league)) { reject('non_official_competition'); continue; }
    const kickoff = input.kickoff ?? input.ts;
    const settledAt = input.settled_at;
    // Do not infer an observation timestamp from the score or current clock.
    if (!finite(kickoff) || !finite(settledAt) || settledAt <= kickoff ||
        settledAt > cutoff || kickoff + RESULT_DELAY > cutoff) {
      reject('unavailable_at_cutoff'); continue;
    }
    if (kickoff < cutoff - options.maxAgeDays * DAY) { reject('outside_history_window'); continue; }
    if (!positiveId(input.home) || !positiveId(input.away) || input.home === input.away) {
      reject('invalid_team_identity'); continue;
    }
    // AET/PEN final scores do not identify the 90-minute goals. Missing values
    // are excluded; null must never silently become a nil-nil result.
    if (input.status !== 'FT' || input.finished === false ||
        ![input.hg, input.ag].every(goal => Number.isSafeInteger(goal) && goal >= 0 && goal <= 99)) {
      reject('invalid_or_non_regular_time_result'); continue;
    }
    const venue = nationalVenuePolicy(input);
    const row = {id: input.id, league: input.league, kickoff, settledAt,
      home: input.home, away: input.away, hg: input.hg, ag: input.ag, venue};
    const identity = JSON.stringify([row.league, kickoff, row.home, row.away, row.hg, row.ag, venue.neutral]);
    const old = byId.get(row.id);
    if (old && old.identity !== identity) {
      conflicts.add(row.id);
      reject('conflicting_duplicate');
      continue;
    }
    if (old) { reject('identical_duplicate'); continue; }
    byId.set(row.id, {identity, row});
  }
  const rows = [...byId.values()].map(value => value.row)
    .filter(row => !conflicts.has(row.id)).sort((a, b) => a.kickoff - b.kickoff || a.id - b.id);
  return {rows, rejections, conflictingFixtures: [...conflicts].sort((a, b) => a - b)};
}

function accumulator() {
  return {homeGoals: 0, awayGoals: 0, weight: 0,
    venueHomeGoals: 0, venueAwayGoals: 0, venueWeight: 0,
    neutralGoals: 0, neutralWeight: 0};
}
function addGoals(acc, row, weight) {
  acc.homeGoals += weight * row.hg;
  acc.awayGoals += weight * row.ag;
  acc.weight += weight;
  if (row.venue.neutral) {
    acc.neutralGoals += weight * (row.hg + row.ag);
    acc.neutralWeight += weight;
  } else {
    acc.venueHomeGoals += weight * row.hg;
    acc.venueAwayGoals += weight * row.ag;
    acc.venueWeight += weight;
  }
}

export function fitNationalStrength(history, cutoff, overrides = {}) {
  if (!Array.isArray(history) || !finite(cutoff) || cutoff < 0) {
    throw new TypeError('Invalid national strength history/cutoff');
  }
  const options = optionsFor(overrides);
  const normalized = normalizeHistory(history, cutoff, options);
  const teams = {}, competitions = {}, aggregate = accumulator(), venueCounts = {};
  const rows = normalized.rows.map(row => ({...row,
    weight: Math.exp(-Math.LN2 * (cutoff - row.kickoff) / (options.halfLifeDays * DAY))}));
  for (const row of rows) {
    const weight = row.weight;
    addGoals(aggregate, row, weight);
    const league = competitions[row.league] ||= {...accumulator(), count: 0};
    addGoals(league, row, weight);
    league.count++;
    venueCounts[row.venue.basis] = (venueCounts[row.venue.basis] || 0) + 1;
    for (const [id, opponent] of [[row.home, row.away], [row.away, row.home]]) {
      const team = teams[id] ||= {attack: 1, defense: 1, n: 0, weight: 0,
        lastAt: null, opponents: new Set(), leagues: new Set()};
      team.n++;
      team.weight += weight;
      team.lastAt = Math.max(team.lastAt ?? row.kickoff, row.kickoff);
      team.opponents.add(opponent);
      team.leagues.add(row.league);
    }
  }
  // Competition intercepts absorb differing goal environments; team strengths
  // remain shared, connecting Nations League tiers through official opponents.
  // These mild intercept priors do not create evidence for unseen teams.
  const base = {
    home: (aggregate.venueHomeGoals + 15) / (aggregate.venueWeight + 10),
    away: (aggregate.venueAwayGoals + 12) / (aggregate.venueWeight + 10),
    neutral: (aggregate.homeGoals + aggregate.awayGoals + 27) / (2 * aggregate.weight + 20),
  };
  for (const league of Object.values(competitions)) {
    league.base = {
      home: (league.venueHomeGoals + 20 * base.home) / (league.venueWeight + 20),
      away: (league.venueAwayGoals + 20 * base.away) / (league.venueWeight + 20),
      neutral: (league.neutralGoals + 40 * base.neutral) / (2 * league.neutralWeight + 40),
    };
  }
  let iterations = 0;
  for (; iterations < options.iterations; iterations++) {
    const sums = {};
    for (const id of Object.keys(teams)) {
      sums[id] = {goalsFor: options.prior, expectedFor: options.prior,
        goalsAgainst: options.prior, expectedAgainst: options.prior};
    }
    for (const row of rows) {
      const home = teams[row.home], away = teams[row.away];
      const hs = sums[row.home], as = sums[row.away], rates = competitions[row.league].base;
      const bh = row.venue.neutral ? rates.neutral : rates.home;
      const ba = row.venue.neutral ? rates.neutral : rates.away;
      hs.goalsFor += row.weight * row.hg;
      hs.expectedFor += row.weight * bh * away.defense;
      as.goalsFor += row.weight * row.ag;
      as.expectedFor += row.weight * ba * home.defense;
      hs.goalsAgainst += row.weight * row.ag;
      hs.expectedAgainst += row.weight * ba * away.attack;
      as.goalsAgainst += row.weight * row.hg;
      as.expectedAgainst += row.weight * bh * home.attack;
    }
    let maxChange = 0;
    for (const [id, team] of Object.entries(teams)) {
      const sum = sums[id];
      const attack = bounded((team.attack + sum.goalsFor / sum.expectedFor) / 2, .25, 3);
      const defense = bounded((team.defense + sum.goalsAgainst / sum.expectedAgainst) / 2, .25, 3);
      maxChange = Math.max(maxChange, Math.abs(attack - team.attack), Math.abs(defense - team.defense));
      team.attack = attack;
      team.defense = defense;
    }
    if (maxChange < 1e-8) { iterations++; break; }
  }
  for (const team of Object.values(teams)) {
    team.opponents = [...team.opponents].sort((a, b) => a - b);
    team.leagues = [...team.leagues].sort((a, b) => a - b);
  }
  return {version: NATIONAL_STRENGTH_VERSION, cutoff, options, teams, competitions, base,
    n: rows.length, iterations, fixtureIds: rows.map(row => row.id),
    historyLeagues: Object.keys(competitions).map(Number).sort((a, b) => a - b),
    audit: {rejections: normalized.rejections, conflictingFixtures: normalized.conflictingFixtures,
      venueCounts, oddsUsed: false, probabilitiesCalibrated: false}};
}

export function predictNationalStrength(state, fixture) {
  if (!state || state.version !== NATIONAL_STRENGTH_VERSION || !finite(state.cutoff) || !state.options) {
    throw new TypeError('Invalid national strength state');
  }
  const reasons = [], validIdentity = positiveId(fixture?.home) && positiveId(fixture?.away) &&
    fixture.home !== fixture.away;
  const home = validIdentity ? state.teams[fixture.home] : null;
  const away = validIdentity ? state.teams[fixture.away] : null;
  if (!validIdentity) reasons.push('invalid_fixture_identity');
  if (!official.has(fixture?.league)) reasons.push('non_official_competition');
  if (positiveId(fixture?.id) && state.fixtureIds.includes(fixture.id)) reasons.push('target_already_observed');
  const kickoff = fixture?.kickoff ?? fixture?.ts;
  if (kickoff !== undefined && (!finite(kickoff) || kickoff < state.cutoff)) reasons.push('invalid_fixture_clock');
  for (const [side, team] of [['home', home], ['away', away]]) {
    if (!team) { reasons.push(`${side}_history_missing`); continue; }
    if (team.n < state.options.minTeamGames) reasons.push(`${side}_sample_below_minimum`);
    if (team.weight < state.options.minEffectiveGames) reasons.push(`${side}_weighted_sample_below_minimum`);
    if (state.cutoff - team.lastAt > state.options.maxTeamAgeDays * DAY) reasons.push(`${side}_history_stale`);
  }
  const venue = nationalVenuePolicy(fixture);
  const rates = state.competitions[fixture?.league]?.base ?? state.base;
  const canPredict = home && away && validIdentity && official.has(fixture?.league) &&
    !reasons.includes('target_already_observed') && !reasons.includes('invalid_fixture_clock');
  return {
    version: NATIONAL_STRENGTH_VERSION, source: 'national-opponent-strength', cutoff: state.cutoff,
    homeGoals: canPredict ? bounded((venue.neutral ? rates.neutral : rates.home) * home.attack * away.defense, .15, 4.5) : null,
    awayGoals: canPredict ? bounded((venue.neutral ? rates.neutral : rates.away) * away.attack * home.defense, .15, 4.5) : null,
    homeSample: home?.n ?? 0, awaySample: away?.n ?? 0,
    homeWeighted: home?.weight ?? 0, awayWeighted: away?.weight ?? 0,
    homeLastAt: home?.lastAt ?? null, awayLastAt: away?.lastAt ?? null,
    homeOpponentCount: home?.opponents.length ?? 0, awayOpponentCount: away?.opponents.length ?? 0,
    historyLeagues: state.historyLeagues, venue,
    quality: {eligible: reasons.length === 0, reasons,
      criteria: {minTeamGames: state.options.minTeamGames, minEffectiveGames: state.options.minEffectiveGames,
        maxTeamAgeDays: state.options.maxTeamAgeDays}, calibrated: false},
    xgUsed: false,
  };
}
