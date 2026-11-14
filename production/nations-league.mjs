// UEFA 2026/27 regulations, articles 14–19. A new edition needs its own group and format rules.
export const NATIONS_LEAGUE = 5;
export const NATIONS_SEASON = 2026;
// API-Football seasons identify campaigns, not the calendar year of every match.
const officialHistoryCampaigns = new Map([
  [1, [2026]],      // FIFA World Cup
  [4, [2024]],      // UEFA European Championship
  [5, [2024, 2026]], // UEFA Nations League
  [32, [2024]],     // UEFA FIFA World Cup qualification
  [960, [2023]]     // UEFA European Championship qualification
]);
export const NATIONS_HISTORY_LEAGUES = [...officialHistoryCampaigns.keys()];
export const nationsHistoryJobs = () => [...officialHistoryCampaigns].flatMap(([league, seasons]) =>
  league === NATIONS_LEAGUE ? [] : seasons.map(season => ({
    kind: 'nations_history', league, season, path: `fixtures?league=${league}&season=${season}`, ttl: 30 * 86400_000
  }))
);
export function isNationsOfficialResult(f) {
  return officialHistoryCampaigns.get(f.league)?.includes(f.season) === true && f.finished &&
    ['FT', 'AET', 'PEN'].includes(f.status) && [f.hg, f.ag].every(score => Number.isInteger(score) && score >= 0);
}
export const NATIONS_SNAPSHOT_TTL = 30 * 60_000;
const GROUPS_START = Date.parse('2026-09-24');
const GROUPS_END = Date.parse('2026-11-18');
const VALIDATION_START = Date.parse('2026-11-10');
const MARCH_START = Date.parse('2027-03-25');
const MARCH_END = Date.parse('2027-03-31');
const FINALS_START = Date.parse('2027-06-09');
const FINALS_END = Date.parse('2027-06-14');
const DAY = 86400_000;
const groups = {
  A1: ['France', 'Italy', 'Belgium', 'Turkey'],
  A2: ['Germany', 'Netherlands', 'Serbia', 'Greece'],
  A3: ['Spain', 'Croatia', 'England', 'Czech Republic'],
  A4: ['Portugal', 'Denmark', 'Norway', 'Wales'],
  B1: ['Scotland', 'Switzerland', 'Slovenia', 'North Macedonia'],
  B2: ['Hungary', 'Ukraine', 'Georgia', 'Northern Ireland'],
  B3: ['Israel', 'Austria', 'Ireland', 'Kosovo'],
  B4: ['Poland', 'Bosnia and Herzegovina', 'Romania', 'Sweden'],
  C1: ['Albania', 'Finland', 'Belarus', 'San Marino'],
  C2: ['Montenegro', 'Armenia', 'Cyprus', 'Latvia'],
  C3: ['Kazakhstan', 'Slovakia', 'Faroe Islands', 'Moldova'],
  C4: ['Iceland', 'Bulgaria', 'Estonia', 'Luxembourg'],
  D1: ['Gibraltar', 'Malta', 'Andorra'],
  D2: ['Lithuania', 'Azerbaijan', 'Liechtenstein']
};
const aliases = {
  'turkiye': 'turkey', 'czechia': 'czech republic', 'republic of ireland': 'ireland', 'rep. of ireland': 'ireland',
  'bosnia & herzegovina': 'bosnia and herzegovina', 'macedonia': 'north macedonia', 'fyr macedonia': 'north macedonia'
};
const keyOf = name => {
  const key = String(name ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  return aliases[key] ?? key;
};
const groupByTeam = new Map(Object.entries(groups).flatMap(([group, teams]) =>
  teams.map(team => [keyOf(team), group])
));

export function isNationsGroupFixture(f) {
  return f.league === NATIONS_LEAGUE && f.season === NATIONS_SEASON &&
    f.ts >= GROUPS_START && f.ts < GROUPS_END &&
    /^League [A-D] - [1-6]$/.test(f.nationsRound ?? '');
}

export function nationsKnockoutStage(f) {
  if (f.league !== NATIONS_LEAGUE || f.season !== NATIONS_SEASON) return null;
  const round = String(f.nationsRound ?? '').toLowerCase().replace(/[‐‑–—]/g, '-')
    .replace(/[ -]+/g, ' ').trim();
  if (f.ts >= MARCH_START && f.ts < MARCH_END + 3 * DAY) {
    if (/^(?:league a )?quarter ?finals?(?: |$)/.test(round)) return 'quarter_final';
    if (/^(?:promotion|relegation|promotion[ /]relegation|league [abc](?:\/[abc])?)?\s*play ?offs?(?: |$)/.test(round)) return 'playoff';
  }
  if (f.ts >= FINALS_START && f.ts < FINALS_END + 3 * DAY) {
    if (/^semi ?finals?(?: |$)/.test(round)) return 'semi_final';
    if (/^(?:third|3rd) place(?: |$)/.test(round)) return 'third_place';
    if (/^final(?: 1)?$/.test(round)) return 'final';
  }
  return null;
}

export const isNationsFixture = f => isNationsGroupFixture(f) || !!nationsKnockoutStage(f);
export const nationsFinalsVenue = f => ['semi_final', 'third_place', 'final'].includes(nationsKnockoutStage(f));

function knockoutScenarios(fixtures, now) {
  const matches = fixtures.filter(f => nationsKnockoutStage(f) && Number.isSafeInteger(f.id) &&
    Number.isSafeInteger(f.home) && Number.isSafeInteger(f.away) && f.home !== f.away);
  const contexts = new Map();
  for (const f of matches) {
    if (f.status !== 'NS' || f.finished || f.ts <= now || matches.filter(r => r.id === f.id).length !== 1) continue;
    const stage = nationsKnockoutStage(f);
    const context = {
      fixtureId: f.id, kickoff: f.ts, homeId: f.home, awayId: f.away, stage,
      H: { status: 'in_play' }, A: { status: 'in_play' }
    };
    if (stage === 'quarter_final' || stage === 'playoff') {
      const tie = matches.filter(r => nationsKnockoutStage(r) === stage &&
        (r.home === f.home && r.away === f.away || r.home === f.away && r.away === f.home));
      if (tie.length !== 2) continue;
      const other = tie.find(r => r.id !== f.id);
      if (!other || other.home !== f.away || other.away !== f.home || Math.abs(other.ts - f.ts) < DAY) continue;
      if (other.ts > f.ts) {
        if (other.status !== 'NS' || other.finished) continue;
        context.leg = 1;
      } else {
        if (other.ts >= now || other.status !== 'FT' || !other.finished ||
            ![other.hg, other.ag].every(g => Number.isInteger(g) && g >= 0)) continue;
        context.leg = 2;
        context.firstLeg = { fixtureId: other.id, homeGoals: other.ag, awayGoals: other.hg };
        const margin = other.ag - other.hg;
        if (margin !== 0) {
          context[margin > 0 ? 'H' : 'A'] = { status: 'draw_enough' };
          context[margin > 0 ? 'A' : 'H'] = { status: 'needs_win', equalizingMargin: Math.abs(margin) };
        }
      }
    }
    contexts.set(f.id, context);
  }
  return contexts;
}

function bucket(teams, value) {
  const byValue = new Map();
  for (const team of teams) {
    const score = value(team);
    if (!byValue.has(score)) byValue.set(score, []);
    byValue.get(score).push(team);
  }
  return [...byValue.entries()].sort(([a], [b]) => b - a).map(([, tied]) => tied);
}

function teamStats(team, matches) {
  const stats = { points: 0, difference: 0, goals: 0, awayGoals: 0, wins: 0, awayWins: 0, unknownScore: false };
  for (const m of matches) {
    const home = m.home === team;
    if (!home && m.away !== team) continue;
    const result = home ? m.outcome : -m.outcome;
    stats.points += result > 0 ? 3 : result === 0 ? 1 : 0;
    stats.wins += Number(result > 0);
    stats.awayWins += Number(!home && result > 0);
    if (m.hg === null) {
      stats.unknownScore = true;
      continue;
    }
    const goals = home ? m.hg : m.ag;
    stats.goals += goals;
    stats.difference += goals - (home ? m.ag : m.hg);
    if (!home) stats.awayGoals += goals;
  }
  return stats;
}

const overallCriteria = ['points', 'difference', 'goals', 'awayGoals', 'wins', 'awayWins'];

function splitByStats(teams, stats, criteria) {
  let parts = [teams];
  for (const criterion of criteria) {
    parts = parts.flatMap(part => part.length === 1 ? [part] : bucket(part, team => stats.get(team)[criterion]));
  }
  return parts;
}

function splitHeadToHead(teams, matches, overall) {
  if (teams.length === 1) return [teams];
  const direct = matches.filter(m => teams.includes(m.home) && teams.includes(m.away));
  const stats = new Map(teams.map(team => [team, teamStats(team, direct)]));
  const points = bucket(teams, team => stats.get(team).points);
  const parts = points.flatMap(part => {
    if (part.length === 1) return [part];
    // The score lines of future matches are unbounded. A tied mini-table
    // involving one of them must allow every order left undecided.
    if (part.some(team => stats.get(team).unknownScore)) return [part];
    return splitByStats(part, stats, ['difference', 'goals']);
  });
  if (parts.length > 1) return parts.flatMap(part => {
    // If an earlier score-based criterion is unresolved for this subset,
    // reapplying head-to-head would assume an order the data cannot prove.
    if (part.some(team => stats.get(team).unknownScore)) return [part];
    return splitHeadToHead(part, matches, overall);
  });
  if (teams.some(team => stats.get(team).unknownScore || overall.get(team).unknownScore)) return parts;
  // Discipline and the access list can still resolve a tie. Leave it open.
  return splitByStats(teams, overall, overallCriteria.slice(1));
}

function scenarios(teams, matches) {
  const results = [];
  function visit(index, games, outcomes) {
    if (index === matches.length) {
      const stats = new Map(teams.map(team => [team, teamStats(team, games)]));
      const ranks = bucket(teams, team => stats.get(team).points)
        .flatMap(tied => splitHeadToHead(tied, games, stats));
      results.push({ ranks, outcomes, stats });
      return;
    }
    const m = matches[index];
    if (m.finished) {
      visit(index + 1, [...games, { ...m, outcome: Math.sign(m.hg - m.ag) }], outcomes);
      return;
    }
    for (const outcome of [-1, 0, 1]) {
      visit(index + 1, [...games, { ...m, hg: null, ag: null, outcome }], { ...outcomes, [m.id]: outcome });
    }
  }
  visit(0, [], {});
  return results;
}

function teamAt(scenario, position) {
  let next = 1;
  for (const tied of scenario.ranks) {
    next += tied.length;
    if (position < next) return tied;
  }
  return [];
}

function compareOverall(a, b) {
  if (a.points !== b.points) return Math.sign(a.points - b.points);
  if (a.unknownScore || b.unknownScore) return 0;
  for (const criterion of overallCriteria.slice(1)) {
    if (a[criterion] !== b[criterion]) return Math.sign(a[criterion] - b[criterion]);
  }
  return 0;
}

const objectives = {
  A: ['seeded_quarter_final', 'quarter_final', 'stay_a', 'playoff_a_b', 'relegation_b'],
  B: ['promotion_a', 'playoff_a_b', 'stay_b', 'playoff_b_c'],
  C: ['promotion_b', 'playoff_b_c', 'stay_c'],
  D: ['best_d_winner', 'd_winner', 'promotion_c']
};

function possibleObjectives(league, rank, stats, peers) {
  if ((league === 'A' && rank >= 3) || (league === 'D' && rank === 1)) {
    let ahead = 0, possiblyAhead = 0;
    for (const rivals of peers) {
      const orders = rivals.map(rival => compareOverall(rival, stats));
      ahead += Number(orders.every(order => order > 0));
      possiblyAhead += Number(orders.some(order => order >= 0));
    }
    const limit = league === 'A' ? 2 : 1;
    const available = [];
    if (ahead < limit) available.push(league === 'A' ? rank - 1 : 0);
    if (possiblyAhead >= limit) available.push(league === 'A' ? rank : 1);
    return available;
  }
  return [league === 'D' ? 2 : Math.min(rank - 1, objectives[league].length - 1)];
}

function describeTeam(group, match, team, groupScenarios, peersByRank) {
  const byResult = { win: new Set(), draw: new Set(), loss: new Set() };
  for (const scenario of groupScenarios) {
    const direction = scenario.outcomes[match.id] * (team === match.home ? 1 : -1);
    const result = direction > 0 ? 'win' : direction === 0 ? 'draw' : 'loss';
    for (let rank = 1; rank <= groups[group].length; rank++) {
      if (!teamAt(scenario, rank).includes(team)) continue;
      for (const objective of possibleObjectives(group[0], rank, scenario.stats.get(team), peersByRank[rank] ?? [])) {
        byResult[result].add(objective);
      }
    }
  }
  const win = [...byResult.win], draw = [...byResult.draw], loss = [...byResult.loss];
  const best = Math.min(...win, ...draw, ...loss);
  const worst = Math.max(...win, ...draw, ...loss);
  const winImproves = Math.min(...win) < Math.min(...loss) || Math.max(...win) < Math.max(...loss);
  let status = 'uncertain';
  if (best === worst) status = 'decided';
  else if (winImproves && Math.min(...draw, ...loss) > best) status = 'needs_win';
  else if (winImproves && Math.max(...draw) === best) status = 'draw_enough';
  else if (winImproves) status = 'in_play';
  const labels = objectives[group[0]];
  return {
    status,
    objective: labels[best],
    dependsOnOtherResultsOrTiebreak: status !== 'decided' && Math.max(...win) > best,
    outcomes: Object.fromEntries(Object.entries(byResult).map(([k, set]) =>
      [k, [...set].sort((a, b) => a - b).map(i => labels[i])]
    ))
  };
}

export function nationsScenarios(fixtures, now) {
  const byGroup = new Map(), idsByTeam = new Map(), teamsById = new Map(), seenFixtures = new Map();
  const invalid = new Set();
  for (const f of fixtures.filter(isNationsGroupFixture)) {
    const names = [keyOf(f.homeName), keyOf(f.awayName)];
    const group = groupByTeam.get(names[0]);
    if (!group || group !== groupByTeam.get(names[1]) || f.nationsRound[7] !== group[0]) {
      for (const name of names) invalid.add(groupByTeam.get(name));
      continue;
    }
    const matches = byGroup.get(group) ?? [];
    byGroup.set(group, matches);
    matches.push(f);
    if (!Number.isSafeInteger(f.id) || f.home === f.away ||
        ![f.home, f.away].every(Number.isSafeInteger) || names[0] === names[1]) invalid.add(group);
    if (seenFixtures.has(f.id)) {
      invalid.add(group);
      invalid.add(seenFixtures.get(f.id));
    }
    seenFixtures.set(f.id, group);
    for (const [i, id] of [f.home, f.away].entries()) {
      if (idsByTeam.has(names[i]) && idsByTeam.get(names[i]) !== id) invalid.add(group);
      if (teamsById.has(id) && teamsById.get(id) !== names[i]) {
        invalid.add(group);
        invalid.add(groupByTeam.get(teamsById.get(id)));
      }
      idsByTeam.set(names[i], id);
      teamsById.set(id, names[i]);
    }
  }
  const all = new Map();
  for (const [group, matches] of byGroup) {
    const n = groups[group].length;
    if (invalid.has(group) || matches.length !== n * (n - 1) ||
        new Set(matches.map(f => f.home + ':' + f.away)).size !== matches.length ||
        matches.some(f => f.finished
          ? f.status !== 'FT' || f.ts >= now || ![f.hg, f.ag].every(g => Number.isInteger(g) && g >= 0)
          : f.status !== 'NS' || f.ts <= now)) continue;
    const pending = matches.filter(f => !f.finished);
    if (pending.length > 4) continue;
    const teams = groups[group].map(name => idsByTeam.get(keyOf(name)));
    all.set(group, { pending, results: scenarios(teams, matches) });
  }
  const result = new Map();
  for (const [group, { pending, results }] of all) {
    const peers = Object.keys(groups).filter(g => g !== group && g[0] === group[0]);
    const comparison = group[0] === 'A' ? [3, 4] : group[0] === 'D' ? [1] : [];
    if (comparison.length && peers.some(g => !all.has(g))) continue;
    const peersByRank = Object.fromEntries(comparison.map(rank => [rank, peers.map(g =>
      all.get(g).results.flatMap(scenario => teamAt(scenario, rank).map(team => scenario.stats.get(team)))
    )]));
    for (const fixture of pending) {
      result.set(fixture.id, {
        fixtureId: fixture.id, kickoff: fixture.ts, homeId: fixture.home, awayId: fixture.away, group,
        H: describeTeam(group, fixture, fixture.home, results, peersByRank),
        A: describeTeam(group, fixture, fixture.away, results, peersByRank)
      });
    }
  }
  return result;
}

export function nationsSelectionReason(game, market, now, decision) {
  const context = game.nationsLeague, f = game.fixture;
  if (!isNationsFixture(f) || !['H', 'A'].includes(market)) return 'nations_stage_or_market_excluded';
  if (!context || context.fixtureId !== f.id || context.kickoff !== f.ts || context.homeId !== f.home || context.awayId !== f.away ||
      !Number.isFinite(context.observedAt) || context.observedAt > now || now - context.observedAt >= NATIONS_SNAPSHOT_TTL) {
    return 'nations_context_unavailable';
  }
  const stage = nationsKnockoutStage(f);
  if (stage && context.stage !== stage) return 'nations_context_unavailable';
  if (stage === 'third_place' && !(game.prediction?.contextAdjustment?.home?.confirmed &&
      game.prediction?.contextAdjustment?.away?.confirmed)) return 'nations_lineups_unconfirmed';
  const status = context[market]?.status;
  if (status === 'decided') return 'nations_objective_decided';
  if (!['needs_win', 'draw_enough', 'in_play'].includes(status)) return 'nations_context_uncertain';
  if (status === 'draw_enough' && decision.decisionProbability + 1e-12 < decision.minimumProbability + .05) {
    return 'nations_draw_sufficient';
  }
  return null;
}

export const NATIONS_FIXTURES_PATH = `fixtures?league=${NATIONS_LEAGUE}&season=${NATIONS_SEASON}`;
export function nationsMode(env, fixture = null) {
  const mode = fixture && nationsKnockoutStage(fixture) ? env.NATIONS_KNOCKOUT_MODE : env.NATIONS_LEAGUE_MODE;
  return ['shadow', 'live'].includes(mode) ? mode : 'off';
}
export function nationsWindow(now, env) {
  const within = (start, end) => now >= start - 2 * DAY && now < end + 3 * DAY;
  return (nationsMode(env) !== 'off' && now >= VALIDATION_START && now < GROUPS_END + 3 * DAY) ||
    (['shadow', 'live'].includes(env.NATIONS_KNOCKOUT_MODE) &&
      (within(MARCH_START, MARCH_END) || within(FINALS_START, FINALS_END)));
}

export function contextFromSnapshot(snapshot, normalize, now) {
  const at = snapshot?.fetchedAt;
  if (!Number.isFinite(at) || at > now || now - at >= NATIONS_SNAPSHOT_TTL ||
      !Array.isArray(snapshot.items) || (snapshot.paging?.total ?? 1) !== 1) return new Map();
  const fixtures = snapshot.items.map(normalize).filter(Boolean);
  const contexts = new Map([...nationsScenarios(fixtures, now), ...knockoutScenarios(fixtures, now)]);
  return new Map([...contexts].map(([id, context]) => [id, { ...context, observedAt: at }]));
}
