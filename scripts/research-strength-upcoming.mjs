import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadResearchData,prepareInputs,projectFull} from './research-xg.mjs';
import {historyWithoutKnownRedCards,detailedPrediction} from '../src/context/details-model.mjs';
import {contextPrediction} from '../src/context/model.mjs';
import {assessMarket} from '../src/context/policy.mjs';
const snapshot=JSON.parse(await readFile('work/research-strength/upcoming.json','utf8'));
const {history,observations}=await loadResearchData(),details=[];
for(const n of await readdir('work/bulk-xg/details'))details.push(JSON.parse(await readFile('work/bulk-xg/details/'+n,'utf8')));
const now=Date.now(),clean=historyWithoutKnownRedCards(history,details,now),rows=[];
const sourceHash=createHash('sha256').update(JSON.stringify({history,observations,details,snapshot})).digest('hex');
const previous=await readFile('work/research-strength/prospective.json','utf8').catch(()=>null);
if(previous){const prior=JSON.parse(previous);await writeFile('work/research-strength/prospective-'+prior.at+'.json',previous,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}
for(const g of snapshot.games){
 if(g.fixture.ts<=now||g.fixture.status!=='NS'||g.fixture.finished)continue;
 const input=prepareInputs(clean,observations.filter(o=>o.observedAt<=now),g.fixture,'event-time-exploratory',now),variants={};
 for(const prior of [8,4]){
  let p=projectFull(input,{weight:.5,ramp:12,prior});p.xgEnrichment={active:p.xgTeams.some(w=>w>0)};
  p=detailedPrediction(history,details,g.fixture,p,now);
  p=contextPrediction(history,g.fixture,p,{},[],now);
  p.version='research-base-prior'+prior+'-fallback-v2';
  variants[prior]={prediction:{version:p.version,cutoff:p.cutoff,probabilities:p.probabilities,sample:p.sample,components:p.components,detailActive:p.matchDetailsEnrichment?.active},
   H:assessMarket({...g,prediction:p},'H',now),A:assessMarket({...g,prediction:p},'A',now)};
 }
 rows.push({fixture:g.fixture,sourceUpdatedAt:g.sourceUpdatedAt,odds:g.odds,current:g.current,variants});
}
const report={at:now,createdAt:new Date(now).toISOString(),sourceHash,mode:'prospective-local-research-only',published:false,productionWrites:0,
 limitations:['Local imported source snapshot; baseline may differ from latest production history/details.','Injuries and lineups omitted: current model records them but does not numerically adjust probabilities.','All upcoming fixtures are frozen before kickoff; no outcomes included.','Eligibility is H/A market-level only; no daily ranking or cap simulated.'],
 summary:Object.fromEntries([8,4].map(k=>[k,{fixtures:rows.length,eligible:rows.flatMap(r=>['H','A'].filter(m=>r.variants[k][m].eligible).map(m=>({id:r.fixture.id,home:r.fixture.homeName,away:r.fixture.awayName,market:m,...r.variants[k][m]}))),reasons:rows.flatMap(r=>['H','A'].map(m=>r.variants[k][m].reason)).reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{})}])),rows};
await writeFile('work/research-strength/prospective-'+now+'.json',JSON.stringify(report),{flag:'wx'});
await writeFile('work/research-strength/prospective.json',JSON.stringify(report));
await writeFile('../../outputs/Candidato-xG-proximos-jogos.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({at:now,summary:report.summary,maxBaselineDifference:Math.max(...rows.flatMap(r=>['H','A'].map(m=>Math.abs(r.current[m]-r.variants[8].prediction.probabilities[m]))))}));
