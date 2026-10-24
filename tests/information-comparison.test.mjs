import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {informationSnapshot} from '../src/lux/information-snapshot.mjs';
import {teamInformation,DAY} from '../src/lux/evidence.mjs';
import {evaluateInformationRows,validateInformationCapture,INFORMATION_EXPERIMENT,captureDigest} from '../src/lux/information-evaluation.mjs';
import {prepareInformationComparison,informationCaptureNeeded,currentInformationComparison} from '../src/context/information-comparison.mjs';
import {refreshContextForecasts} from '../src/context/refresh.mjs';
import {CONTEXT_VERSION} from '../src/context/model.mjs';
import {testDatabase} from './sqlite.mjs';
const now=Date.now(),cutoff=now-100;
const history=(awayN=6)=>[...Array.from({length:45},(_,i)=>({id:i+1,league:140,season:2026,ts:now-(i+2)*DAY,home:10,away:101,hg:2,ag:1,status:'FT',finished:true})),...Array.from({length:awayN},(_,i)=>({id:100+i,league:140,season:2026,ts:now-(i+2)*DAY,home:102,away:20,hg:2,ag:1,status:'FT',finished:true}))];
async function captured({id=1001,awayN=6,recordedAt=now,probabilities={H:.7,D:.2,A:.1},odd=1.7,withQuote=true}={}){
 const h=history(awayN),home=teamInformation(h,10,cutoff),away=teamInformation(h,20,cutoff),sources=h.map(f=>({data:JSON.stringify(f),updated_at:now-1000}));
 const fixture={id,league:140,season:2026,ts:now+12*3600000,home:10,away:20,homeName:'Home',awayName:'Away',status:'NS',finished:false};
 const quote={fixtureId:id,bookmaker:'Book',market:'H',selection:'H',source:'API-Football',verifiedReceipt:true,odd,at:now-1000,observedAt:now-1000};
 const game={fixture,sourceUpdatedAt:now-1000,prediction:{version:CONTEXT_VERSION,cutoff,sample:Math.min(home.components[0].weightMass,away.components[0].weightMass),teams:{home:{n:45},away:{n:awayN}},probabilities,contextAdjustment:{uncertainty:{spread:{H:.01,A:.01}},market:{status:'available',books:2,at:now-1000,observedAt:now-1000,probabilities:{H:.65,D:.25,A:.1}}}},odds:withQuote?{H:quote}:{},oddsStatus:withQuote?{}:{H:'quote_expired'},
  evaluation:{contract:'prospective-inputs-v1',validAtCapture:true,cutoff,recordedAt,inputHash:'a'.repeat(64),clocks:{fixture:now-1000,history:now-1000,context:0,detail:0,xg:0}}};
 const snapshot=await informationSnapshot(game,h,sources,recordedAt,'asymmetric6');game.evaluation.informationComparison={experiment:INFORMATION_EXPERIMENT,status:'recorded',snapshot};
 return {row:{data:game,createdAt:recordedAt,current:{...fixture,status:'FT',finished:true,hg:2,ag:0}},h,sources};
}
function database(){const db=testDatabase();db.sql.exec(readFileSync(new URL('../migrations/0003_context_live.sql',import.meta.url),'utf8'));return db;}
test('prospective evaluation keeps the earliest capture and includes recovered losses and real-price theoretical return',async()=>{
 const first=(await captured()).row,later=(await captured({recordedAt:now+1000,probabilities:{H:.9,D:.07,A:.03},odd:1.8})).row,base=(await captured({id:1002,awayN:30})).row;
 base.current={...base.current,hg:0,ag:1};
 const r=await evaluateInformationRows([later,base,first],CONTEXT_VERSION,{now:now+DAY});
 assert.equal(r.settledFixtures,2);assert.equal(r.excluded.later_duplicate,1);assert.equal(r.baseline.information.n,1);assert.equal(r.baseline.information.hits,0);
 assert.equal(r.candidate.information.n,2);assert.equal(r.candidate.information.hits,1);assert.equal(r.recovered.information.n,1);
 assert.equal(r.candidate.priceEligible.theoreticalReturn.n,2);assert.ok(Math.abs(r.candidate.priceEligible.theoreticalReturn.netUnits+.3)<1e-12);
 assert.equal(r.candidate.information.theoreticalReturn.n,0);
 assert.equal(r.candidate.information.marketComparison.n,2);assert.ok(Math.abs(r.allForecasts.brier1X2-.74)<1e-12);
 assert.equal(r.scored.find(x=>x.fixtureId===1001).probability,.7);
});
test('tampered digest, rehashed decisions, source clocks and model versions are rejected',async()=>{
 const row=(await captured()).row;
 assert.equal((await validateInformationCapture(row,CONTEXT_VERSION)).valid,true);
 const tampered=structuredClone(row);tampered.data.evaluation.informationComparison.snapshot.probabilities.H=.8;
 assert.equal((await validateInformationCapture(tampered,CONTEXT_VERSION)).valid,false);
 const rehashed=structuredClone(row),s=rehashed.data.evaluation.informationComparison.snapshot;s.candidate.counterfactualRulesPass=false;s.digest=await captureDigest(s);
 assert.equal((await validateInformationCapture(rehashed,CONTEXT_VERSION)).reason,'inconsistent_decisions');
 const clock=structuredClone(row);clock.data.evaluation.informationComparison.snapshot.sourceClocks.xg=now+1;
 assert.equal((await validateInformationCapture(clock,CONTEXT_VERSION)).reason,'invalid_source_clock');
 assert.equal((await validateInformationCapture(row,'another-model')).reason,'wrong_model_version');
});
test('reschedules, pending games and pre-kickoff settlement cannot generate performance',async()=>{
 const row=(await captured()).row;
 const moved=structuredClone(row);moved.current.ts+=DAY;
 assert.equal((await evaluateInformationRows([moved],CONTEXT_VERSION,{now:now+DAY})).excluded.settlement_identity_mismatch,1);
 const pending=structuredClone(row);pending.current.finished=false;
 assert.equal((await evaluateInformationRows([pending],CONTEXT_VERSION,{now:now+DAY})).settledFixtures,0);
 assert.equal((await evaluateInformationRows([row],CONTEXT_VERSION,{now})).excluded.settlement_before_kickoff,1);
 const nonregulation=structuredClone(row);nonregulation.current.status='AET';
 assert.equal((await evaluateInformationRows([nonregulation],CONTEXT_VERSION,{now:now+DAY})).settledFixtures,0);
});
test('missing market references do not silently change the paired comparison sample',async()=>{
 const {row}=await captured(),s=row.data.evaluation.informationComparison.snapshot;s.marketReference.status='unavailable';s.digest=await captureDigest(s);
 const r=await evaluateInformationRows([row],CONTEXT_VERSION,{now:now+DAY});
 assert.equal(r.candidate.information.n,1);assert.equal(r.candidate.information.marketComparison.n,0);assert.equal(r.candidate.information.marketComparison.model.n,0);
});
test('an expired first quote does not block first valid-price capture or replace the earlier forecast',async()=>{
 const first=(await captured({withQuote:false})).row,later=(await captured({recordedAt:now+1000,probabilities:{H:.75,D:.15,A:.1}})).row;
 const r=await evaluateInformationRows([later,first],CONTEXT_VERSION,{now:now+DAY});
 assert.equal(r.settledFixtures,1);assert.equal(r.priceCaptureFixtures,1);assert.equal(r.candidate.information.meanProbability,.7);assert.equal(r.candidate.priceEligible.meanProbability,.75);
 const db=database();db.sql.prepare('INSERT INTO openfoot_context_forecasts VALUES(?,?,?,?,?)').run(first.data.fixture.id,first.data.fixture.ts,first.createdAt,CONTEXT_VERSION,JSON.stringify(first.data));
 const h=history(),sources=h.map(f=>({data:JSON.stringify(f),updated_at:now-1000})),env={DB:db,INFORMATION_COMPARISON_MODE:'shadow'};
 assert.equal((await prepareInformationComparison(env,first.data,h,sources,now)).status,'awaiting_price');
 assert.equal((await prepareInformationComparison(env,later.data,h,sources,now+1000)).status,'recorded');
});
test('recorder is disabled by default, writes nothing and cannot replace an existing capture',async()=>{
 const {row,h,sources}=await captured(),db=database();
 assert.deepEqual(await prepareInformationComparison({},null,null,null,now),{status:'disabled'});
 const clean=structuredClone(row.data);delete clean.evaluation.informationComparison;
 assert.equal(informationCaptureNeeded({INFORMATION_COMPARISON_MODE:'shadow'},clean,clean.fixture,now),true);
 const first=await prepareInformationComparison({DB:db,INFORMATION_COMPARISON_MODE:'shadow'},clean,h,sources,now);
 assert.equal(first.status,'recorded');assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_context_forecasts').get().n,0);
 clean.evaluation.informationComparison=first;
 db.sql.prepare('INSERT INTO openfoot_context_forecasts VALUES(?,?,?,?,?)').run(clean.fixture.id,clean.fixture.ts,now,CONTEXT_VERSION,JSON.stringify(clean));
 assert.equal((await prepareInformationComparison({DB:db,INFORMATION_COMPARISON_MODE:'shadow'},row.data,h,sources,now+1000)).status,'already_recorded');
 assert.equal(informationCaptureNeeded({INFORMATION_COMPARISON_MODE:'shadow'},clean,clean.fixture,now),false);
 assert.equal(informationCaptureNeeded({},row.data,row.data.fixture,now),false);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_context_forecasts').get().n,1);
});
test('read-only comparison uses immutable captures and settlement identity from SQLite',async()=>{
 const {row}=await captured(),db=database();
 db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?)').run(row.current.id,row.current.league,row.current.ts,1,JSON.stringify(row.current));
 db.sql.prepare('INSERT INTO openfoot_context_forecasts VALUES(?,?,?,?,?)').run(row.current.id,row.current.ts,row.createdAt,CONTEXT_VERSION,JSON.stringify(row.data));
 const before=db.sql.prepare('SELECT data FROM openfoot_context_forecasts').get().data;
 const result=await currentInformationComparison(db,{now:now+DAY});
 assert.equal(result.readOnly,true);assert.equal(result.recovered.information.n,1);assert.equal(db.sql.prepare('SELECT data FROM openfoot_context_forecasts').get().data,before);
 await assert.rejects(currentInformationComparison(db,{limit:0}),/invalid_comparison_limit/);
});
test('capture failure is isolated from publication and makes no recorder writes',async()=>{
 const {row,h,sources}=await captured(),db=database(),g=structuredClone(row.data);g.evaluation.validAtCapture=false;
 const r=await prepareInformationComparison({DB:db,INFORMATION_COMPARISON_MODE:'shadow'},g,h,sources,now);
 assert.equal(r.status,'capture_failed');assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_context_forecasts').get().n,0);
});
test('local live refresh preserves probabilities and selection when passive capture is enabled',async()=>{
 async function setup(){const db=database();db.sql.exec(readFileSync(new URL('../migrations/0004_match_details.sql',import.meta.url),'utf8'));
  db.sql.exec('ALTER TABLE fixtures ADD COLUMN updated_at INTEGER;CREATE TABLE forecasts(fixture_id INTEGER,version TEXT,phase TEXT,created_at INTEGER,kickoff INTEGER,data TEXT,UNIQUE(fixture_id,phase,version));');
  const fixture={id:999,league:140,season:2026,ts:now+12*3600000,home:10,away:20,homeName:'Home',awayName:'Away',finished:false,status:'NS'};
  for(const f of [...history(30),fixture])db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?,?)').run(f.id,f.league,f.ts,f.finished?1:0,JSON.stringify(f),now-1000);
  db.sql.exec('CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);');
  db.sql.exec(readFileSync(new URL('../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));return db;
 }
 const disabled=await setup(),enabled=await setup();
 const env=db=>({DB:db,PREDICTION_CONTEXT_MODE:'live',LEAGUES:'140'});
 const normal=await refreshContextForecasts(env(disabled),now),passive=await refreshContextForecasts({...env(enabled),INFORMATION_COMPARISON_MODE:'shadow'},now);
 assert.equal(normal.status,'ok');assert.equal(passive.status,'ok');assert.equal(normal.forecasts,1);assert.equal(passive.forecasts,1);
 const get=db=>JSON.parse(db.sql.prepare("SELECT data FROM cache WHERE key='forecast:999'").get().data),a=get(disabled),b=get(enabled);
 assert.deepEqual(a.prediction,b.prediction);assert.deepEqual(a.selectionAssessment,b.selectionAssessment);assert.deepEqual(a.winnerTip,b.winnerTip);
 assert.equal(a.evaluation.informationComparison,undefined);assert.equal(b.evaluation.informationComparison.status,'recorded');
 assert.equal((await validateInformationCapture({data:b,createdAt:b.evaluation.recordedAt},CONTEXT_VERSION)).valid,true);
 const again=await refreshContextForecasts({...env(enabled),INFORMATION_COMPARISON_MODE:'shadow'},now,{force:true});
 assert.equal(again.retained,1);assert.equal(enabled.sql.prepare("SELECT COUNT(*) n FROM openfoot_context_forecasts WHERE json_extract(data,'$.evaluation.informationComparison.status')='recorded'").get().n,1);
 // Activating the passive flag must capture an already cached unchanged model.
 const activated=await refreshContextForecasts({...env(disabled),INFORMATION_COMPARISON_MODE:'shadow'},now,{force:true});
 assert.equal(activated.forecasts,1);assert.equal(get(disabled).evaluation.informationComparison.status,'recorded');
 const broken=await setup(),failingDb={...broken,prepare(query){if(query.includes("'$.evaluation.informationComparison.experiment'"))throw Error('unavailable experiment read');return broken.prepare(query);}};
 const isolated=await refreshContextForecasts({...env(failingDb),INFORMATION_COMPARISON_MODE:'shadow'},now);
 assert.equal(isolated.status,'ok');assert.equal(isolated.forecasts,1);assert.equal(get(broken).evaluation.informationComparison.status,'capture_failed');
 assert.deepEqual(get(broken).prediction,a.prediction);assert.deepEqual(get(broken).selectionAssessment,a.selectionAssessment);
});
