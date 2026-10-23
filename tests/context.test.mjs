import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarFeatures,normalizePlayers,availabilityFeatures,marketReference} from '../src/context/features.mjs';
import {contextPrediction,selectionAssessment,CONTEXT_VERSION} from '../src/context/model.mjs';
import {bookmakerQuotes,refreshContextForecasts} from '../src/context/refresh.mjs';
import {fit2,predict2,applyPricing} from '../src/legacy-worker.mjs';
import {enrichPrediction} from '../src/openfoot/live.mjs';
import {testDatabase} from './sqlite.mjs';
import {predictionEnvironment} from '../src/context/environment.mjs';
const now=Date.now(),day=86400000;
const fixture={id:999,league:39,season:2026,ts:now+day,home:1,away:2,homeName:'A',awayName:'B',finished:false,status:'NS'};
const history=Array.from({length:40},(_,i)=>({id:i+1,league:39,ts:now-(i+1)*5*day,home:1,away:2,hg:2,ag:1,finished:true,status:'FT',homeName:'A',awayName:'B'}));
test('context calendar excludes future, unfinished and duplicate fixtures',()=>{
 const rows=[history[0],history[0],{...history[0],id:77,ts:now+1000},{...history[0],id:78,finished:false}];
 const c=calendarFeatures(rows,fixture,1,now);
 assert.equal(c.matches7,1);assert.equal(c.restDays,6);assert.equal(c.completeCalendar,false);
});
test('player statistics require exact club and league and preserve unknown contributions',()=>{
 const row={player:{id:10,name:'P'},statistics:[{team:{id:1},league:{id:39},games:{minutes:900,appearences:10,position:'Attacker'},goals:{total:4,assists:null}}]};
 assert.equal(normalizePlayers([row],1,39)[0].assists,null);
 assert.deepEqual(normalizePlayers([row],2,39),[]);
 assert.deepEqual(normalizePlayers([{...row,statistics:[...row.statistics,...row.statistics]}],1,39),[]);
});
test('confirmed XI overrides conflicting injury reports; duplicate absences do not multiply losses',()=>{
 const injury={fixture:{id:fixture.id},team:{id:1},player:{id:10,name:'P',type:'Missing Fixture',reason:'Injury'}};
 const lineup=[{team:{id:1},formation:'4-4-2',startXI:Array.from({length:11},(_,i)=>({player:{id:i+10}}))}];
 const x=availabilityFeatures([injury,injury],lineup,[],fixture,1);
 assert.equal(x.confirmed,true);assert.equal(x.absent.length,0);assert.deepEqual(x.conflicts,[10]);assert.equal(x.attackLoss,null);
 const y=availabilityFeatures([injury,injury],[],[],fixture,1);
 assert.equal(y.absent.length,1);assert.equal(y.missingImpactPlayers,1);assert.equal(y.attackLoss,null);
 assert.equal(availabilityFeatures(null,[],[],fixture,1).known,false);
});
test('market reference removes margin within complete bookmaker/timestamp groups only',()=>{
 const quotes=['H','D','A'].map((selection,i)=>({fixtureId:999,bookmaker:'B',market:'1X2',selection,odd:[2,3,4][i],providerAt:now-1000,observedAt:now}));
 const x=marketReference(quotes,fixture,now);
 assert.ok(Math.abs(Object.values(x.probabilities).reduce((a,b)=>a+b,0)-1)<1e-12);
 assert.ok(Math.abs(x.probabilities.H-6/13)<1e-12);
 assert.equal(marketReference(quotes.map((q,i)=>({...q,bookmaker:String(i)})),fixture,now).status,'unavailable');
 assert.equal(marketReference(quotes.map(q=>({...q,observedAt:now+1})),fixture,now).status,'unavailable');
});
test('context preserves xG mixture, rejects post-cutoff sources and never mutates input',()=>{
 const base=predict2(fit2(history,now),fixture),obs=history.map(f=>({fixtureId:f.id,league:39,kickoff:f.ts,observedAt:now-1000,result:{home:2,away:1},homeXg:3,awayXg:.2}));
 const xg=enrichPrediction(history,obs,fixture,base,now),before=structuredClone(xg);
 const p=contextPrediction(history,fixture,xg,{injuries:{observedAt:now+1,sourceAt:now,data:[]}},[],now);
 assert.deepEqual(xg,before);assert.deepEqual(p.components,xg.components);
 assert.ok(Math.abs(p.probabilities.H-xg.probabilities.H)<1e-12);
 assert.equal(p.contextAdjustment.home.known,false);assert.equal(p.version,CONTEXT_VERSION);
 assert.equal(contextPrediction(history,{...fixture,ts:now},xg,{},[],now),xg);
});
test('live pricing rejects negative EV and excessive model disagreement even with an odd above 1.25',()=>{
 const g={fixture,sourceUpdatedAt:now,prediction:{sample:20,cutoff:now,probabilities:{H:.7,D:.2,A:.1},contextAdjustment:{uncertainty:{spread:{H:.08,D:.04,A:.04}}}},odds:{H:{fixtureId:999,bookmaker:"Book",odd:1.5,at:now-1000,observedAt:now,source:"API-Football",verifiedReceipt:true,market:"H",selection:"H"}},winnerTip:{market:'H',probability:.7}};
 assert.equal(selectionAssessment(g,now).eligible,false);
 assert.equal(applyPricing(g,now).winnerTip.priceEligible,false);
 g.odds.H.odd=1.8;
 assert.equal(selectionAssessment(g,now).eligible,true);
 assert.equal(applyPricing(g,now).winnerTip.priceEligible,true);
});
test('quotes retain real bookmaker timestamp and reject another fixture or future prices',()=>{
 const payload={items:[{fixture:{id:999},update:new Date(now-1000).toISOString(),bookmakers:[{name:'B',bets:[{name:'Match Winner',values:[{value:'Home',odd:'1.8'}]}]}]}]};
 assert.equal(bookmakerQuotes(payload,fixture,now)[0].odd,1.8);
 assert.deepEqual(bookmakerQuotes(payload,{...fixture,id:1},now),[]);
 assert.deepEqual(bookmakerQuotes(payload,fixture,now-2000),[]);
});
test('refresh writes prematch forecasts independently of legacy and bulk queues',async()=>{
 const db=testDatabase();
 db.sql.exec(readFileSync(new URL('../migrations/0003_context_live.sql',import.meta.url),'utf8'));
 db.sql.exec(readFileSync(new URL('../migrations/0004_match_details.sql',import.meta.url),'utf8'));
 db.sql.exec('ALTER TABLE fixtures ADD COLUMN updated_at INTEGER;CREATE TABLE forecasts(fixture_id INTEGER,version TEXT,phase TEXT,created_at INTEGER,kickoff INTEGER,data TEXT,UNIQUE(fixture_id,phase,version));');
 for(const f of [...history,fixture])db.sql.prepare('INSERT INTO fixtures(id,league,kickoff,finished,data,updated_at) VALUES(?,?,?,?,?,?)').run(f.id,f.league,f.ts,f.finished?1:0,JSON.stringify(f),now-1000);
 for(const f of history){const observation={fixtureId:f.id,league:39,kickoff:f.ts,observedAt:now-2000,result:{home:f.hg,away:f.ag},homeXg:1.7,awayXg:.9};
  db.sql.prepare('INSERT INTO openfoot_xg(source_id,fixture_id,league,kickoff,observed_at,home_xg,away_xg,data) VALUES(?,?,?,?,?,?,?,?)').run('test-'+f.id,f.id,39,f.ts,now-2000,1.7,.9,JSON.stringify(observation));}
 db.sql.exec('CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);');
 db.sql.exec(readFileSync(new URL('../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));
 db.sql.prepare('INSERT INTO openfoot_state VALUES(?,?)').run('bulk_import',JSON.stringify({at:now,status:'running'}));
 const r=await refreshContextForecasts({DB:db,PREDICTION_CONTEXT_MODE:'live',OPENFOOT_MODE:'live',LEAGUES:'39'},now);
 assert.equal(r.status,'ok');assert.equal(r.forecasts,1);assert.equal(r.publicationHeld,false);
 const data=JSON.parse(db.sql.prepare("SELECT data FROM cache WHERE key='forecast:999'").get().data);
 assert.equal(data.prediction.version,CONTEXT_VERSION);
 assert.equal(data.prediction.strengthAdjustment.prior,4);
 assert.equal(data.prediction.xgEnrichment.prior,4);
 const wrapped=predictionEnvironment({DB:db,PREDICTION_CONTEXT_MODE:'live',OPENFOOT_MODE:'live'});
 const legacyPath=await wrapped.__openfootEnrich(history,fixture,predict2(fit2(history,now),fixture),now);
 assert.deepEqual(legacyPath.probabilities,data.prediction.probabilities);
 assert.equal(legacyPath.strengthAdjustment.prior,4);
 assert.equal(data.evaluation.validAtCapture,true);
 assert.equal(data.sourceUpdatedAt,now-1000);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_context_forecasts WHERE created_at<kickoff').get().n,1);
 assert.throws(()=>db.sql.exec("DELETE FROM openfoot_context_forecasts"),/immutable/);
 const again=await refreshContextForecasts({DB:db,PREDICTION_CONTEXT_MODE:'live'},now);
 assert.equal(again.status,'throttled');

 db.sql.prepare('UPDATE openfoot_state SET data=? WHERE key=?').run(JSON.stringify({at:now,status:'complete'}),'bulk_import');
 const resumed=await refreshContextForecasts({DB:db,PREDICTION_CONTEXT_MODE:'live',OPENFOOT_MODE:'live',LEAGUES:'39'},now,{force:true});
 assert.equal(resumed.status,'ok');assert.equal(resumed.publicationHeld,false);
 assert.equal(db.sql.prepare("SELECT until FROM openfoot_locks WHERE key='context_refresh'").get().until,0);
 assert.equal(JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='context_refresh'").get().data).status,'ok');
 const oldForecasts=db.sql.prepare('SELECT * FROM openfoot_context_forecasts ORDER BY created_at').all();
 db.sql.prepare('INSERT INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data) VALUES(?,?,?,?,?,?,?,?,?)').run('2026-10-23',fixture.id,fixture.ts,'H',0,now-500,now,0,JSON.stringify(data));
 const publicationBefore=db.sql.prepare('SELECT * FROM openfoot_pick_revisions').all();
 const staleCache={...data,prediction:{...data.prediction,xgEnrichment:{active:false,status:'insufficient_xg'}}};
 db.sql.prepare("UPDATE cache SET data=? WHERE key='forecast:999'").run(JSON.stringify(staleCache));
 const moved={...fixture,ts:fixture.ts+6*3600000};
 db.sql.prepare('UPDATE fixtures SET kickoff=?,data=? WHERE id=?').run(moved.ts,JSON.stringify(moved),fixture.id);
 const movedRefresh=await refreshContextForecasts({DB:db,PREDICTION_CONTEXT_MODE:'live',OPENFOOT_MODE:'live',LEAGUES:'39'},now,{force:true});
 assert.equal(movedRefresh.forecasts,1);
 const movedCache=JSON.parse(db.sql.prepare("SELECT data FROM cache WHERE key='forecast:999'").get().data);
 assert.equal(movedCache.fixture.ts,moved.ts);assert.equal(movedCache.selectionContract,'selection-inputs-v2');
 assert.equal(movedCache.prediction.xgEnrichment.active,true);
 assert.deepEqual(db.sql.prepare('SELECT * FROM openfoot_pick_revisions').all(),publicationBefore);
 for(const old of oldForecasts)assert.deepEqual(db.sql.prepare('SELECT * FROM openfoot_context_forecasts WHERE fixture_id=? AND kickoff=? AND created_at=?').get(old.fixture_id,old.kickoff,old.created_at),old);
 // Team changes remain an explicit identity exclusion, never a reschedule.
 const changed={...moved,away:9999};db.sql.prepare('UPDATE fixtures SET data=? WHERE id=?').run(JSON.stringify(changed),fixture.id);
 const rejected=await refreshContextForecasts({DB:db,PREDICTION_CONTEXT_MODE:'live',OPENFOOT_MODE:'live',LEAGUES:'39'},now,{force:true});
 assert.equal(rejected.forecasts,0);assert.ok(rejected.failures.some(f=>f.reason==='fixture_identity_changed'));
 assert.equal(JSON.parse(db.sql.prepare("SELECT data FROM cache WHERE key='forecast:999'").get().data).fixture.away,fixture.away);
});
