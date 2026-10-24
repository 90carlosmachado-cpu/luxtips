import {informationSnapshot} from '../lux/information-snapshot.mjs';
import {INFORMATION_EXPERIMENT,validateInformationCapture,evaluateInformationRows} from '../lux/information-evaluation.mjs';
import {CONTEXT_VERSION} from './model.mjs';
const DAY=86400000;
export function informationWindow(env,fixture,now){return env.INFORMATION_COMPARISON_MODE==='shadow'&&[39,140,78,135,61].includes(fixture?.league)&&fixture.status==='NS'&&!fixture.finished&&fixture.ts>now&&fixture.ts-now<=DAY;}
export function informationCaptureNeeded(env,original,fixture,now){
 if(!informationWindow(env,fixture,now))return false;
 const a=original?.evaluation?.informationComparison;
 return a?.experiment!==INFORMATION_EXPERIMENT||original.fixture?.ts!==fixture.ts||original.prediction?.version!==CONTEXT_VERSION;
}
export async function prepareInformationComparison(env,g,history,historySources,recordedAt){
 if(env.INFORMATION_COMPARISON_MODE!=='shadow')return {status:'disabled'};
 if(!informationWindow(env,g.fixture,recordedAt))return {status:'outside_scope'};
 try{
  // SELECT before adding a new capture: the immutable context ledger is also
  // the experiment store. No schema or separate production write is required.
  const existing=await env.DB.prepare(`SELECT data,created_at FROM openfoot_context_forecasts WHERE fixture_id=? AND kickoff=? AND version=?
   AND json_extract(data,'$.evaluation.informationComparison.experiment')=? AND json_extract(data,'$.evaluation.informationComparison.status')='recorded'
   ORDER BY created_at LIMIT 10`).bind(g.fixture.id,g.fixture.ts,CONTEXT_VERSION,INFORMATION_EXPERIMENT).all();
  let informationSeen=false,priceSeen=false;
  for(const r of existing.results){try{const row={data:JSON.parse(r.data),createdAt:r.created_at},v=await validateInformationCapture(row,CONTEXT_VERSION);if(v.valid){informationSeen=true;if(v.snapshot.candidate.priceState==='ready')priceSeen=true;}}catch{}}
  if(informationSeen&&priceSeen)return {experiment:INFORMATION_EXPERIMENT,status:'already_recorded'};
  const snapshot=await informationSnapshot(g,history,historySources,recordedAt,'asymmetric6');
  if(informationSeen&&snapshot.candidate.priceState!=='ready')return {experiment:INFORMATION_EXPERIMENT,status:'awaiting_price'};
  return {experiment:INFORMATION_EXPERIMENT,status:'recorded',snapshot};
 }catch{return {experiment:INFORMATION_EXPERIMENT,status:'capture_failed',reason:'capture_contract_or_storage_unavailable'};}
}
export async function currentInformationComparison(db,{limit=500,now=Date.now()}={}){
 if(!Number.isInteger(limit)||limit<1||limit>2000)throw Error('invalid_comparison_limit');
 const rows=await db.prepare(`WITH selected AS (
  SELECT fixture_id,kickoff FROM openfoot_context_forecasts WHERE version=?
   AND json_extract(data,'$.evaluation.informationComparison.experiment')=? AND json_extract(data,'$.evaluation.informationComparison.status')='recorded'
   GROUP BY fixture_id,kickoff ORDER BY kickoff DESC,fixture_id LIMIT ?)
 SELECT p.data,p.created_at,f.data current FROM openfoot_context_forecasts p JOIN selected s ON s.fixture_id=p.fixture_id AND s.kickoff=p.kickoff
 JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff WHERE p.version=?
 AND json_extract(p.data,'$.evaluation.informationComparison.experiment')=? AND json_extract(p.data,'$.evaluation.informationComparison.status')='recorded'
 ORDER BY p.created_at`).bind(CONTEXT_VERSION,INFORMATION_EXPERIMENT,limit,CONTEXT_VERSION,INFORMATION_EXPERIMENT).all();
 const parsed=rows.results.map(r=>{try{return {data:JSON.parse(r.data),createdAt:r.created_at,current:JSON.parse(r.current)};}catch{return {data:null,createdAt:r.created_at,current:null};}});
 return {...await evaluateInformationRows(parsed,CONTEXT_VERSION,{now}),scope:{maximumFixtures:limit,storedSnapshots:rows.results.length},readOnly:true};
}
