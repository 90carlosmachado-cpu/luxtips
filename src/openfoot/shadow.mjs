import { predict2 } from '../legacy-worker.mjs';
import { competitionFor } from './config.mjs';
import {fitStrength} from './strength.mjs';

export const SHADOW_VERSION = 'openfoot-xg-shadow-v1';
export const SHADOW_OPTIONS = Object.freeze({ xgWeight: 0.5, minimumMatches: 12, minimumCoverage: 0.7 });
const DAY = 86_400_000;

export function shadowPrediction(history, observations, fixture, cutoff, options = SHADOW_OPTIONS) {
  if (!competitionFor(fixture.league)) return { status: 'unsupported_competition' };
  if (!Number.isFinite(cutoff) || !Number.isFinite(fixture.ts) || cutoff >= fixture.ts || fixture.finished || fixture.status !== 'NS') {
    return { status: 'not_prematch' };
  }
  if (!Number.isFinite(options.xgWeight) || options.xgWeight < 0 || options.xgWeight > 1) throw new RangeError('invalid_xg_weight');
  const known = new Map();
  for (const o of observations) {
    if (known.has(o.fixtureId)) throw new Error('duplicate_xg_fixture');
    known.set(o.fixtureId, o);
  }
  const eligible = history.filter(f => f.league === fixture.league && f.finished &&
    f.ts + 2 * 3_600_000 < cutoff && f.ts > cutoff - 3 * 365 * DAY);
  const ids = new Set();
  if (eligible.some(f => { const duplicate = ids.has(f.id); ids.add(f.id); return duplicate; })) throw new Error('duplicate_history_fixture');
  const usable = new Map();
  for (const f of eligible) {
    const o = known.get(f.id);
    if (o && f.status === 'FT' && o.league === f.league && o.kickoff === f.ts && o.result?.home === f.hg && o.result?.away === f.ag && Number.isFinite(o.observedAt) && o.observedAt <= cutoff &&
        o.observedAt > f.ts + 2 * 3_600_000 && [o.homeXg, o.awayXg].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 20)) usable.set(f.id, o);
  }
  const teams = [fixture.home, fixture.away].map(id => {
    const rows = eligible.filter(f => f.home === id || f.away === id);
    const measured = rows.filter(f => usable.has(f.id));
    const recent = measured.reduce((n, f) => Math.max(n, f.ts), 0);
    return { id, total: rows.length, xgMatches: measured.length, coverage: rows.length ? measured.length / rows.length : 0, lastXgAt: recent };
  });
  const adaptive = options.adaptiveCoverage === true;
  const weightFor = id => {
    const rows = eligible.filter(f => f.home === id || f.away === id);
    const measured = rows.filter(f => usable.has(f.id));
    const recent = measured.reduce((n,f)=>Math.max(n,f.ts),0);
    if (!measured.length || cutoff-recent>90*DAY) return 0;
    return options.xgWeight * Math.min(1,measured.length/options.minimumMatches) *
      Math.min(1,(measured.length/rows.length)/options.minimumCoverage) *
      Math.min(1,45*DAY/Math.max(DAY,cutoff-recent));
  };
  if (adaptive) for (const t of teams) t.weight=weightFor(t.id);
  if (adaptive ? teams.every(t=>t.weight===0) : teams.some(t => t.xgMatches < options.minimumMatches || t.coverage < options.minimumCoverage || cutoff - t.lastXgAt > 45 * DAY)) {
    return { status: 'insufficient_xg', teams, version: SHADOW_VERSION };
  }
  const weights = new Map([...new Set(eligible.flatMap(f=>[f.home,f.away]))].map(id=>[id,adaptive?weightFor(id):options.xgWeight]));
  const blended = eligible.map(f => {
    const o = usable.get(f.id);
    const hw=weights.get(f.home),aw=weights.get(f.away);
    return o ? { ...f, hg: (1 - hw) * f.hg + hw * o.homeXg,
      ag: (1 - aw) * f.ag + aw * o.awayXg } : { ...f };
  });
  // Keep the deployed mixture and its hyperparameters fixed: only historical
  // training targets change. The controlled baseline uses identical history/time.
  const controlStates=fitStrength(eligible,cutoff,options.prior??8,options.eloWeight??0);
  const candidateStates=fitStrength(blended,cutoff,options.prior??8,options.eloWeight??0);
  // Elo learns actual match outcomes, never the synthetic goals/xG targets.
  for(let i=0;i<candidateStates.length;i++)for(const [id,team] of Object.entries(candidateStates[i].state.teams)){
    team.elo=controlStates[i].state.teams[id]?.elo??1500;
  }
  const candidate=predict2(candidateStates,fixture);
  const control=predict2(controlStates,fixture);
  const { homeGoals, awayGoals, probabilities, luxg, components } = candidate;
  return { status: 'ready', version: SHADOW_VERSION, experimental: true, publicationEligible: false,
    cutoff, fixtureId: fixture.id, league: fixture.league, teams,
    homeGoals, awayGoals, probabilities, luxg, components,
    controlledBaseline: { version: control.version, homeGoals: control.homeGoals, awayGoals: control.awayGoals, probabilities: control.probabilities },
    options: { ...options }, observations: usable.size,
    evidence: 'prospective-shadow-only; xg blend weight is provisional, not a calibrated improvement',
  };
}

