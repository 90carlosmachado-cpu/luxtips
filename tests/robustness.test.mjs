import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {testDatabase} from './sqlite.mjs';
import {marketCandidates,publishMarketPicks} from '../src/context/selection.mjs';
import {publishDailyPicks,applyPricing} from '../src/legacy-worker.mjs';
import {CONTEXT_VERSION,selectionAssessment} from '../src/context/model.mjs';
import {collectFixtureOdds,cachedOdds,extractQuotes,selectQuotes} from '../src/context/odds.mjs';
import {evaluationRecord,evaluateRows,currentEvaluation,updateEvaluation} from '../src/context/evaluation.mjs';
import {refreshData} from '../src/context/data-refresh.mjs';
import {refreshContextForecasts} from '../src/context/refresh.mjs';
import worker from '../src/worker.mjs';
import {POLICY,lisbonDay} from '../src/context/policy.mjs';

const now=Date.now(),DAY=86400000;
function database(){
 const db=testDatabase();
 db.sql.exec('ALTER TABLE fixtures ADD COLUMN updated_at INTEGER;CREATE TABLE forecasts(fixture_id INTEGER,version TEXT,phase TEXT,created_at INTEGER,kickoff INTEGER,data TEXT,UNIQUE(fixture_id,phase,version));CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);');
 for(const name of ['0002_publication_archive.sql','0003_context_live.sql','0004_match_details.sql'])db.sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 return db;
}
function game(id,offset=0,p=.8){return {selectionContract:'selection-inputs-v2',fixture:{id,ts:now+offset*DAY+6*3600000,league:39,home:id,away:id+100,homeName:'H'+id,awayName:'A'+id,finished:false,status:'NS'},sourceUpdatedAt:now,updatedAt:now,
 prediction:{version:CONTEXT_VERSION,cutoff:now,sample:20,probabilities:{H:.4,D:.3,A:.3,U35:p},risks:[],contextAdjustment:{uncertainty:{spread:{H:.02,D:.02,A:.02,U35:.01}}}},
 odds:{U35:{source:'API-Football',verifiedReceipt:true,market:'U35',selection:'U35',fixtureId:id,odd:1.4,bookmaker:'Book',at:now-1000,observedAt:now-500}}};}
function store(db,g,forecast=true){const f=g.fixture;db.sql.prepare('INSERT OR REPLACE INTO fixtures VALUES(?,?,?,?,?,?)').run(f.id,f.league,f.ts,0,JSON.stringify(f),now);if(forecast)cache(db,g);}
function cache(db,g){db.sql.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run('forecast:'+g.fixture.id,JSON.stringify(g),g.fixture.ts+DAY);}
function selected(db){return db.sql.prepare('SELECT fixture_id,day,data FROM openfoot_current_picks ORDER BY fixture_id').all();}

