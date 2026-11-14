/**
 * Big Odds research candidate: exact constrained search, not a fitted forecaster.
 * No I/O and no writes. A mathematical optimum is conditional on supplied
 * probabilities and cross-fixture independence; it is not a win guarantee.
 */
export const DEFAULT_POLICY = Object.freeze({
  bookmaker: 'Betano', minLegs: 5, maxLegs: 12,
  minOdd: 8, maxOdd: 15, minLegOdd: 1.2, minProbability: 0.5,
  minLegExpectedReturn: 0, minTicketExpectedReturn: 0.03,
  quoteMaxAge: 21600000, kickoffBuffer: 60000,
  disallowRepeatedTeams: true, requireLowerProbability: false,
  maxNodes: 1000000,
  markets: ['1','2','1X','X2','O15','O25','O35','BY','BN'],
});
const EPS = 1e-12;
const finite = Number.isFinite;
const key = leg => `${leg.fixtureId}:${leg.market}`;

function validatePolicy(policy, now) {
  if (!finite(now) || now < 0) throw new TypeError('Invalid analysis cutoff');
  if (!Number.isInteger(policy.minLegs) || !Number.isInteger(policy.maxLegs)
      || policy.minLegs < 1 || policy.maxLegs < policy.minLegs
      || policy.maxLegs > 12 || !finite(policy.minOdd) || !finite(policy.maxOdd)
      || policy.minOdd <= 1 || policy.maxOdd < policy.minOdd
      || !finite(policy.minLegOdd) || policy.minLegOdd <= 1
      || !finite(policy.minProbability) || policy.minProbability <= 0
      || policy.minProbability > 1 || !Number.isInteger(policy.maxNodes)
      || policy.maxNodes < 1 || !Array.isArray(policy.markets)) {
    throw new TypeError('Invalid optimizer policy');
  }
  for (const k of ['quoteMaxAge','kickoffBuffer']) {
    if (!finite(policy[k]) || policy[k] < 0) throw new TypeError(`Invalid ${k}`);
  }
  for (const k of ['minLegExpectedReturn','minTicketExpectedReturn']) {
    if (policy[k] !== null && (!finite(policy[k]) || policy[k] <= -1)) {
      throw new TypeError(`Invalid ${k}`);
    }
  }
}

/**
 * Candidate contract: fixtureId, home, away, kickoff, market, bookmaker, odd,
 * quoteAt (provider timestamp), observedAt, estimated:false, probability OR
 * probabilities[market]. Optional probabilityLower must come from a separate
 * calibrated model and be <= point probability. Do not fabricate this bound.
 */
