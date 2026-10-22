import {api,forecastWindow} from '../legacy-worker.mjs';
import {auditFields} from './coverage.mjs';
const HOUR=3600000;
const setState=(db,key,value)=>db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(value)).run();
export async function collectContext(env,now=Date.now()){
 if(env.PREDICTION_CONTEXT_MODE!=='live')return {status:'disabled'};
 const db=env.DB,stamp=await db.prepare("SELECT data FROM openfoot_state WHERE key='context_collection'").first();
 if(stamp&&now-JSON.parse(stamp.data).at<60000)return {status:'throttled'};
 const until=now+120000;
 if(!await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('context',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(until,now).first())return {status:'locked'};
 const summary={at:now,status:'ok',requests:0,saved:0,errors:[]};
 summary.auditAt=stamp?JSON.parse(stamp.data).auditAt||0:0;
 let lastRequest=0;
 async function request(path,ttl,paging=false){
  if(summary.requests>=10)throw Error('context_run_budget');
  const row=await db.prepare('SELECT data,expires FROM cache WHERE key=?').bind('api:'+path).first();
  if(row&&row.expires>now){
   try{const p=JSON.parse(row.data);if(Array.isArray(p.items)&&Number.isFinite(p.fetchedAt)&&p.fetchedAt<=now)return {data:p.items,fetchedAt:p.fetchedAt,paging:p.paging};}catch{}
  }
  const cooldown=await db.prepare("SELECT until FROM locks WHERE key='api-cooldown'").first();
  if(cooldown?.until>Date.now())throw Error('context_rate_limit_cooldown');
  const day=new Date(now).toISOString().slice(0,10);
  if(!await db.prepare('INSERT INTO openfoot_context_quota(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 WHERE n<1500 RETURNING n').bind(day).first())throw Error('context_daily_budget');
  summary.requests++;
  const wait=1500-(Date.now()-lastRequest);if(wait>0)await new Promise(r=>setTimeout(r,wait));lastRequest=Date.now();
  const r=await api(env,path,ttl,true,paging);
  if(r.refreshFailed||r.stale||!Number.isFinite(r.fetchedAt)||r.fetchedAt>now+60000)throw Error('context_source_stale');
  return r;
 }
 async function save(f,kind,data,sourceAt){
  const at=Date.now();if(at>=f.ts||sourceAt>at)throw Error('context_after_kickoff');
  const old=await db.prepare('SELECT source_at,data FROM openfoot_context_sources WHERE fixture_id=? AND kind=? AND kickoff=? ORDER BY observed_at DESC LIMIT 1').bind(f.id,kind,f.ts).first();
  const json=JSON.stringify(data);
  if(old&&old.source_at===sourceAt&&old.data===json)return;
  await db.prepare('INSERT OR IGNORE INTO openfoot_context_sources(fixture_id,kind,observed_at,kickoff,source_at,data) VALUES(?,?,?,?,?,?)').bind(f.id,kind,at,f.ts,sourceAt,json).run();summary.saved++;
 }
 try{
  const auditNext=stamp?JSON.parse(stamp.data).auditNext||0:0,league=[39,140,78,135,61][Math.floor(auditNext/2)%5],kind=auditNext%2===0?'statistics':'players';
  summary.auditNext=auditNext;
  const past=await db.prepare("SELECT data FROM fixtures WHERE finished=1 AND league=? AND json_extract(data,'$.status')='FT' ORDER BY kickoff DESC LIMIT 1").bind(league).first();
  if(past&&now-summary.auditAt>24*HOUR){
   summary.auditAt=now;
   const f=JSON.parse(past.data),exists=await db.prepare('SELECT 1 FROM openfoot_coverage_audit WHERE league=? AND fixture_id=? AND kind=? LIMIT 1').bind(league,f.id,kind).first();
   if(!exists)try{
    const r=await request('fixtures/'+kind+'?fixture='+f.id,30*24*HOUR);
    if(r.data.some(row=>![f.home,f.away].includes(row.team?.id)))throw Error('context_audit_identity_mismatch');
    const report=auditFields(kind,r.data);
    await db.prepare('INSERT OR IGNORE INTO openfoot_coverage_audit(league,fixture_id,kind,observed_at,data) VALUES(?,?,?,?,?)').bind(league,f.id,kind,Date.now(),JSON.stringify({...report,source:'API-Football',sourceAt:r.fetchedAt})).run();
    summary.auditNext++;
   }catch(e){summary.errors.push({fixtureId:f.id,kind:'coverage-'+kind,code:e.code||e.message||'source_unavailable'});summary.auditNext++;}
   else summary.auditNext++;
  }
  const fixtures=(await db.prepare('SELECT data FROM fixtures WHERE finished=0 AND kickoff>? AND kickoff<? ORDER BY kickoff LIMIT 150').bind(now,forecastWindow(now).end).all()).results.map(r=>JSON.parse(r.data)).filter(f=>f.status==='NS');
  const next=stamp?JSON.parse(stamp.data).next||0:0,start=fixtures.length?next%fixtures.length:0;
  const rotated=[...fixtures.slice(start),...fixtures.slice(0,start)];
  summary.next=start;
  collection:for(const f of rotated.slice(0,3)){
   summary.next++;
   const jobs=[
    ['injuries',async()=>{const r=await request('injuries?fixture='+f.id,4*HOUR);await save(f,'injuries',r.data.filter(r=>r.fixture?.id===f.id&&[f.home,f.away].includes(r.team?.id)),r.fetchedAt);}],
   ];
   if(f.ts-now<3*HOUR)jobs.unshift(['lineups',async()=>{const r=await request('fixtures/lineups?fixture='+f.id,15*60000);await save(f,'lineups',r.data.filter(r=>[f.home,f.away].includes(r.team?.id)),r.fetchedAt);}]);
   for(const [kind,job] of jobs){
    if(Date.now()-now>8000)break;
    try{await job();}catch(e){const code=e.code||(/^(context_|players_)/.test(e.message)?e.message:'source_unavailable');summary.errors.push({fixtureId:f.id,kind,code});if(/rate_limit|daily_budget/.test(code)){summary.status='degraded';break collection;}}
    if(summary.requests>=10)break;
   }
   if(summary.requests>=10||Date.now()-now>8000)break;
  }
 }catch{summary.status='unavailable';}
 finally{await setState(db,'context_collection',summary);await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='context' AND until=?").bind(until).run();}
 return summary;
}

export async function contextSources(db,f,now){
 const rows=await db.prepare('SELECT kind,observed_at,source_at,data FROM openfoot_context_sources WHERE fixture_id=? AND kickoff=? AND observed_at<=? ORDER BY observed_at DESC').bind(f.id,f.ts,now).all();
 const out={};
 for(const r of rows.results)if(!out[r.kind]&&r.observed_at<f.ts&&r.source_at<=now&&now-r.source_at<=((r.kind.startsWith('players:')?48:r.kind==='lineups'?1:12)*HOUR))out[r.kind]={data:JSON.parse(r.data),observedAt:r.observed_at,sourceAt:r.source_at};
 return out;
}
