import {liveEnvironment} from '../openfoot/live.mjs';
import {contextSources} from './collect.mjs';
import {contextPrediction} from './model.mjs';
import {detailedPrediction,historyWithoutKnownRedCards} from './details-model.mjs';
import {competitionEvidence} from '../legacy-worker.mjs';
import {fitLiveStrength,predictLiveStrength} from '../openfoot/strength.mjs';
import {competitionFor} from '../openfoot/config.mjs';
export function predictionEnvironment(env){
 const enriched=liveEnvironment(env);
 if(env.PREDICTION_CONTEXT_MODE!=='live')return enriched;
 const detailCache=new Map();
 return {...enriched,async __openfootEnrich(history,fixture,base,now){
  let p=base;
  try{
   if(!detailCache.has(fixture.league)){
    const rows=await env.DB.prepare('SELECT data FROM openfoot_match_details WHERE observed_at<=? AND kickoff<? ORDER BY observed_at DESC').bind(now,now).all();
    detailCache.set(fixture.league,rows.results.map(r=>JSON.parse(r.data)));
   }
   const details=detailCache.get(fixture.league),clean=historyWithoutKnownRedCards(history,details,now);
   if(competitionFor(fixture.league)||clean.length!==history.length)p=competitionEvidence(predictLiveStrength(fitLiveStrength(clean,now,fixture.league),fixture),fixture.league);
   if(typeof enriched.__openfootEnrich==='function')p=await enriched.__openfootEnrich(clean,fixture,p,now);
   p=detailedPrediction(history,details,fixture,p,now);
   return contextPrediction(history,fixture,p,await contextSources(env.DB,fixture,now),[],now);
  }catch{return {...p,contextAdjustment:{active:false,status:'unavailable'}};}
 }};
}