export function optimizeBigOdds(candidates, options = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('Expected candidate array');
  const {now, ...overrides} = options;
  const policy = {...DEFAULT_POLICY, ...overrides};
  validatePolicy(policy, now);
  const rejections = {}, latest = new Map();
  const reject = reason => { rejections[reason] = (rejections[reason] || 0) + 1; };
  for (const leg of candidates) {
    if (!leg || !Number.isInteger(leg.fixtureId) || leg.fixtureId <= 0
        || typeof leg.market !== 'string') { reject('invalid_identity'); continue; }
    if (leg.bookmaker !== policy.bookmaker) { reject('wrong_bookmaker'); continue; }
    if (leg.estimated !== false) { reject('unverified_or_estimated_price'); continue; }
    if (!policy.markets.includes(leg.market)) { reject('unsupported_market'); continue; }
    if (![leg.odd,leg.quoteAt,leg.observedAt,leg.kickoff].every(finite)
        || leg.odd <= 1 || !(leg.quoteAt <= leg.observedAt
        && leg.observedAt <= now && leg.quoteAt > now-policy.quoteMaxAge
        && leg.observedAt < leg.kickoff && leg.kickoff > now+policy.kickoffBuffer)) {
      reject('invalid_or_expired_quote'); continue;
    }
    // Latest price, never the most attractive old price.
    const old = latest.get(key(leg));
    if (!old || leg.quoteAt > old.quoteAt
        || leg.quoteAt === old.quoteAt && leg.observedAt > old.observedAt) {
      latest.set(key(leg), leg);
    } else if (leg.quoteAt === old.quoteAt && leg.observedAt === old.observedAt
        && leg.odd !== old.odd) {
      // Ambiguous simultaneous observations must not select the better price.
      latest.set(key(leg), {...old, ambiguousPrice: true});
    }
  }
  const byFixture = new Map();
  for (const leg of latest.values()) {
    if (leg.ambiguousPrice) { reject('conflicting_quotes'); continue; }
    const p = leg.probability ?? leg.probabilities?.[leg.market];
    if (!finite(p) || p <= 0 || p > 1) { reject('invalid_probability'); continue; }
    if (policy.requireLowerProbability && !finite(leg.probabilityLower)) {
      reject('missing_calibrated_lower_probability'); continue;
    }
    const scoreP = leg.probabilityLower ?? p;
    if (!finite(scoreP) || scoreP <= 0 || scoreP > p) {
      reject('invalid_lower_probability'); continue;
    }
    if (scoreP < policy.minProbability || leg.odd < policy.minLegOdd) {
      reject('below_leg_minimum'); continue;
    }
    if (policy.minLegExpectedReturn !== null
        && scoreP*leg.odd < 1+policy.minLegExpectedReturn-EPS) {
      reject('negative_or_insufficient_leg_value'); continue;
    }
    if (policy.disallowRepeatedTeams && (!Number.isInteger(leg.home)
        || !Number.isInteger(leg.away) || leg.home <= 0 || leg.away <= 0
        || leg.home === leg.away)) { reject('invalid_team_identity'); continue; }
    const normalized = {...leg, probability:p, selectionProbability:scoreP};
    if (!byFixture.has(leg.fixtureId)) byFixture.set(leg.fixtureId, []);
    byFixture.get(leg.fixtureId).push(normalized);
  }
  // Conflicting identities for the same fixture invalidate that fixture.
  for (const [id, rows] of byFixture) {
    if (new Set(rows.map(l=>`${l.home}:${l.away}:${l.kickoff}`)).size !== 1) {
      byFixture.delete(id); reject('conflicting_fixture_identity');
    }
  }
  const groups = [...byFixture.values()].map(rows => rows.sort((a,b)=>
    b.selectionProbability-a.selectionProbability || a.market.localeCompare(b.market)))
    .sort((a,b)=> b[0].selectionProbability-a[0].selectionProbability
      || a[0].fixtureId-b[0].fixtureId);
  const maxOdds = groups.map(g=>Math.max(...g.map(l=>l.odd)));
  const bestProb = groups.map(g=>g[0].selectionProbability);
  let best = null, nodes = 0, limited = false;
  const chosen = [], teams = new Set();
  const better = x => !best || x.logProbability > best.logProbability+EPS
    || Math.abs(x.logProbability-best.logProbability)<=EPS &&
      (x.legs.length < best.legs.length || x.legs.length === best.legs.length &&
       (x.odd < best.odd-EPS || Math.abs(x.odd-best.odd)<=EPS &&
        x.legs.map(key).sort().join('|') < best.legs.map(key).sort().join('|')));
  function visit(index, odd, lp, pointLP) {
    if (limited) return;
    if (++nodes > policy.maxNodes) { limited = true; return; }
    const n = chosen.length, slots = policy.maxLegs-n, remaining = groups.length-index;
    if (odd > policy.maxOdd+EPS || n+remaining < policy.minLegs) return;
    if (best && lp < best.logProbability-EPS) return;
    const joint = Math.exp(lp);
    if (n >= policy.minLegs && odd >= policy.minOdd-EPS
        && (policy.minTicketExpectedReturn === null
            || joint*odd >= 1+policy.minTicketExpectedReturn-EPS)) {
      const candidate = {bookmaker:policy.bookmaker, odd, logProbability:lp,
        probability:joint, pointProbability:Math.exp(pointLP),
        expectedNetPerUnit:joint*odd-1, legs:[...chosen]};
      if (better(candidate)) best = candidate;
      // Every additional leg has p<=1; it cannot improve this solution.
      return;
    }
    if (!slots || !remaining) return;
    const possibleOdds = maxOdds.slice(index).sort((a,b)=>b-a).slice(0,slots);
    if (possibleOdds.reduce((v,x)=>v*x,odd) < policy.minOdd-EPS) return;
    const need = Math.max(0,policy.minLegs-n);
    const optimisticLP = bestProb.slice(index).sort((a,b)=>b-a).slice(0,need)
      .reduce((s,p)=>s+Math.log(p),lp);
    if (best && optimisticLP < best.logProbability-EPS) return;
    for (const leg of groups[index]) {
      if (policy.disallowRepeatedTeams && (teams.has(leg.home)||teams.has(leg.away))) continue;
      chosen.push(leg);
      if (policy.disallowRepeatedTeams) { teams.add(leg.home); teams.add(leg.away); }
      visit(index+1,odd*leg.odd,lp+Math.log(leg.selectionProbability),pointLP+Math.log(leg.probability));
      if (policy.disallowRepeatedTeams) { teams.delete(leg.home); teams.delete(leg.away); }
      chosen.pop();
    }
    visit(index+1,odd,lp,pointLP);
  }
  visit(0,1,0,0);
  return {status:limited?'search_limit':best?'optimal':'no_eligible_ticket',
    optimalityProved:!limited, independentGamesAssumed:true,
    probabilityCalibrationValidated:false,
    probabilityBasis:policy.requireLowerProbability?'supplied_lower_probabilities':'supplied_probabilities',
    nodes, fixtureCount:groups.length,
    candidateCount:groups.reduce((n,g)=>n+g.length,0), rejections,
    ticket:best, policy};
}

/** Conservative integration surface: never silently publish an unfinished search. */
export function selectRobustTicket(candidates, options) {
  const result = optimizeBigOdds(candidates, options);
  return result.status === 'optimal' ? result.ticket : null;
}
