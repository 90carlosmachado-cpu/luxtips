import {MARKETS,POLICY} from './policy.mjs';
import {CONTEXT_VERSION} from './model.mjs';
import {outcome} from '../legacy-worker.mjs';
export const EVALUATION_POLICY='first-valid-final24h-v1';
const CONTRACT='prospective-inputs-v1',DAY=86400000;
const maximum=values=>values.length?Math.max(...values):0;
export function evaluationRecord(g,history,historySources,sources,details,recordedAt,inputHash){
 const cutoff=g.prediction.cutoff;
 const used=history.filter(f=>f.league===g.fixture.league&&f.finished&&f.ts+7200000<cutoff&&f.ts>cutoff-3*365*DAY);
 const probabilities=Object.fromEntries([...MARKETS,'D','HA'].map(k=>[k,used.length?used.reduce((n,f)=>n+outcome(k,f.hg,f.ag),0)/used.length:null]));
 const clocks={fixture:g.sourceUpdatedAt,history:maximum(historySources.map(r=>r.updated_at)),
  context:maximum(Object.values(sources).flatMap(s=>[s.observedAt,s.sourceAt])),
  detail:maximum(details.filter(d=>d.league===g.fixture.league).map(d=>d.observedAt)),
  xg:g.prediction.xgEnrichment?.active?g.prediction.xgEnrichment.observedAtMax:0};
 const known=historySources.length===history.length&&historySources.length>0&&Object.values(clocks).every(t=>Number.isFinite(t)&&t<=cutoff)&&
  (!g.prediction.xgEnrichment?.active||typeof g.prediction.xgEnrichment.inputDigest==='string');
 return {contract:CONTRACT,policy:EVALUATION_POLICY,recordedAt,cutoff,inputHash,clocks,historyCount:used.length,
  marketReference:g.prediction.contextAdjustment?.market??null,
  validAtCapture:known&&Number.isFinite(cutoff)&&cutoff<=recordedAt&&recordedAt<g.fixture.ts,
  reference:{version:'league-event-frequency-v1',cutoff,n:used.length,probabilities},
  rule:'Earliest valid recorded forecast in the final 24h; one per fixture/kickoff/version. Published picks use their immutable publication snapshot.'};
}
function valid(row,version){
 const g=row.data,f=g?.fixture,c=row.current,e=g?.evaluation,p=g?.prediction;
 return p?.version===version&&e?.contract===CONTRACT&&e.policy===EVALUATION_POLICY&&e.validAtCapture===true&&
  Number.isFinite(row.createdAt)&&Number.isFinite(e.cutoff)&&row.createdAt<f.ts&&row.createdAt===e.recordedAt&&e.cutoff===p.cutoff&&e.cutoff<=row.createdAt&&f.status==='NS'&&!f.finished&&
  /^[0-9a-f]{64}$/.test(e.inputHash)&&Object.values(e.clocks||{}).length===5&&Object.values(e.clocks).every(t=>Number.isFinite(t)&&t<=e.cutoff)&&
  Object.values(g.odds||{}).every(q=>q.source==='API-Football'&&q.verifiedReceipt===true&&Number.isFinite(q.at)&&Number.isFinite(q.observedAt)&&q.at<=q.observedAt&&q.observedAt<=row.createdAt)&&
  c?.id===f.id&&c.ts===f.ts&&c.home===f.home&&c.away===f.away&&c.finished===true&&c.status==='FT'&&
  Number.isInteger(c.hg)&&c.hg>=0&&Number.isInteger(c.ag)&&c.ag>=0&&['H','D','A'].every(k=>Number.isFinite(p.probabilities?.[k])&&p.probabilities[k]>=0&&p.probabilities[k]<=1)&&Math.abs(p.probabilities.H+p.probabilities.D+p.probabilities.A-1)<1e-6;
}
function accumulator(){return {n:0,brier:0,logLoss:0,bins:Array.from({length:10},(_,i)=>({low:i/10,high:(i+1)/10,n:0,sumPrediction:0,hits:0}))};}
function add(a,p,y){a.n++;a.brier+=(p-y)**2;const q=Math.min(1-1e-15,Math.max(1e-15,p));a.logLoss-=y*Math.log(q)+(1-y)*Math.log(1-q);const bin=a.bins[Math.min(9,Math.floor(p*10))];bin.n++;bin.sumPrediction+=p;bin.hits+=y;}
function finish(a){return {n:a.n,brier:a.n?a.brier/a.n:null,logLoss:a.n?a.logLoss/a.n:null,
 calibration:{bins:a.bins.map(b=>({low:b.low,high:b.high,n:b.n,meanPrediction:b.n?b.sumPrediction/b.n:null,observedFrequency:b.n?b.hits/b.n:null})),ece:a.n?a.bins.reduce((n,b)=>n+(b.n?Math.abs(b.sumPrediction-b.hits):0),0)/a.n:null}};}
