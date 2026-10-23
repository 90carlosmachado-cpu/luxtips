import { shadowPrediction, SHADOW_OPTIONS } from './shadow.mjs';
import { competitionFor } from './config.mjs';
import {LIVE_STRENGTH_PRIOR,LIVE_ELO_WEIGHT} from './strength.mjs';

export function liveEnvironment(env) {
  if (env.OPENFOOT_MODE !== 'live') return env;
  const observations = new Map();
  return { ...env, async __openfootEnrich(history, fixture, baseline, now) {
    if (!competitionFor(fixture.league)) return baseline;
    try {
      if (!observations.has(fixture.league)) {
        const rows = await env.DB.prepare('SELECT data FROM openfoot_xg WHERE league=? AND observed_at<=? AND kickoff<?')
          .bind(fixture.league, now, now).all();
        const values=rows.results.map(r=>JSON.parse(r.data));
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));
        observations.set(fixture.league,{values,inputDigest:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''),observedAtMax:values.reduce((n,r)=>Math.max(n,r.observedAt),0)});
      }
      const info=observations.get(fixture.league),p=enrichPrediction(history,info.values,fixture,baseline,now);
      if(p.xgEnrichment?.active)p.xgEnrichment={...p.xgEnrichment,inputDigest:info.inputDigest,observedAtMax:info.observedAtMax};
      return p;
    } catch {
      return { ...baseline, xgEnrichment: { status: 'unavailable', active: false } };
    }
  } };
}

export function enrichPrediction(history, observations, fixture, baseline, now) {
  const p = shadowPrediction(history, observations, fixture, now, {...SHADOW_OPTIONS,prior:LIVE_STRENGTH_PRIOR,eloWeight:LIVE_ELO_WEIGHT,adaptiveCoverage:true});
  if (p.status !== 'ready') return { ...baseline, xgEnrichment: { status: p.status, active: false } };
  return { ...baseline, version: 'openfoot-xg-live-v1',
    homeGoals: p.homeGoals, awayGoals: p.awayGoals, probabilities: p.probabilities, luxg: p.luxg, components: p.components,
    modelEvidence: 'user-enabled-live-awaiting-prospective-validation',
    xgEnrichment: { active: true, status: p.teams.some(t=>t.weight<p.options.xgWeight)?'partial':'ready', source: 'OpenFootAPI/FotMob', weight: p.options.xgWeight, weighting:'per-team-sample-coverage-recency',
      observations: p.observations, teams: p.teams, prior:LIVE_STRENGTH_PRIOR,eloWeight:LIVE_ELO_WEIGHT,baselineVersion: baseline.version },
    risks: [...baseline.risks.filter(x => !x.includes('validada retrospetivamente')),
      'Enriquecimento com xG histórico ativo; melhoria prospetiva ainda não demonstrada.'],
  };
}
