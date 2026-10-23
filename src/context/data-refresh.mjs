import {collectFixtureOdds} from './odds.mjs';
import {updateEvaluation} from './evaluation.mjs';
import {api,normalize,forecastWindow} from '../legacy-worker.mjs';
const HOUR=3600000;
export async function refreshData(env,now=Date.now(),options={}){
 const db=env.DB,old=await db.prepare("SELECT data FROM openfoot_state WHERE key='data_refresh'").first(),previous=old?JSON.parse(old.data):{};
 if(!options.force&&now-(previous.at||0)<30000)return {status:'throttled'};
 const token=now+90000;
 if(!await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('data_refresh',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(token,now).first())return {status:'locked'};
 const summary={at:now,status:'ok',next:previous.next||0,requests:0,saved:0,lastCompletedAt:previous.lastCompletedAt||null,lastSuccessAt:previous.lastSuccessAt||(previous.status==='ok'?previous.at:null)};
 try{
  const leagues=String(env.LEAGUES).split(',').map(Number),w=forecastWindow(now);
  const upcoming=(await db.prepare("SELECT data FROM fixtures WHERE finished=0 AND kickoff>? AND kickoff<? ORDER BY kickoff").bind(now,w.end).all()).results.map(r=>JSON.parse(r.data));
  const season=new Date(now).getUTCFullYear()-(new Date(now).getUTCMonth()<6?1:0);
  const jobs=[...leagues.map(league=>({kind:'fixtures',path:'fixtures?league='+league+'&season='+season+'&from='+w.days[0]+'&to='+w.days.at(-1),ttl:HOUR})),
   ...upcoming.filter(f=>f.status==='NS'&&leagues.includes(f.league)).map(f=>({kind:'odds',id:f.id,fixture:f})),
   ...leagues.flatMap(league=>[season,season-1,season-2].map(year=>({kind:'history',path:'fixtures?league='+league+'&season='+year,ttl:year===season?6*HOUR:30*24*HOUR})))];
  const continuation=previous.wasContinuation?null:await db.prepare("SELECT f.data fixture_data FROM fixtures f JOIN openfoot_state s ON s.key='odds_collection:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? AND json_extract(s.data,'$.nextPage')>1 AND json_extract(s.data,'$.nextAt')<=? ORDER BY f.kickoff LIMIT 1").bind(now,w.end,now).first();
  const index=summary.next%jobs.length,continuationFixture=continuation?JSON.parse(continuation.fixture_data):null;
  const job=continuationFixture?{kind:'odds',id:continuationFixture.id,fixture:continuationFixture}:jobs[index];
  summary.wasContinuation=!!continuationFixture;summary.job=job;summary.total=jobs.length;
  if(job.kind==='odds'){
   const result=await collectFixtureOdds(env,job.fixture,now);
   summary.oddsStatus=result.status;
   if(result.status==='temporary_failure')throw Object.assign(Error('source_refresh_failed'),{code:'source_refresh_failed'});
   summary.saved=Object.keys(result.odds).length;summary.records=result.records;
  }else{
   const result=await api(env,job.path,job.ttl,!!options.force);
   if(result.refreshFailed||result.stale)throw Object.assign(Error('source_refresh_failed'),{code:'source_refresh_failed'});
   const rows=result.data.map(normalize).filter(f=>f&&leagues.includes(f.league));
   for(let start=0;start<rows.length;start+=50)await db.batch(rows.slice(start,start+50).map(f=>db.prepare('INSERT INTO fixtures(id,league,kickoff,finished,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET league=excluded.league,kickoff=excluded.kickoff,finished=excluded.finished,data=excluded.data,updated_at=excluded.updated_at WHERE fixtures.updated_at<=excluded.updated_at').bind(f.id,f.league,f.ts,f.finished?1:0,JSON.stringify(f),result.fetchedAt)));
   summary.saved=rows.length;
  }
  summary.next=summary.wasContinuation?index:(index+1)%jobs.length;summary.completedCycle=!summary.wasContinuation&&summary.next===0;
  if(summary.completedCycle)summary.lastCompletedAt=Date.now();
  const settlement=await db.prepare(`INSERT INTO results(fixture_id,hg,ag,settled_at)
   SELECT f.id,json_extract(f.data,'$.hg'),json_extract(f.data,'$.ag'),? FROM
   (SELECT DISTINCT fixture_id FROM forecasts) p JOIN fixtures f ON f.id=p.fixture_id
   LEFT JOIN results r ON r.fixture_id=f.id WHERE f.finished=1 AND
   (r.fixture_id IS NULL OR r.hg<>json_extract(f.data,'$.hg') OR r.ag<>json_extract(f.data,'$.ag'))
   ON CONFLICT(fixture_id) DO UPDATE SET hg=excluded.hg,ag=excluded.ag,settled_at=excluded.settled_at`).bind(Date.now()).run();
  if(settlement.meta?.changes)try{summary.evaluation=await updateEvaluation(db,now);}catch{summary.evaluation={status:'pending'};}
 }catch(e){
  summary.status='degraded';summary.code=e.code||'source_unavailable';if(e.detail)summary.detail=e.detail;
  // An unavailable endpoint must not starve the other leagues and odds jobs.
  // Shared rate/budget waits retain the cursor; individual failures retry next cycle.
  if(summary.total&&!summary.wasContinuation&&!/rate_limit|daily_budget/.test(summary.code))summary.next=(summary.next+1)%summary.total;
 }
 finally{
  if(summary.status==='ok')summary.lastSuccessAt=Date.now();
  await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind('data_refresh',JSON.stringify(summary)).run();
  await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='data_refresh' AND until=?").bind(token).run();
 }
 return summary;
}