test('one pending fixture holds its own day only; a different competition/day can publish',async()=>{
 const db=database(),pending=game(1),tomorrow=game(2,1);tomorrow.fixture.league=135;store(db,pending,false);store(db,tomorrow);
 const r=await publishMarketPicks(db,[tomorrow],now);
 assert.equal(r.days[lisbonDay(pending.fixture.ts)].status,'waiting');assert.equal(r.days[lisbonDay(tomorrow.fixture.ts)].status,'complete');assert.deepEqual(selected(db).map(x=>x.fixture_id),[2]);
 assert.equal(r.days[lisbonDay(pending.fixture.ts)].pending[0].reason,'forecast_pending');db.sql.close();
});
test('days with no fixtures are complete rather than indefinitely updating',async()=>{
 const db=database(),r=await publishMarketPicks(db,[],now);assert.equal(Object.keys(r.days).length,3);assert.ok(Object.values(r.days).every(d=>d.status==='complete'));db.sql.close();
});
test('partial processing waits for the entire day and ranks the stored pool, not the order or subset passed by a caller',async()=>{
 const db=database(),games=[.75,.78,.8,.9,.95].map((p,i)=>game(i+1,0,p));games.forEach((g,i)=>store(db,g,i<3));
 await publishMarketPicks(db,games.slice(0,3),now);assert.equal(selected(db).length,0);
 cache(db,games[4]);await publishMarketPicks(db,[games[4]],now+60000);assert.equal(selected(db).length,0);
 cache(db,games[3]);await publishMarketPicks(db,games.slice(0,2),now+120000);
 assert.deepEqual(selected(db).map(x=>x.fixture_id),[3,4,5]);db.sql.close();
});
test('a fixed 15 minute deadline releases available candidates; missing fixtures remain pending and later recovery only fills vacancies',async()=>{
 const db=database(),a=game(1),b=game(2),c=game(3);store(db,a);store(db,b,false);store(db,c,false);
 await publishMarketPicks(db,[a],now);const key='publication_day:'+lisbonDay(a.fixture.ts);
 const originalDeadline=JSON.parse(db.sql.prepare('SELECT data FROM openfoot_state WHERE key=?').get(key).data).deadline;
 await publishMarketPicks(db,[a],now+POLICY.waitMs-1);assert.equal(selected(db).length,0);
 const partial=await publishMarketPicks(db,[a],now+POLICY.waitMs);assert.equal(partial.days[lisbonDay(a.fixture.ts)].deadline,originalDeadline);assert.equal(selected(db).length,1);
 assert.equal(partial.days[lisbonDay(a.fixture.ts)].pending.length,2);const before=selected(db)[0].data;
 cache(db,b);c.prediction.sample=2;cache(db,c);await publishMarketPicks(db,[c,b,a],now+POLICY.waitMs+1000);
 assert.deepEqual(selected(db).map(x=>x.fixture_id),[1,2]);assert.equal(selected(db)[0].data,before);
 const decisions=JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='publication_decisions'").get().data);
 assert.equal(decisions.decisions.find(x=>x.fixtureId===3).markets.U35,'insufficient_effective_sample');db.sql.close();
});
test('repeated and concurrent publication entry points share a lease and respect three slots, fixture uniqueness and immutable old publications',async()=>{
 const db=database(),games=[1,2,3,4,5].map(id=>game(id));games.forEach(g=>store(db,g));
 const old=game(99);db.sql.prepare('INSERT INTO published_picks VALUES(?,?,?,?,?,?,?,?,?)').run(lisbonDay(old.fixture.ts),99,old.fixture.ts,'U35',1,now-1000,now-1000,0,JSON.stringify(old));
 const before=db.sql.prepare('SELECT data FROM published_picks').get().data;
 await Promise.all([publishMarketPicks(db,games,now),publishDailyPicks(db,[games[4]],now)]);
 await publishDailyPicks(db,games,now+1000);
 assert.equal(selected(db).length,3);assert.equal(new Set(selected(db).map(x=>x.fixture_id)).size,3);assert.equal(db.sql.prepare('SELECT data FROM published_picks').get().data,before);
 db.sql.prepare("UPDATE openfoot_locks SET until=? WHERE key='publication'").run(now-1);await publishMarketPicks(db,games,now+2000);assert.equal(selected(db).length,3);db.sql.close();
});
test('a fixture changed after ranking is rejected atomically by the final publication statement',async()=>{
 const db=database(),g=game(1);store(db,g);const originalPrepare=db.prepare.bind(db);
 db.prepare=query=>{const statement=originalPrepare(query);if(query.includes('INSERT OR IGNORE INTO openfoot_pick_revisions')){const run=statement.run.bind(statement);statement.run=async()=>{db.sql.prepare('UPDATE fixtures SET finished=1 WHERE id=?').run(1);return run();};}return statement;};
 await publishMarketPicks(db,[g],now);assert.equal(selected(db).length,0);
 const decisions=JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='publication_decisions'").get().data);assert.equal(decisions.decisions[0].reason,'publication_conditions_changed');db.sql.close();
});
test('all publication and pricing paths reject insufficient expected return, invalid provenance and missing market-specific divergence',async()=>{
 for(const change of [g=>g.odds.U35.odd=1.25,g=>g.odds.U35.source='derived',g=>g.odds.U35.market='O35',g=>g.odds.U35.observedAt=g.fixture.ts,g=>delete g.prediction.contextAdjustment.uncertainty.spread.U35]){
  const db=database(),g=game(1);change(g);store(db,g);assert.equal(selectionAssessment({...g,displayTip:{market:'U35'}},now).eligible,false);assert.equal(marketCandidates(g,now).length,0);
  assert.equal(applyPricing({...g,displayTip:{market:'U35'}},now).displayTip,undefined);await publishMarketPicks(db,[g],now);await publishDailyPicks(db,[g],now);assert.equal(selected(db).length,0);db.sql.close();
 }
});
test('a failure inside one fixture calculation does not abort another fixture in the batch',async()=>{
 const db=database(),clock=Date.now(),bad=game(1),good=game(2);bad.fixture.ts=clock+DAY;good.fixture.ts=clock+DAY;
 store(db,bad);store(db,good);db.sql.prepare('UPDATE cache SET data=? WHERE key=?').run('{bad','forecast:1');
 const result=await refreshContextForecasts({DB:db,PREDICTION_CONTEXT_MODE:'live',OPENFOOT_MODE:'disabled',LEAGUES:'39'},clock,{force:true});
 assert.equal(result.status,'ok');assert.ok(result.failures.some(x=>x.fixtureId===1));assert.ok(result.forecasts>=1);db.sql.close();
});

