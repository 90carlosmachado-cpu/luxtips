// Offline sensitivity study. Never imports this module into the deployed Worker.
// Event-time reconstruction is NOT evidence of historical source availability.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fit,fit2,predict2,outcome} from '../src/legacy-worker.mjs';
const DAY=86400000,LEAGUES=[39,140,78,135,61];
export const VARIANTS=Object.freeze([
 {id:'goals',weight:0,ramp:12},{id:'xg25',weight:.25,ramp:12},
 {id:'xg50',weight:.5,ramp:12},{id:'xg75',weight:.75,ramp:12},
 {id:'xg50-ramp8',weight:.5,ramp:8},
]);
export function prepareInputs(history,observations,target,mode='strict',cutoff=target.ts-3600000){
 if(!Number.isFinite(cutoff)||cutoff>=target.ts)throw Error('invalid_research_cutoff');
 const fixture=Object.fromEntries(['id','league','season','ts','home','away','homeName','awayName','neutral'].map(k=>[k,target[k]]));
 Object.assign(fixture,{finished:false,status:'NS'});
 const h=history.filter(f=>f.league===target.league&&f.finished&&f.status==='FT'&&f.ts+2*3600000<cutoff&&f.ts>cutoff-3*365*DAY&&
  (mode==='event-time-exploratory'||Number.isFinite(f.updatedAt)&&f.updatedAt<=cutoff));
 const byId=new Map(h.map(f=>[f.id,f]));
 const xg=new Map();
 for(const o of observations){const f=byId.get(o.fixtureId);if(!f||o.league!==f.league||o.kickoff!==f.ts||o.result?.home!==f.hg||o.result?.away!==f.ag||
  ![o.homeXg,o.awayXg].every(n=>Number.isFinite(n)&&n>=0&&n<=20)||
  mode!=='event-time-exploratory'&&(!Number.isFinite(o.observedAt)||o.observedAt>cutoff))continue;
  if(xg.has(o.fixtureId))throw Error('duplicate_xg');xg.set(o.fixtureId,o);
 }
 return {fixture,cutoff,history:h,xg};
}
export function projectFull(input,variant){
 const {history:h,fixture,cutoff,xg}=input;
 const weights=new Map();
 for(const id of new Set(h.flatMap(f=>[f.home,f.away]))){
  const rows=h.filter(f=>f.home===id||f.away===id),measured=rows.filter(f=>xg.has(f.id));
  const recent=measured.reduce((n,f)=>Math.max(n,f.ts),0);
  weights.set(id,!measured.length||cutoff-recent>90*DAY?0:variant.weight*Math.min(1,measured.length/variant.ramp)*Math.min(1,(measured.length/rows.length)/.7)*Math.min(1,45*DAY/Math.max(DAY,cutoff-recent)));
 }
 // Production abstains from the entire xG fit when neither target team has
 // usable xG; other teams' xG must not indirectly change that fallback.
 const active=[fixture.home,fixture.away].some(id=>(weights.get(id)||0)>0);
 const blended=!active?h:h.map(f=>{const o=xg.get(f.id);return o?{...f,hg:(1-weights.get(f.home))*f.hg+weights.get(f.home)*o.homeXg,ag:(1-weights.get(f.away))*f.ag+weights.get(f.away)*o.awayXg}:f;});
 const states=variant.prior?fit2([],cutoff).map(c=>({...c,state:fit(blended,cutoff,{...c.state.opts,prior:variant.prior})})):fit2(blended,cutoff);
 const p=predict2(states,fixture);
 return {...p,xgTeams:[weights.get(fixture.home)||0,weights.get(fixture.away)||0]};
}
export function project(input,variant){
 const p=projectFull(input,variant);return {probabilities:p.probabilities,sample:p.sample,xgTeams:p.xgTeams};
}
function metric(rows,market=null,minimum=0){
 let n=0,brier=0,logLoss=0,hits=0;const bins=Array.from({length:10},(_,i)=>({low:i/10,n:0,p:0,hits:0}));
 for(const r of rows){if(r.sample<minimum)continue;const p=r.probabilities;
  if(market){const q=p[market],y=outcome(market,r.hg,r.ag);if(!Number.isFinite(q))continue;n++;brier+=(q-y)**2;logLoss-=y*Math.log(Math.max(1e-15,q))+(1-y)*Math.log(Math.max(1e-15,1-q));hits+=Number((q>=.5)===!!y);const b=bins[Math.min(9,Math.floor(q*10))];b.n++;b.p+=q;b.hits+=y;
  }else{n++;const actual=r.hg>r.ag?'H':r.hg<r.ag?'A':'D';brier+=['H','D','A'].reduce((s,k)=>s+(p[k]-Number(k===actual))**2,0);logLoss-=Math.log(Math.max(1e-15,p[actual]));hits+=Number(['H','D','A'].sort((a,b)=>p[b]-p[a])[0]===actual);}
 }
 return {n,brier:n?brier/n:null,logLoss:n?logLoss/n:null,accuracy:n?hits/n:null,...(market?{calibration:bins.map(b=>({low:b.low,n:b.n,meanProbability:b.n?b.p/b.n:null,frequency:b.n?b.hits/b.n:null}))}:{})};
}
export function summarize(rows){
 const winner=minimum=>{const selected=rows.filter(r=>r.sample>=minimum&&Math.max(r.probabilities.H,r.probabilities.A)>=.6);return {n:selected.length,hits:selected.filter(r=>r.probabilities.H>=r.probabilities.A?r.hg>r.ag:r.ag>r.hg).length};};
 return {all1X2:metric(rows),sample12_1X2:metric(rows,null,12),winner60_sample12:winner(12),winner60_sample8:winner(8),xgActive:rows.filter(r=>r.xgTeams.some(w=>w>0)).length,
  markets:Object.fromEntries(['H','D','A','O25','U25','U45','BY'].map(m=>[m,metric(rows,m)]))};
}
export async function loadResearchData(){
 const fixtures=new Map(),observations=[];
 for(const file of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+file,'utf8')))fixtures.set(f[0],{id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT'});
 for(const row of JSON.parse(await readFile('work/football-refresh/fixtures.json','utf8')))fixtures.set(row.fixture.id,{...row.fixture,updatedAt:row.updatedAt});
 for(const file of await readdir('work/bulk-xg/observations'))observations.push(JSON.parse(await readFile('work/bulk-xg/observations/'+file,'utf8')));
 const history=[...fixtures.values()].filter(f=>LEAGUES.includes(f.league)&&f.finished&&f.status==='FT').sort((a,b)=>a.ts-b.ts||a.id-b.id);
 return {history,observations};
}
export async function run(){
 const {history,observations}=await loadResearchData();
 const now=Date.now(),test=history.filter(f=>f.season===2026&&f.ts+2*3600000<now);
 // Bounded predeclared development period, never selected by observed scores.
 const development=LEAGUES.flatMap(l=>history.filter(f=>f.league===l&&f.season===2025).slice(-100)).sort((a,b)=>a.ts-b.ts||a.id-b.id);
 const protocol={createdAt:new Date().toISOString(),mode:'event-time-exploratory',strictHistoricalAvailability:false,productionWrites:0,paidProviderRequests:0,
  scope:'Sensitivity of existing goals/xG mixture only; not a replay of the full events/context live model.',
  targetHorizonHours:1,development:'last 100 completed 2025-season matches per league',holdout:'all available completed 2026-season matches; used once after development choice',
  selection:'lowest pooled development multiclass 1X2 Log Loss; ties follow fixed variant order',variants:VARIANTS,
  selectionThresholds:[8,12],odds:null,roi:null,fullPublicationPolicySimulated:false,
  limitations:['Historical provider revisions/availability unverified; imports occurred after matches.','Prior model and mappings were developed after some test matches; holdout is retrospective, not genuinely blind.','No historical injuries, lineups, shot/event details or contemporaneous odds reconstructed.','Any threshold subset is descriptive, not betting profitability or a reason to promote a model.']};
 const inputHash=createHash('sha256').update(JSON.stringify({history,observations})).digest('hex');
 await mkdir('work/research-xg',{recursive:true});
 await writeFile('work/research-xg/protocol.json',JSON.stringify({...protocol,inputHash},null,2));
 const scores={development:{},holdout:{}};
 for(const [phase,targets] of [['development',development],['holdout',test]]){
  for(const v of VARIANTS)scores[phase][v.id]=[];
  for(let i=0;i<targets.length;i++){
   const target=targets[i],input=prepareInputs(history,observations,target,'event-time-exploratory');
   for(const v of VARIANTS){const prediction=project(input,v);scores[phase][v.id].push({id:target.id,league:target.league,ts:target.ts,...prediction,hg:target.hg,ag:target.ag});}
   if((i+1)%50===0)console.log(JSON.stringify({phase,done:i+1,total:targets.length}));
  }
  if(phase==='development'){
   const chosen=VARIANTS.map(v=>({id:v.id,logLoss:summarize(scores.development[v.id]).all1X2.logLoss})).sort((a,b)=>a.logLoss-b.logLoss)[0];
   await writeFile('work/research-xg/development-choice.json',JSON.stringify(chosen));protocol.developmentChoice=chosen;
  }
 }
 const report={protocol,inputHash,history:history.length,xg:observations.length,strictTargetsWithAnyXg:test.filter(f=>prepareInputs(history,observations,f).xg.size>0).length,
  periods:Object.fromEntries(Object.entries(scores).map(([phase,variants])=>[phase,Object.fromEntries(Object.entries(variants).map(([id,rows])=>[id,{pooled:summarize(rows),byLeague:Object.fromEntries(LEAGUES.map(l=>[l,summarize(rows.filter(r=>r.league===l))]))}]))]))};
 await writeFile('work/research-xg/predictions.json',JSON.stringify(scores));
 await writeFile('../../outputs/Estudo-xG-resultados.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({completed:true,development:development.length,holdout:test.length,choice:protocol.developmentChoice,strictTargetsWithAnyXg:report.strictTargetsWithAnyXg,metrics:Object.fromEntries(Object.entries(report.periods.holdout).map(([k,v])=>[k,v.pooled.all1X2]))}));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
