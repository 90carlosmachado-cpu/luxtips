import {fit2,predict2,grid,mixtureProjection,extraGoalMarkets} from '../legacy-worker.mjs';
const DAY=86400000,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function usableDetails(history,details,now){
 const fixtures=new Map(history.map(f=>[f.id,f])),known=new Map();
 for(const d of [...details].sort((a,b)=>b.observedAt-a.observedAt)){
  const f=fixtures.get(d.fixtureId);
  if(known.has(d.fixtureId)||!f||d.league!==f.league||d.kickoff!==f.ts||d.result?.home!==f.hg||d.result?.away!==f.ag||!Number.isFinite(d.observedAt)||d.observedAt>now||d.observedAt<=f.ts+7200000||!d.timeline?.complete)continue;
  known.set(d.fixtureId,d);
 }
 return known;
}
export function historyWithoutKnownRedCards(history,details,now){
 const known=usableDetails(history,details,now);
 return history.filter(f=>!known.get(f.id)?.timeline.redCards.length);
}
export function detailedPrediction(history,details,fixture,base,now){
 const known=usableDetails(history,details,now),rows=history.filter(f=>f.league===fixture.league&&f.finished&&f.ts+7200000<now&&f.ts>now-3*365*DAY);
 const clean=rows.filter(f=>{const d=known.get(f.id);return d&&!d.timeline.redCards.length&&['home','away'].every(s=>d.shotProfiles?.[s]&&d.shotProfiles[s].unknownSituationShots===0);});
 const teamCoverage=[fixture.home,fixture.away].map(id=>{const f=clean.filter(f=>f.home===id||f.away===id);return{id,matches:f.length,lastAt:Math.max(0,...f.map(f=>f.ts))};});
 const exclusions=[...known.values()].filter(d=>d.league===fixture.league&&d.timeline.redCards.length).length;
 if(!base.xgEnrichment?.active||clean.length<30||teamCoverage.some(t=>t.matches<12||now-t.lastAt>45*DAY))return {...base,matchDetailsEnrichment:{active:false,status:'insufficient_complete_match_details',teams:teamCoverage,excludedRedCardMatches:exclusions}};
 const rates=Object.fromEntries(['home','away'].map(s=>[s,{xg:0,minutes:0,states:Object.fromEntries(['tied','leading','trailing'].map(k=>[k,{xg:0,minutes:0}]))}]));
 for(const f of clean){
  const d=known.get(f.id);
  for(const side of ['home','away']){
   const r=rates[side],profile=d.shotProfiles[side],e=d.timeline.exposure;r.xg+=profile.nonPenaltyXg;r.minutes+=90;
   for(const state of ['tied','leading','trailing']){
    const exposure=state==='tied'?e.tied:state==='leading'?(side==='home'?e.homeLeading:e.awayLeading):(side==='home'?e.awayLeading:e.homeLeading);
    r.states[state].minutes+=exposure;r.states[state].xg+=d.timeline.scoreStateXg[side][state].nonPenaltyXg;
   }
  }
 }
 const factors=Object.fromEntries(['home','away'].map(s=>[s,Object.fromEntries(['tied','leading','trailing'].map(k=>{
  const r=rates[s],b=r.states[k];return[k,b.minutes>=300&&b.xg>0?clamp((r.xg/r.minutes)/(b.xg/b.minutes),.75,1.25):1];
 }))]));
 const target=(d,side,part)=>Object.entries(d.timeline.scoreStateXg[side]).reduce((sum,[state,p])=>sum+p[part]*(factors[side][state]??1),0);
 const open=clean.map(f=>({...f,hg:target(known.get(f.id),'home','openPlayXg'),ag:target(known.get(f.id),'away','openPlayXg')}));
 const set=clean.map(f=>({...f,hg:target(known.get(f.id),'home','setPieceXg'),ag:target(known.get(f.id),'away','setPieceXg')}));
 const op=predict2(fit2(open,now),fixture),sp=predict2(fit2(set,now),fixture);
 if(Math.min(op.sample,sp.sample)<12)return {...base,matchDetailsEnrichment:{active:false,status:'insufficient_effective_detail_sample',sample:Math.min(op.sample,sp.sample),teams:teamCoverage,excludedRedCardMatches:exclusions}};
 const penalties={home:clean.reduce((s,f)=>s+known.get(f.id).shotProfiles.home.penaltyGoals,0)/clean.length,away:clean.reduce((s,f)=>s+known.get(f.id).shotProfiles.away.penaltyGoals,0)/clean.length};
 const weight=Math.min(.35,Math.min(op.sample,sp.sample)/(Math.min(op.sample,sp.sample)+40));
 const original=base.components?.length?base.components:[{weight:1,homeGoals:base.homeGoals,awayGoals:base.awayGoals}];
 const components=original.map((c,i)=>({weight:c.weight,homeGoals:clamp((1-weight)*c.homeGoals+weight*((op.components[i]?.homeGoals??op.homeGoals)+(sp.components[i]?.homeGoals??sp.homeGoals)+penalties.home),.15,5),awayGoals:clamp((1-weight)*c.awayGoals+weight*((op.components[i]?.awayGoals??op.awayGoals)+(sp.components[i]?.awayGoals??sp.awayGoals)+penalties.away),.15,5)}));
 const projections=components.map(c=>({...c,p:grid(c.homeGoals,c.awayGoals)}));
 const probabilities=Object.fromEntries(Object.keys(projections[0].p).map(k=>[k,projections.reduce((s,c)=>s+c.weight*c.p[k],0)]));
 Object.assign(probabilities,extraGoalMarkets(components));
 return {...base,homeGoals:components.reduce((s,c)=>s+c.weight*c.homeGoals,0),awayGoals:components.reduce((s,c)=>s+c.weight*c.awayGoals,0),probabilities,components,luxg:mixtureProjection(components),
  matchDetailsEnrichment:{active:true,status:'ready',source:'OpenFootAPI/FotMob',teams:teamCoverage,matches:clean.length,weight,excludedRedCardMatches:exclusions,
   nonPenalty:true,openPlay:{home:op.homeGoals,away:op.awayGoals},setPieces:{home:sp.homeGoals,away:sp.awayGoals},leaguePenaltyGoalRate:penalties,scoreStateFactors:factors,
   method:'separate open-play/set-piece fits; empirical score-state rates; red-card matches excluded; uncertainty-weighted detail mixture; uncalibrated live extension'}};
}
