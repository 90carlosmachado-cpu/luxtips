#!/usr/bin/env node
/**
 * Offline chronological diagnostic. Never imported by the Worker and never
 * writes production. Import clocks are retained as evidence but cannot support
 * historical availability: event time + 2h is an explicit research assumption.
 * Usage: node scripts/validate-bigodes-quality.mjs [--history FILE] [--out DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {xgMarketModel,scoreProbabilities,marketHit} from '../production/tests/fixtures/bigodds-model-before.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DAY=86400000,HOUR=3600000;
const NATIONAL_LEAGUES=new Set([1,4,5,32,960]);
const MARKETS=['1','2','1X','X2','O15','O25','O35','BY','BN'];
const OPTIONS=Object.freeze({prior:8,halfLifeDays:365});
const splitAt=Date.parse('2026-01-01T00:00:00Z');
const flags=new Map();
for(let i=2;i<process.argv.length;i++){
 const arg=process.argv[i];
 if(arg==='--protocol-only')flags.set(arg,true);
 else if(['--history','--out','--snapshot'].includes(arg)&&process.argv[i+1])flags.set(arg,process.argv[++i]);
 else throw new Error('Unknown or incomplete option: '+arg);
}
const studyDirectory=path.join(ROOT,'research/bigodes-quality-20261116');
const input=path.resolve(flags.get('--history')||path.join(studyDirectory,'national-history.json'));
if(!flags.has('--snapshot'))flags.set('--snapshot',path.join(studyDirectory,'decision-snapshot.json'));
const out=path.resolve(flags.get('--out')||path.join(ROOT,'research/bigodes-quality-20261116'));
fs.mkdirSync(out,{recursive:true});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const raw=fs.readFileSync(input);
const rows=JSON.parse(raw);
if(!Array.isArray(rows))throw new TypeError('History must be an array');
const valid=r=>Number.isInteger(r.id)&&Number.isInteger(r.home)&&Number.isInteger(r.away)&&r.home!==r.away&&
 Number.isInteger(r.hg)&&Number.isInteger(r.ag)&&r.hg>=0&&r.ag>=0&&Number.isFinite(r.kickoff)&&
 Number.isFinite(r.settled_at)&&r.status==='FT'&&NATIONAL_LEAGUES.has(r.league);
if(rows.some(r=>!valid(r)))throw new Error('Input contains invalid, non-official or non-90-minute results');
if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Input contains duplicate fixture IDs');
rows.sort((a,b)=>a.kickoff-b.kickoff||a.id-b.id);
const counts={};
for(const r of rows){const key=`${r.league}/${new Date(r.kickoff).getUTCFullYear()}`;counts[key]=(counts[key]||0)+1;}
const protocol={
 id:'bigodes-national-quality-20261116-v1',
 scope:'Nations League target matches; common paired sample, official national-team history only',
 source:{sha256:sha(raw),rows:rows.length,counts,firstKickoff:rows[0]?.kickoff,lastKickoff:rows.at(-1)?.kickoff,
  importsMoreThanOneDayLate:rows.filter(r=>r.settled_at>r.kickoff+DAY).length},
 development:'Calendar 2024–2025; 2023 is warm-up. Descriptive only; no parameter search.',
 evaluation:'Calendar 2026; fixed candidate configuration, no tuning on these outcomes.',
 candidateOptions:OPTIONS,
 baseline:'Frozen xgMarketModel, prior2/half-life90, Nations League history only; no xG for these data.',
 candidate:'Regularized attack/defence strengths adjusted to opponent strength; pooled official national-team history.',
 predictionTime:'08:00 Europe/Lisbon on each match day; simultaneous matches share the same historical cutoff.',
 historicalAvailability:'RETROSPECTIVE EVENT-TIME RECONSTRUCTION. Results assumed available kickoff+2h. Actual import/revision clocks were mostly later and do not prove contemporary availability.',
 tournamentVenue:'Candidate treats final tournaments (World Cup/Euro) as neutral unless independently verified otherwise. Legacy neutral field is not trusted.',
 metrics:['Three-way Brier sum (not divided by 3)','Three-way log loss','Per-market binary Brier/log loss','Calibration by probability band'],
 uncertainty:'Paired metric-difference percentile intervals from 2000 bootstrap samples of whole match days; per-market Wilson intervals are binomial approximations.',
 selectionBias:'No best parameters or market selection are chosen from evaluation outcomes. Raw model diagnostics do not validate the 50/50 blend or accumulator selection.',
 acceptance:'Report paired comparison and coverage without forcing a passing result. No empirical win-rate guarantee, ROI claim or deployment decision is produced.',
 odds:'Historical contemporaneous Betano odds are not supplied: no valid accumulator hit-rate or profitability backtest.',
 productionWrites:false
};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
if(flags.has('--protocol-only')){console.log(JSON.stringify({protocol:path.join(out,'protocol.json'),inputRows:rows.length}));process.exit(0);}

const {fitNationalStrength,predictNationalStrength}=await import('../production/bigodds-strength.mjs');
const lisbonDate=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
function dayCutoff(t){
 const date=lisbonDate(t),utcEight=Date.parse(date+'T08:00:00Z');
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',hour:'numeric',hourCycle:'h23'}).format(utcEight));
 return utcEight-(hour-8)*HOUR;
}
// The replacement applies only to the local research copy. Preserve source
// clocks separately and never reuse these reconstructed rows for publishing.
const eventRows=rows.map(r=>({...r,finished:true,ts:r.kickoff,originalSettledAt:r.settled_at,
 settled_at:r.kickoff+2*HOUR,updated_at:r.kickoff+2*HOUR}));
const targets=eventRows.filter(r=>r.league===5&&r.kickoff>=Date.parse('2024-01-01T00:00:00Z'));
const predictions=[],states=new Map();
for(const f of targets){
 const cutoff=dayCutoff(f.kickoff);
 if(cutoff>=f.kickoff)throw new Error('Target is not strictly after daily prediction cutoff');
 if(!states.has(cutoff)){
  const training=eventRows.filter(r=>r.kickoff+2*HOUR<=cutoff);
  const baseline=xgMarketModel(training.filter(r=>r.league===5),cutoff,[]);
  states.set(cutoff,{baseline,candidate:fitNationalStrength(training,cutoff,OPTIONS),trainingCount:training.length});
 }
 const state=states.get(cutoff),old=state.baseline(f),next=predictNationalStrength(state.candidate,f);
 const hasRates=[next.homeGoals,next.awayGoals].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0);
 const candidate=hasRates?scoreProbabilities(next.homeGoals,next.awayGoals):null;
 for(const p of [old.probabilities,candidate].filter(Boolean)){
  if(MARKETS.some(m=>!Number.isFinite(p[m])||p[m]<0||p[m]>1))throw new Error('Invalid model probabilities');
  if(p['1']+p['2']>1+1e-10)throw new Error('Invalid three-way probability mass');
 }
 predictions.push({fixtureId:f.id,date:lisbonDate(f.kickoff),cutoff,kickoff:f.kickoff,home:f.home,away:f.away,
  hg:f.hg,ag:f.ag,phase:f.kickoff<splitAt?'development':'evaluation',
  trainingCount:state.trainingCount,baseline:old.probabilities,candidate,
  candidateEligible:next.quality?.eligible===true,candidateQuality:next.quality,
  candidateSample:{home:next.homeSample,away:next.awaySample,homeWeighted:next.homeWeighted,awayWeighted:next.awayWeighted}});
}
const clamp=p=>Math.max(1e-12,Math.min(1-1e-12,p));
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
function threeway(r,model){
 const p=r[model],v=[p['1'],Math.max(0,1-p['1']-p['2']),p['2']];
 const hit=r.hg>r.ag?0:r.hg===r.ag?1:2;
 return {brier:v.reduce((s,q,i)=>s+(q-Number(i===hit))**2,0),logLoss:-Math.log(clamp(v[hit]))};
}
function binary(r,model,market){
 const p=r[model][market],y=Number(marketHit(market,r.hg,r.ag));
 return {p,y,brier:(p-y)**2,logLoss:-(y*Math.log(clamp(p))+(1-y)*Math.log(clamp(1-p)))};
}
function wilson(wins,n){
 if(!n)return null;
 const z=1.959963984540054,p=wins/n,d=1+z*z/n;
 const center=(p+z*z/(2*n))/d,margin=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;
 return {lower:Math.max(0,center-margin),upper:Math.min(1,center+margin),method:'Wilson95 binomial approximation'};
}
function calibration(records,model,market){
 const edges=[0,.5,.6,.7,.75,.8,.85,.9,1.000000001];
 return edges.slice(0,-1).map((lo,i)=>{
  const hi=edges[i+1],items=records.map(r=>binary(r,model,market)).filter(x=>x.p>=lo&&x.p<hi);
  const n=items.length,wins=items.reduce((s,x)=>s+x.y,0);
  return{lowerInclusive:lo,upperExclusive:Math.min(1,hi),n,wins,meanProbability:mean(items.map(x=>x.p)),hitRate:n?wins/n:null,interval:wilson(wins,n)};
 }).filter(b=>b.n);
}
function directional(records,model){
 const items=records.map(r=>{const market=r[model]['1X']>=r[model].X2?'1X':'X2';return binary(r,model,market);});
 return [.7,.75,.8,.85].map(threshold=>{
  const selected=items.filter(x=>x.p>=threshold),n=selected.length,wins=selected.reduce((s,x)=>s+x.y,0);
  return{threshold,n,wins,meanProbability:mean(selected.map(x=>x.p)),hitRate:n?wins/n:null,interval:wilson(wins,n)};
 });
}
function summarize(records,model){
 const three=records.map(r=>threeway(r,model));
 return{n:records.length,threeway:{brier:mean(three.map(x=>x.brier)),logLoss:mean(three.map(x=>x.logLoss))},
  markets:Object.fromEntries(MARKETS.map(m=>{const xs=records.map(r=>binary(r,model,m));return[m,{n:xs.length,brier:mean(xs.map(x=>x.brier)),logLoss:mean(xs.map(x=>x.logLoss)),calibration:calibration(records,model,m)}];})),
  higherProbabilityDoubleChance:directional(records,model)};
}
function pairedIntervals(records){
 const byDay=new Map();
 for(const r of records){const a=threeway(r,'baseline'),b=threeway(r,'candidate');if(!byDay.has(r.date))byDay.set(r.date,[]);byDay.get(r.date).push({brier:b.brier-a.brier,logLoss:b.logLoss-a.logLoss});}
 const days=[...byDay.values()];
 if(!days.length)return null;
 let seed=20261116;
 const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
 const samples={brier:[],logLoss:[]};
 for(let b=0;b<2000;b++){
  let n=0,bs=0,ls=0;
  for(let i=0;i<days.length;i++){const day=days[Math.floor(random()*days.length)];for(const v of day){n++;bs+=v.brier;ls+=v.logLoss;}}
  samples.brier.push(bs/n);samples.logLoss.push(ls/n);
 }
 const quantile=(xs,q)=>{const a=[...xs].sort((a,b)=>a-b);return a[Math.floor((a.length-1)*q)];};
 const deltas=records.map(r=>{const a=threeway(r,'baseline'),b=threeway(r,'candidate');return{brier:b.brier-a.brier,logLoss:b.logLoss-a.logLoss};});
 return{n:records.length,matchDays:days.length,method:'paired block bootstrap of whole match days; 2000 fixed-seed resamples',negativeMeans:'candidate has lower error',
  ...Object.fromEntries(['brier','logLoss'].map(k=>[k,{difference:mean(deltas.map(x=>x[k])),lower95:quantile(samples[k],.025),upper95:quantile(samples[k],.975)}]))};
}
const phases={};
for(const phase of ['development','evaluation']){
 const all=predictions.filter(r=>r.phase===phase),paired=all.filter(r=>r.candidate),eligible=paired.filter(r=>r.candidateEligible);
 const excluded={};for(const r of all.filter(r=>!r.candidateEligible))for(const reason of r.candidateQuality?.reasons||['unknown_quality'])excluded[reason]=(excluded[reason]||0)+1;
 phases[phase]={targetCount:all.length,pairedCount:paired.length,qualityEligibleCount:eligible.length,excludedReasons:excluded,
  allPaired:{baseline:summarize(paired,'baseline'),candidate:summarize(paired,'candidate'),difference:pairedIntervals(paired)},
  qualityEligiblePaired:{baseline:summarize(eligible,'baseline'),candidate:summarize(eligible,'candidate'),difference:pairedIntervals(eligible)}};
}
function snapshotDiagnostic(file){
 const content=fs.readFileSync(path.resolve(file)),parsed=JSON.parse(content);
 const snapshot=Array.isArray(parsed)?JSON.parse(parsed[0].results[0].data):parsed;
 if(!Array.isArray(snapshot.candidates)||!Number.isFinite(snapshot.cutoff))throw new Error('Invalid decision snapshot');
 // Current-case replay uses REAL observation clocks. It is distinct from the
 // reconstructed event-time history above and cannot overwrite a publication.
 const state=fitNationalStrength(rows,snapshot.cutoff,OPTIONS),cache=new Map(),rejects={};
 const controls={minProbability:.75,minMarketProbability:.70,maxModelMarketDifference:.15,
  minJointProbability:.20,minOdd:8,maxOdd:15,minLegs:5,maxLegs:12,minLegOdd:1.2};
 const side=m=>['1','1X'].includes(m)?'home':['2','X2'].includes(m)?'away':null;
 const candidates=snapshot.candidates.map(c=>{
  if(!cache.has(c.fixtureId)){
   const model=predictNationalStrength(state,{id:c.fixtureId,home:c.home,away:c.away,league:c.league,ts:c.kickoff});
   cache.set(c.fixtureId,{model,p:[model.homeGoals,model.awayGoals].every(Number.isFinite)?scoreProbabilities(model.homeGoals,model.awayGoals):null});
  }
  const {model,p}=cache.get(c.fixtureId),mp=p?.[c.market],market=c.marketProbability;
  const probability=Number.isFinite(mp)&&Number.isFinite(market)?(mp+market)/2:null,reasons=[];
  if(!MARKETS.includes(c.market))reasons.push('unsupported_market');
  if(c.bookmaker!=='Betano'||c.estimated!==false)reasons.push('unverified_price');
  if(!(c.quoteAt<=c.observedAt&&c.observedAt<=snapshot.cutoff&&c.quoteAt>snapshot.cutoff-6*HOUR&&c.kickoff>snapshot.cutoff+60000))reasons.push('expired_or_future_input');
  if(!Number.isFinite(c.referenceAt)||c.referenceAt!==c.quoteAt)reasons.push('incoherent_reference_clock');
  if(model.quality?.eligible!==true)reasons.push('insufficient_model_evidence');
  if(!Number.isFinite(probability)||probability<controls.minProbability)reasons.push('below_probability_minimum');
  if(!Number.isFinite(market)||market<controls.minMarketProbability)reasons.push('below_market_minimum');
  if(!Number.isFinite(mp)||Math.abs(mp-market)>controls.maxModelMarketDifference)reasons.push('model_market_disagreement');
  if(!Number.isFinite(c.odd)||c.odd<controls.minLegOdd)reasons.push('below_price_minimum');
  if(!Number.isFinite(probability)||probability*c.odd<1-1e-12)reasons.push('negative_expected_value');
  if(p&&side(c.market)&&side(c.market)!==(p['1X']>=p.X2?'home':'away'))reasons.push('analytical_direction');
  for(const reason of reasons)rejects[reason]=(rejects[reason]||0)+1;
  return{fixtureId:c.fixtureId,home:c.home,away:c.away,fixture:c.homeName+' - '+c.awayName,market:c.market,
   odd:c.odd,oldModelProbability:c.modelProbability,modelProbability:mp??null,marketProbability:market,
   probability,quality:model.quality,eligible:reasons.length===0,reasons};
 });
 const eligible=candidates.filter(c=>c.eligible),groups=[...Map.groupBy(eligible,c=>c.fixtureId).values()];
 let best=null,visited=0;
 function enumerate(index,selected,odd,p,teams){
  if(++visited>1000000)throw new Error('Snapshot diagnostic enumeration budget exceeded');
  if(odd>controls.maxOdd||selected.length>controls.maxLegs)return;
  if(index===groups.length){
   if(selected.length>=controls.minLegs&&odd>=controls.minOdd&&p>=controls.minJointProbability&&p*odd>=1.03&&(!best||p>best.probability))best={legs:selected,odd,probability:p};
   return;
  }
  enumerate(index+1,selected,odd,p,teams);
  for(const c of groups[index]){
   if(teams.has(c.home)||teams.has(c.away))continue;
   enumerate(index+1,[...selected,c],odd*c.odd,p*c.probability,new Set([...teams,c.home,c.away]));
  }
 }
 enumerate(0,[],1,1,new Set());
 return{sourceSha256:sha(content),sourceExportSha256:snapshot.sourceExportSha256??null,
  sourceDecisionKey:snapshot.sourceDecisionKey??null,cutoff:snapshot.cutoff,usesRealImportClocks:true,controls,
  meaning:'Independent sensitivity diagnostic; fixed risk controls, not calibrated bounds; no production publication.',
  rejects,candidateCount:candidates.length,eligibleCandidates:eligible,eligibleFixtureCount:groups.length,
  ticket:best,allCandidates:candidates,
  structuralFeasibilityExample:{synthetic:true,legs:8,modelProbability:.89,marketProbability:.75,
   blendedProbability:.82,odd:1.3,totalOdd:1.3**8,jointProbability:.82**8,
   note:'Demonstrates mathematical compatibility of guards only. These are not real selections or claimed odds.'}};
}
const snapshot=flags.has('--snapshot')?snapshotDiagnostic(flags.get('--snapshot')):null;
const report={protocol,generatedAt:new Date().toISOString(),
 sourceCode:{baselineSha256:sha(fs.readFileSync(path.join(ROOT,'production/tests/fixtures/bigodds-model-before.mjs'))),candidateSha256:sha(fs.readFileSync(path.join(ROOT,'production/bigodds-strength.mjs'))),scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url)))},
 phases,snapshot,
 interpretation:{calibrated:false,prospective:false,profitabilityDemonstrated:false,accumulatorHitRateValidated:false,
  limitations:['Retrospective event-time reconstruction; incomplete early history and real import-time availability cannot be established.',
   'No historical odds supplied; evaluates raw national-team model, not 50/50 Betano blend or complete ticket rules.',
   'Only one available Nations League evaluation period; teams and match days are dependent.',
   'Fixed conservative sample/recency policy is not a statistical confidence interval.',
   'Model probability calibration requires continued monitoring; a lower average error does not validate every probability band.']}};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(out,'predictions.json'),JSON.stringify(predictions,null,2)+'\n');
console.log(JSON.stringify({output:out,coverage:protocol.source,
 development:{...phases.development.allPaired.difference,qualityEligible:phases.development.qualityEligibleCount},
 evaluation:{baseline:phases.evaluation.allPaired.baseline.threeway,candidate:phases.evaluation.allPaired.candidate.threeway,
  ...phases.evaluation.allPaired.difference,qualityEligible:phases.evaluation.qualityEligibleCount},
 snapshot:snapshot?{candidateCount:snapshot.candidateCount,eligibleFixtureCount:snapshot.eligibleFixtureCount,ticket:snapshot.ticket}:null},null,2));