function groups(){return {byMarket:{},byCompetitionMarket:{}};}
function contribute(scope,market,league,p,reference,y){
 for(const [container,key] of [[scope.byMarket,market],[scope.byCompetitionMarket,league+':'+market]]){
  container[key]??={model:accumulator(),pairedModel:accumulator(),reference:accumulator(),pairedN:0};const group=container[key];add(group.model,p,y);
  // Comparison always uses the identical scored observations, never a different sample.
  if(Number.isFinite(reference)&&reference>=0&&reference<=1){add(group.pairedModel,p,y);add(group.reference,reference,y);group.pairedN++;}
 }
}
function finishGroups(scope){for(const container of Object.values(scope))for(const [key,g] of Object.entries(container))container[key]={model:finish(g.model),comparison:{n:g.pairedN,model:finish(g.pairedModel),reference:finish(g.reference),complete:g.pairedN===g.model.n}};return scope;}
function referenceFor(g,market){const r=g.evaluation.reference;return r?.version==='league-event-frequency-v1'&&r.cutoff===g.evaluation.cutoff&&r.n>0?r.probabilities?.[market]:null;}
export function evaluateRows(rows,published,version=CONTEXT_VERSION){
 const all=groups(),marketComparison=groups(),picks=groups(),seen=new Set(),seenPublished=new Set(),excluded={invalidForecast:0,wrongVersion:0,outsideEvaluationHorizon:0,missingPublishedContract:0};
 let fixtures=0,publishedCount=0,roiN=0,net=0;
 for(const row of [...rows].sort((a,b)=>a.createdAt-b.createdAt||a.data.fixture.id-b.data.fixture.id)){
  if(row.data.prediction?.version!==version){excluded.wrongVersion++;continue;}
  if(!valid(row,version)){excluded.invalidForecast++;continue;}
  const g=row.data,key=[g.fixture.id,g.fixture.ts,version].join(':');
  if(row.createdAt<g.fixture.ts-DAY){excluded.outsideEvaluationHorizon++;continue;}
  if(seen.has(key))continue;seen.add(key);fixtures++;
  for(const market of [...MARKETS,'D']){const p=g.prediction.probabilities[market],reference=referenceFor(g,market);if(Number.isFinite(p)&&p>=0&&p<=1){
    const y=outcome(market,row.current.hg,row.current.ag);contribute(all,market,g.fixture.league,p,reference,y);
    const r=g.evaluation.marketReference,q=r?.probabilities?.[market];
    if(r?.status==='available'&&r.books>0&&Number.isFinite(r.at)&&Number.isFinite(r.observedAt)&&r.at<=r.observedAt&&r.observedAt<=g.evaluation.cutoff&&g.evaluation.cutoff-r.at<POLICY.oddsMaxAge&&Number.isFinite(q)&&q>=0&&q<=1)contribute(marketComparison,market,g.fixture.league,p,q,y);
   }}
 }
 for(const row of [...published].sort((a,b)=>a.publishedAt-b.publishedAt)){
  const g=row.data,key=[g.fixture.id,g.fixture.ts,g.prediction?.version].join(':');
  if(g.prediction?.version!==version){excluded.wrongVersion++;continue;}
  if(seenPublished.has(key))continue;seenPublished.add(key);
  if(!valid(row,version)||!Number.isFinite(row.publishedAt)||row.createdAt>row.publishedAt||row.publishedAt>=g.fixture.ts){excluded.missingPublishedContract++;continue;}
  const tip=g.displayTip||g.winnerTip,market=tip?.market,p=g.prediction.probabilities[market];
  if(![...MARKETS,'D'].includes(market)||!Number.isFinite(p)||p<0||p>1)continue;
  const y=outcome(market,row.current.hg,row.current.ag);publishedCount++;
  contribute(picks,market,g.fixture.league,p,referenceFor(g,market),y);
  const q=g.odds?.[market];
  if(q?.source==='API-Football'&&q.verifiedReceipt===true&&q.fixtureId===g.fixture.id&&q.market===market&&q.selection===market&&Number.isFinite(q.odd)&&Number.isFinite(q.observedAt)&&Number.isFinite(q.at)&&q.at<=q.observedAt&&q.observedAt<=row.publishedAt&&row.publishedAt-q.at<POLICY.oddsMaxAge&&q.odd>=1.25&&tip.odd===q.odd&&tip.bookmaker===q.bookmaker){roiN++;net+=y?q.odd-1:-1;}
 }
 return {version,policy:EVALUATION_POLICY,contract:CONTRACT,allForecasts:{fixtures,...finishGroups(all)},marketComparison:finishGroups(marketComparison),publishedSelections:{fixtures:publishedCount,...finishGroups(picks)},
  roi:{n:roiN,netUnits:roiN?net:null,returnPerUnit:roiN?net/roiN:null,kind:'theoretical-one-unit-at-recorded-price',executedBets:null},excluded,
  notes:['Binary Brier and binary Log Loss per market; calibration in 10 fixed bins with sample counts.','Reference is the observed league event frequency, recorded with the forecast; it never changes public recommendations.','No retrospective reconstruction or threshold tuning; old versions and unverified source clocks are excluded.']};
}
export async function currentEvaluation(db){
 const rows=await db.prepare(`SELECT p.data,p.created_at,f.data current FROM openfoot_context_forecasts p JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff
  WHERE p.version=? AND json_extract(p.data,'$.evaluation.policy')=? AND f.finished=1 AND p.created_at>=p.kickoff-86400000 AND json_extract(p.data,'$.evaluation.validAtCapture')=1
  AND p.created_at=(SELECT MIN(p2.created_at) FROM openfoot_context_forecasts p2 WHERE p2.fixture_id=p.fixture_id AND p2.kickoff=p.kickoff AND p2.version=p.version AND json_extract(p2.data,'$.evaluation.policy')=json_extract(p.data,'$.evaluation.policy') AND p2.created_at>=p2.kickoff-86400000 AND json_extract(p2.data,'$.evaluation.validAtCapture')=1)
  ORDER BY p.kickoff DESC LIMIT 2000`).bind(CONTEXT_VERSION,EVALUATION_POLICY).all();
 const picks=await db.prepare(`SELECT p.data,p.published_at,f.data current FROM (
  SELECT fixture_id,kickoff,published_at,data FROM published_picks UNION ALL SELECT fixture_id,kickoff,published_at,data FROM openfoot_pick_revisions
  UNION ALL SELECT fixture_id,kickoff,published_at,data FROM published_alternatives UNION ALL SELECT fixture_id,kickoff,published_at,data FROM openfoot_alternative_revisions
 ) p JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff WHERE f.finished=1 ORDER BY p.published_at DESC LIMIT 2000`).all();
 return {...evaluateRows(rows.results.map(r=>({data:JSON.parse(r.data),createdAt:r.created_at,current:JSON.parse(r.current)})),picks.results.map(r=>{const data=JSON.parse(r.data);return {data,createdAt:data.evaluation?.recordedAt,publishedAt:r.published_at,current:JSON.parse(r.current)};})),scope:'most recent 2000 settled fixtures / 2000 publications; FT only'};
}
export async function updateEvaluation(db,now){
 const key='evaluation_summary:'+CONTEXT_VERSION;
 const old=await db.prepare('SELECT data FROM openfoot_state WHERE key=?').bind(key).first();
 if(old&&now-JSON.parse(old.data).at<DAY)return {status:'cached'};
 const evaluation=await currentEvaluation(db);
 await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify({at:now,evaluation})).run();
 return {status:'updated',at:now};
}
