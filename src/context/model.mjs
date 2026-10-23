import {assessMarket} from './policy.mjs';
import {grid,mixtureProjection,extraGoalMarkets} from '../legacy-worker.mjs';
import {availabilityFeatures,marketReference} from './features.mjs';
export const CONTEXT_VERSION='luxtips-events-xg-elo020-live-v4';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function contextPrediction(history,fixture,base,sources,quotes,now){
 if(now>=fixture.ts||fixture.finished||fixture.status!=='NS')return base;
 const safe=Object.fromEntries(Object.entries(sources).filter(([,s])=>Number.isFinite(s.observedAt)&&s.observedAt<=now&&s.observedAt<fixture.ts&&Number.isFinite(s.sourceAt)&&s.sourceAt<=now));
 const injuries=safe.injuries?.data??null,lineups=safe.lineups?.data??[];
 const home=availabilityFeatures(injuries,lineups,[],fixture,fixture.home);
 const away=availabilityFeatures(injuries,lineups,[],fixture,fixture.away);
 const measured=base.matchDetailsEnrichment?.active===true||(base.matchDetailsEnrichment?.excludedRedCardMatches||0)>0;
 const original=base.components?.length?base.components:[{weight:1,homeGoals:base.homeGoals,awayGoals:base.awayGoals}];
 const components=original.map(c=>({...c}));
 const projected=components.map(c=>({...c,p:grid(c.homeGoals,c.awayGoals)}));
 const probabilities=Object.fromEntries(Object.keys(projected[0].p).map(k=>[k,projected.reduce((s,c)=>s+c.weight*c.p[k],0)]));
 Object.assign(probabilities,extraGoalMarkets(components));
 const marketComponents=components.map(c=>({...grid(c.homeGoals,c.awayGoals),...extraGoalMarkets([{...c,weight:1}])}));
 const spread=Object.fromEntries(Object.keys(probabilities).map(k=>[k,Math.max(...marketComponents.map(c=>c[k]))-Math.min(...marketComponents.map(c=>c[k]))]));
 const missing=[];
 if(!home.known||!away.known)missing.push('injuries');
 if(!home.confirmed||!away.confirmed)missing.push('confirmed-lineups');
 if(!base.matchDetailsEnrichment?.active)missing.push('complete-match-detail-sample');
 const market=marketReference(quotes,fixture,now);
 const labels={'injuries':'boletim de ausências','confirmed-lineups':'onzes confirmados','complete-match-detail-sample':'amostra suficiente de remates e acontecimentos completos'};
 return {...base,version:CONTEXT_VERSION,modelEvidence:'user-enabled-live; events/xG extension not prospectively calibrated',homeGoals:components.reduce((s,c)=>s+c.weight*c.homeGoals,0),awayGoals:components.reduce((s,c)=>s+c.weight*c.awayGoals,0),
  probabilities,luxg:mixtureProjection(components),components,
  contextAdjustment:{active:measured,status:missing.length?'partial':'available',version:'events-xg-availability-v1',home,away,missing,probabilityAdjustmentFromAvailability:false,
   sources:Object.fromEntries(Object.entries(safe).map(([k,s])=>[k,{observedAt:s.observedAt,sourceAt:s.sourceAt}])),
   uncertainty:{kind:'model-component-disagreement; not a confidence interval',spread,minimumExpectedReturn:.03},
   market,activation:'user-requested-live; contextual effects are observational and not prospectively calibrated'},
  risks:[...base.risks.filter(r=>!r.includes('Ausências e alinhamentos não ajustam')&&!r.includes('validada retrospetivamente')&&(!base.xgEnrichment?.active||!r.includes('não representa xG'))),
   'Ausências e onzes são informação contextual; não foi atribuído um efeito numérico arbitrário a cada jogador.',
   ...(base.matchDetailsEnrichment?.active?['Oportunidades em jogo corrido e bolas paradas analisadas separadamente; jogos com expulsões excluídos deste ajuste.']:[]),
   ...(missing.length?['Informação em falta: '+missing.map(k=>labels[k]||k).join(', ')+'.']:[])],
 };
}
export function selectionAssessment(g,now){
 return assessMarket(g,(g.displayTip||g.winnerTip)?.market,now);
}