function payload(id,at,bets,name='Book'){return [{fixture:{id},update:new Date(at).toISOString(),bookmakers:[{name,bets}]}];}
const winner={name:'Match Winner',values:[{value:'Home',odd:'1.7'}]},goals={name:'Goals Over/Under',values:[{value:'Under 3.5',odd:'1.4'}]};
test('recent partial odds do not suppress the remaining pages; observations retain bookmaker, original price clock and market',async()=>{
 const db=database(),clock=Date.now(),g=game(1);g.fixture.ts=clock+DAY;g.prediction.probabilities.H=.7;store(db,g);
 db.sql.prepare('INSERT INTO cache VALUES(?,?,?)').run('api:odds?fixture=1',JSON.stringify({items:payload(1,clock-5000,[winner]),fetchedAt:clock-1000,paging:{current:1,total:2}}),clock+3*3600000);
 let calls=0;const request=async(_env,path,_ttl,force)=>{calls++;assert.equal(force,true);const page=path.includes('page=2')?2:1;return {data:payload(1,clock-5000,page===1?[winner]:[goals],page===1?'Winner Book':'Goals Book'),fetchedAt:clock,paging:{current:page,total:2}};};
 const first=await collectFixtureOdds({DB:db},g.fixture,clock,request);assert.equal(first.status,'incomplete_response');assert.equal(calls,1);
 await collectFixtureOdds({DB:db},g.fixture,clock+10000,request);assert.equal(calls,1);
 const nextAt=JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='odds_collection:1'").get().data).nextAt;
 await collectFixtureOdds({DB:db},g.fixture,nextAt+1,request);assert.equal(calls,2);
 const prices=await cachedOdds(db,g.fixture,nextAt+1);assert.equal(prices.odds.U35.bookmaker,'Goals Book');assert.equal(prices.odds.U35.providerMarket,'Goals Over/Under');assert.equal(prices.odds.U35.providerSelection,'Under 3.5');assert.equal(prices.odds.U35.at,clock-5000);assert.equal(prices.odds.U35.observedAt,clock);
 assert.ok(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_market_quotes').get().n>=2);db.sql.close();
});
test('missing markets receive one bounded probe then a three hour negative cache, rather than repeated useless requests',async()=>{
 const db=database(),clock=Date.now(),g=game(1);g.fixture.ts=clock+DAY;store(db,g);let calls=0;
 const request=async()=>{calls++;return {data:payload(1,clock,[winner]),fetchedAt:clock,paging:{current:1,total:1}};};
 assert.equal((await collectFixtureOdds({DB:db},g.fixture,clock,request)).status,'incomplete_response');
 for(let i=1;i<15;i++)await collectFixtureOdds({DB:db},g.fixture,clock+i*60000,request);assert.equal(calls,1);
 const retryAt=JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='odds_collection:1'").get().data).nextAt;
 assert.equal((await collectFixtureOdds({DB:db},g.fixture,retryAt+1,request)).status,'market_unavailable');
 await collectFixtureOdds({DB:db},g.fixture,clock+2*3600000,request);assert.equal(calls,2);db.sql.close();
});
test('quotes observed during the request are not mistaken for future quotes relative to the job start time',async()=>{
 const db=database(),clock=Date.now()-100,g=game(1);g.fixture.ts=clock+DAY;store(db,g);
 const result=await collectFixtureOdds({DB:db},g.fixture,clock,async()=>{return {data:payload(1,clock,[goals]),fetchedAt:Date.now(),paging:{current:1,total:1}};});
 assert.equal(result.status,'incomplete_response');assert.ok(result.odds.U35.observedAt>clock);db.sql.close();
});
test('a recently fetched quotation close to expiry is scheduled before the three hour cache and is classified as expired afterwards',async()=>{
 const db=database(),clock=Date.now(),g=game(1);g.fixture.ts=clock+DAY;store(db,g);
 const at=clock-POLICY.oddsMaxAge+60000;
 await collectFixtureOdds({DB:db},g.fixture,clock,async()=>({data:payload(1,at,[goals]),fetchedAt:clock,paging:{current:1,total:1}}));
 const state=JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='odds_collection:1'").get().data);assert.equal(state.nextAt,clock+60000);
 const cached=await cachedOdds(db,g.fixture,clock+60001);assert.equal(cached.statuses.U35,'quote_expired');db.sql.close();
});
test('pending pagination alternates with normal data jobs without adding requests or advancing the normal cursor prematurely',async()=>{
 const db=database(),clock=Date.now(),g=game(1);g.fixture.ts=clock+DAY;store(db,g);
 db.sql.exec('CREATE TABLE results(fixture_id INTEGER PRIMARY KEY,hg INTEGER,ag INTEGER,settled_at INTEGER);CREATE TABLE locks(key TEXT PRIMARY KEY,until INTEGER);CREATE TABLE meta(key TEXT PRIMARY KEY,data TEXT);CREATE TABLE quota(day TEXT PRIMARY KEY,n INTEGER);');
 db.sql.prepare('INSERT INTO openfoot_state VALUES(?,?)').run('odds_collection:1',JSON.stringify({kickoff:g.fixture.ts,nextPage:2,totalPages:2,quotes:[],nextAt:clock-1,status:'incomplete_response'}));
 const calls=[],env={DB:db,LEAGUES:'39',DAILY_BUDGET:'6000',API_FOOTBALL_KEY:'test-secret',FOOTBALL_API_TRANSPORT:'container',FOOTBALL_RELAY:{getByName(){return {async request(path){calls.push(path);return {status:200,headers:{},body:JSON.stringify({errors:[],response:path.startsWith('odds?')?payload(1,clock,[goals]):[],paging:{current:path.includes('page=2')?2:1,total:path.includes('page=2')?2:1}})};}};}}};
 const first=await refreshData(env,clock,{force:true});assert.equal(first.wasContinuation,true);assert.equal(first.next,0);assert.ok(calls[0].includes('page=2'));
 db.sql.prepare("UPDATE locks SET until=0 WHERE key='api-next'").run();
 const second=await refreshData(env,Date.now(),{force:true});assert.equal(second.wasContinuation,false);assert.equal(second.next,1);assert.ok(calls[1].startsWith('fixtures?'));
 await refreshData(env,Date.now(),{force:true});assert.equal(calls.length,2);db.sql.close();
});
test('expired quotations and temporary supplier failure have distinct states, preserve clocks and obey retry waits',async()=>{
 const db=database(),clock=Date.now(),g=game(1);g.fixture.ts=clock+DAY;store(db,g);let calls=0;
 const expired=async()=>{calls++;return {data:payload(1,clock-7*3600000,[goals]),fetchedAt:clock,paging:{current:1,total:1}};};
 assert.equal((await collectFixtureOdds({DB:db},g.fixture,clock,expired)).status,'quote_expired');
 const failure=async()=>{calls++;throw Object.assign(Error('secret-supplier-message'),{code:'rate_limit_cooldown'});};
 assert.equal((await collectFixtureOdds({DB:db},g.fixture,clock+4*3600000,failure)).status,'temporary_failure');
 await collectFixtureOdds({DB:db},g.fixture,clock+4*3600000+1000,failure);assert.equal(calls,2);
 const state=db.sql.prepare("SELECT data FROM openfoot_state WHERE key='odds_collection:1'").get().data;assert.ok(!state.includes('secret-supplier-message'));db.sql.close();
});
test('quote extraction rejects other fixtures, half-time markets, probability-only values and observations after kickoff',()=>{
 const f=game(1).fixture;
 assert.deepEqual(extractQuotes(payload(2,now,[goals]),f,now),[]);
 assert.deepEqual(extractQuotes(payload(1,now,[{...goals,name:'Goals Over/Under - First Half'}]),f,now),[]);
 assert.deepEqual(extractQuotes(payload(1,now,[{name:'Match Winner',values:[{value:'Home',probability:.8}]}]),f,now),[]);
 assert.deepEqual(extractQuotes(payload(1,now,[goals]),f,f.ts),[]);
 const quotes=extractQuotes(payload(1,now-1000,[goals]),f,now);assert.equal(selectQuotes(quotes,now+6*3600000).U35,undefined);
});

function evaluated(id=1,createdAt=now,p=.8){
 const g=game(id);g.prediction.cutoff=createdAt;g.prediction.probabilities.U35=p;g.sourceUpdatedAt=createdAt-1000;
 g.odds.U35.at=createdAt-1000;g.odds.U35.observedAt=createdAt-500;
 const history=Array.from({length:20},(_,i)=>({id:1000+i,league:39,ts:createdAt-(i+1)*DAY,home:1,away:2,hg:1,ag:0,finished:true,status:'FT'}));
 g.evaluation=evaluationRecord(g,history,history.map(f=>({data:JSON.stringify(f),updated_at:createdAt-1000})),{},[],createdAt,'a'.repeat(64));
 return {data:g,createdAt,current:{...g.fixture,finished:true,status:'FT',hg:1,ag:0}};
}
test('evaluation chooses the earliest valid final-24h snapshot, scores each market/competition and separates published forecasts and paired reference',()=>{
 const early=evaluated(1,now,.8),late=evaluated(1,now+3600000,.9),publication={...late,publishedAt:late.createdAt+1000};publication.data.displayTip={market:'U35',odd:1.4,bookmaker:'Book'};
 const report=evaluateRows([late,early],[publication]);
 assert.equal(report.allForecasts.fixtures,1);assert.ok(Math.abs(report.allForecasts.byMarket.U35.model.brier-.04)<1e-12);
 assert.ok(Math.abs(report.publishedSelections.byMarket.U35.model.brier-.01)<1e-12);assert.equal(report.allForecasts.byCompetitionMarket['39:U35'].model.n,1);
 assert.equal(report.allForecasts.byMarket.U35.comparison.n,1);assert.equal(report.allForecasts.byMarket.U35.comparison.reference.brier,0);
 assert.equal(report.allForecasts.byMarket.U35.model.calibration.bins.reduce((n,b)=>n+b.n,0),1);assert.ok(report.allForecasts.byMarket.U35.model.logLoss>0);
 assert.equal(report.roi.n,1);assert.ok(Math.abs(report.roi.returnPerUnit-.4)<1e-12);assert.equal(report.roi.executedBets,null);
});
test('evaluation excludes future source clocks, post-kickoff quotes, old versions, changed fixtures and forecasts outside the fixed horizon',()=>{
 const valid=evaluated();const mutations=[r=>r.createdAt=r.data.fixture.ts,r=>r.data.evaluation.clocks.history=r.data.fixture.ts+1,r=>r.data.odds.U35.observedAt=r.data.fixture.ts+1,r=>r.data.prediction.version='old',r=>r.current.ts++,r=>r.data.evaluation.recordedAt++];
 for(const change of mutations){const row=structuredClone(valid);change(row);const report=evaluateRows([row],[{...row,publishedAt:now+1000}]);assert.equal(report.allForecasts.fixtures,0);assert.equal(report.roi.n,0);}
 const outside=evaluated(2,now-2*DAY);assert.equal(evaluateRows([outside],[]).allForecasts.fixtures,0);
 const futureReference=evaluated();futureReference.data.evaluation.reference.cutoff++;assert.equal(evaluateRows([futureReference],[]).allForecasts.byMarket.U35.comparison.n,0);
});
test('future historical rows never enter the recorded reference and unknown availability disables evaluation without changing a prediction',()=>{
 const g=game(1),history=[{id:1,league:39,ts:now-DAY,hg:1,ag:0,finished:true},{id:2,league:39,ts:now+DAY,hg:0,ag:5,finished:true}];
 const before=structuredClone(g);const e=evaluationRecord(g,history,history.map(()=>({updated_at:now+1000})),{},[],now,'a'.repeat(64));
 assert.equal(e.reference.n,1);assert.equal(e.reference.probabilities.H,1);assert.equal(e.validAtCapture,false);assert.deepEqual(g,before);
});
test('SQL evaluation reads immutable snapshots and raw publication ledgers, including archived publications, rather than mutable caches or latest recalculations',async()=>{
 const db=database(),early=evaluated(1,now,.8),late=evaluated(1,now+1000,.95);
 db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?,?)').run(1,39,early.current.ts,1,JSON.stringify(early.current),now+DAY);
 for(const row of [early,late])db.sql.prepare('INSERT INTO openfoot_context_forecasts VALUES(?,?,?,?,?)').run(1,row.data.fixture.ts,row.createdAt,CONTEXT_VERSION,JSON.stringify(row.data));
 const pub=early.data;pub.displayTip={market:'U35',odd:1.4,bookmaker:'Book'};
 db.sql.prepare('INSERT INTO published_picks VALUES(?,?,?,?,?,?,?,?,?)').run(lisbonDay(pub.fixture.ts),1,pub.fixture.ts,'U35',1,now+100,now+100,0,JSON.stringify(pub));
 db.sql.prepare('INSERT INTO openfoot_publication_archives VALUES(?,?,?,?)').run(lisbonDay(pub.fixture.ts),1,now+200,'archive');
 const report=await currentEvaluation(db);assert.equal(report.allForecasts.fixtures,1);assert.ok(Math.abs(report.allForecasts.byMarket.U35.model.brier-.04)<1e-12);assert.equal(report.publishedSelections.fixtures,1);assert.equal(db.sql.prepare('SELECT count(*) n FROM published_picks').get().n,1);
 assert.equal((await updateEvaluation(db,now+DAY)).status,'updated');assert.equal((await updateEvaluation(db,now+DAY+1000)).status,'cached');assert.equal(db.sql.prepare("SELECT count(*) n FROM openfoot_state WHERE key LIKE 'evaluation_summary:%'").get().n,1);db.sql.close();
});
test('the interface has no obsolete daily-alternative/favorite research and distinguishes updating versus completed days without technical errors',async()=>{
 const response=await worker.fetch(new Request('https://test/'),{},{}),html=await response.text();
 for(const text of ['um mercado alternativo por dia','três favoritos','v.winnerModel','d.modelComparison','${esc(e.message)}'])assert.ok(!html.includes(text),text);
 assert.ok(html.includes('analysisByDay[chosenDay]?.updating'));assert.ok(html.includes('Análise concluída'));assert.ok(html.includes('Análise em atualização'));assert.ok(html.includes('recomendações de vitória por dia'));
 assert.ok(html.includes('winnerCard'));for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Script(script));
 const validation=await worker.fetch(new Request('https://test/api/validation'),{PREDICTION_CONTEXT_MODE:'live'},{});assert.equal((await validation.json()).winnerModel,undefined);
});
test('the actual client renders empty states and hides legacy alternatives from the winner page',async()=>{
 const html=await(await worker.fetch(new Request('https://test/'),{},{})).text();const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 const uiNow=Date.parse(lisbonDay(now)+'T10:00:00Z');
 for(const scenario of ['updating','complete','alternatives']){
  const elements=new Map(),element=()=>({innerHTML:'',textContent:'',value:'',options:[],append(o){this.options.push(o);},addEventListener(){},classList:{toggle(){}},setAttribute(){}});
  const doc={visibilityState:'visible',querySelector(key){if(!elements.has(key))elements.set(key,element());return elements.get(key);},querySelectorAll(){return [];},createElement:element,addEventListener(){}};
  const games=scenario==='alternatives'?[game(1),game(2)].map(g=>({...g,fixture:{...g.fixture,ts:uiNow+3600000},winnerTip:null,published:{at:now,alternative:true},displayTip:{market:'U35',label:'Menos de 3,5 golos',odd:1.4,bookmaker:'Book',probability:.8}})):[];
  class Clock extends Date{constructor(...args){super(...(args.length?args:[uiNow]));}static now(){return uiNow;}}
  await new Script(script).runInNewContext({document:doc,location:{hostname:"luxtips.90carlosmachado.workers.dev"},Date:Clock,AbortSignal,setInterval(){},fetch:async url=>({ok:true,json:async()=>url==='/api/games'?{games,competitions:[],analysis:{days:{[lisbonDay(now)]:{updating:scenario==='updating'}}}}:{ready:true,sync:{at:now,ok:true}}})});
  const cards=elements.get('#cards').innerHTML;
  assert.ok(cards.includes(scenario==='updating'?'Análise em atualização':scenario==='complete'?'Análise concluída':'Análise concluída'),cards);
  if(scenario==='alternatives'){assert.ok(!cards.includes('Menos de 3,5 golos'));assert.equal((cards.match(/class="card/g)||[]).length,0);}
 }
});
