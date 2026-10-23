// Bounded, auditable research batch; no runtime imports or production writes.
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadResearchData,prepareInputs,project,summarize} from './research-xg.mjs';
const {history,observations}=await loadResearchData();
const variants=[{id:'goals8',weight:0,ramp:12,prior:8},{id:'xg50-prior8',weight:.5,ramp:12,prior:8},
 {id:'xg50-prior4',weight:.5,ramp:12,prior:4},{id:'xg50-prior16',weight:.5,ramp:12,prior:16}];
const protocol={at:new Date().toISOString(),hypothesis:'Favorites appear underconfident. Test bounded prior shrinkage changes with same xG/temporal mixture; do not lower publication criteria.',
 variants,mode:'event-time-exploratory',developmentSeason:2024,validationSeason:2025,auditSeasonAlreadySeen:2026,
 selection:'lowest 2024 pooled 1X2 Log Loss; retain choice and compare to controls on 2025 and 2026 without reselection',
 restriction:'Stop this batch after these four variants; 2026 already seen, no claim of fresh holdout. No odds, ROI or publication simulation. Not the full live contextual model.',
 inputHash:createHash('sha256').update(JSON.stringify({history,observations})).digest('hex')};
await mkdir('work/research-strength',{recursive:true});await writeFile('work/research-strength/protocol.json',JSON.stringify(protocol,null,2));
const all={},summary={};
for(const year of [2024,2025,2026]){
 const targets=history.filter(f=>f.season===year),rows=Object.fromEntries(variants.map(v=>[v.id,[]]));
 for(let i=0;i<targets.length;i++){
  const f=targets[i],input=prepareInputs(history,observations,f,'event-time-exploratory');
  for(const v of variants)rows[v.id].push({id:f.id,league:f.league,ts:f.ts,hg:f.hg,ag:f.ag,...project(input,v)});
  if((i+1)%100===0)console.log(JSON.stringify({year,done:i+1,total:targets.length}));
 }
 all[year]=rows;summary[year]=Object.fromEntries(Object.entries(rows).map(([id,r])=>[id,{pooled:summarize(r),byLeague:Object.fromEntries([39,140,78,135,61].map(l=>[l,summarize(r.filter(f=>f.league===l))]))}]));
 if(year===2024){protocol.choice=variants.map(v=>({id:v.id,logLoss:summary[year][v.id].pooled.all1X2.logLoss})).sort((a,b)=>a.logLoss-b.logLoss)[0];await writeFile('work/research-strength/choice.json',JSON.stringify(protocol.choice));}
 await writeFile('work/research-strength/predictions.json',JSON.stringify(all));
 await writeFile('../../outputs/Estudo-forca-xG-resultados.json',JSON.stringify({protocol,summary},null,2));
 console.log(JSON.stringify({year,choice:protocol.choice,metrics:Object.fromEntries(Object.entries(summary[year]).map(([k,v])=>[k,v.pooled.all1X2]))}));
}
