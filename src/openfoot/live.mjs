import { shadowPrediction, SHADOW_OPTIONS } from './shadow.mjs';
import { competitionFor } from './config.mjs';

export function liveEnvironment(env) {
  if (env.OPENFOOT_MODE !== 'live') return env;
  const observations = new Map();
  return { ...env, async __openfootEnrich(history, fixture, baseline, now) {
    if (!competitionFor(fixture.league)) return baseline;
    try {
      if (!observations.has(fixture.league)) {
        const rows = await env.DB.prepare('SELECT data FROM openfoot_xg WHERE league=? AND observed_at<=? AND kickoff<?')
          .bind(fixture.league, now, now).all();
        observations.set(fixture.league, rows.results.map(r => JSON.parse(r.data)));
      }
      return enrichPrediction(history, observations.get(fixture.league), fixture, baseline, now);
    } catch {
      return { ...baseline, xgEnrichment: { status: 'unavailable', active: false } };
    }
  } };
}

export function enrichPrediction(history, observations, fixture, baseline, now) {
  const p = shadowPrediction(history, observations, fixture, now, {...SHADOW_OPTIONS,adaptiveCoverage:true});
  if (p.status !== 'ready') return { ...baseline, xgEnrichment: { status: p.status, active: false } };
  return { ...baseline, version: 'openfoot-xg-live-v1',
    homeGoals: p.homeGoals, awayGoals: p.awayGoals, probabilities: p.probabilities, luxg: p.luxg, components: p.components,
    modelEvidence: 'user-enabled-live-awaiting-prospective-validation',
    xgEnrichment: { active: true, status: p.teams.some(t=>t.weight<p.options.xgWeight)?'partial':'ready', source: 'OpenFootAPI/FotMob', weight: p.options.xgWeight, weighting:'per-team-sample-coverage-recency',
      observations: p.observations, teams: p.teams, baselineVersion: baseline.version },
    risks: [...baseline.risks.filter(x => !x.includes('validada retrospetivamente')),
      'Enriquecimento com xG histórico ativo; melhoria prospetiva ainda não demonstrada.'],
  };
}