export async function saveShadowForecasts(db, now = Date.now()) {
  const fixtures = await db.prepare('SELECT data FROM fixtures WHERE finished=0 AND kickoff>? AND kickoff<? AND league IN (39,140,78,135,61) ORDER BY kickoff LIMIT 150')
    .bind(now, now + 3 * DAY).all();
  const existing = await db.prepare('SELECT fixture_id,kickoff FROM openfoot_shadow WHERE version=? AND kickoff>?').bind(SHADOW_VERSION, now).all();
  const recorded = new Set(existing.results.map(r => `${r.fixture_id}:${r.kickoff}`));
  let saved = 0, attempted = 0;
  for (const league of [39, 140, 78, 135, 61]) {
    const targets = fixtures.results.map(r => JSON.parse(r.data)).filter(f => f.league === league && f.status === 'NS' && !recorded.has(`${f.id}:${f.ts}`));
    if (!targets.length) continue;
    const historyRows = await db.prepare('SELECT data FROM fixtures WHERE finished=1 AND league=? AND kickoff<? AND kickoff>? ORDER BY kickoff')
      .bind(league, now - 2 * 3_600_000, now - 3 * 365 * DAY).all();
    const xgRows = await db.prepare('SELECT data FROM openfoot_xg WHERE league=? AND observed_at<=? AND kickoff<?').bind(league, now, now).all();
    const history = historyRows.results.map(r => JSON.parse(r.data)), xg = xgRows.results.map(r => JSON.parse(r.data));
    for (const f of targets) {
      if (attempted >= 10) return { saved, bounded: true };
      const candidate = shadowPrediction(history, xg, f, now);
      if (candidate.status !== 'ready') continue;
      attempted++;
      const baseline = await db.prepare('SELECT data FROM cache WHERE key=?').bind('forecast:' + f.id).first();
      const original = baseline ? JSON.parse(baseline.data) : null;
      // Require a genuinely pre-match baseline for a paired comparison.
      if (!original || original.fixture?.ts !== f.ts || original.fixture?.home !== f.home || original.fixture?.away !== f.away ||
          !Number.isFinite(original.prediction?.cutoff) || original.prediction.cutoff > now) continue;
      const result = await db.prepare('INSERT OR IGNORE INTO openfoot_shadow(fixture_id,version,kickoff,created_at,data) VALUES(?,?,?,?,?)')
        .bind(f.id, SHADOW_VERSION, f.ts, now, JSON.stringify({ fixture: f, baseline: original.prediction, candidate })).run();
      saved += result.meta?.changes || 0;
    }
  }
  return { saved };
}
