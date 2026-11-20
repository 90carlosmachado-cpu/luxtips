import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BIGODDS_POLICY,analyzeTicketExact,scoreProbabilities,xgMarketModel,goalModel} from '../bigodds-model.mjs';
import {scoreProbabilities as oldScore,xgMarketModel as oldModel,goalModel as oldGoal} from './fixtures/bigodds-model-before.mjs';
import {generateBigOdds,publishBigOdds,syncBigOdds,settleBigOdds,bigOddsFeed,dailySlot} from '../bigodds.mjs';
import {optimizeBigOdds} from '../bigodds-optimizer.mjs';
import {qualityLeg,seedClubCandidate,TEST_TICKET_LEGS,TEST_LEG_ODD} from './bigodds-quality-fixtures.mjs';
const NOW=Date.parse('2026-11-14T08:00:00Z'),DAY=86400000;
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE fixtures(id INTEGER PRIMARY KEY,league INTEGER NOT NULL,kickoff INTEGER NOT NULL,finished INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE results(fixture_id INTEGER PRIMARY KEY,hg INTEGER NOT NULL,ag INTEGER NOT NULL,settled_at INTEGER NOT NULL);
 CREATE TABLE openfoot_state(key TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE openfoot_market_quotes(fixture_id INTEGER,kickoff INTEGER,bookmaker TEXT,market TEXT,selection TEXT,odd REAL,provider_at INTEGER,observed_at INTEGER);
 CREATE TABLE openfoot_match_details(fixture_id INTEGER,league INTEGER,kickoff INTEGER,observed_at INTEGER,data TEXT);`);
 for(const name of ['0010_bigodds.sql','0011_bigodds_withdrawn_reuse.sql','0012_bigodds_flexible_limits.sql']){
  sql.exec('BEGIN');try{sql.exec(readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8'));sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}
 }
 const prepare=q=>{const s=sql.prepare(q);let args=[];return{bind(...a){assert.ok(a.length<=100,'D1 parameter limit exceeded');args=a;return this;},async all(){return{results:s.all(...args)};},async first(){return s.get(...args)??null;},async run(){return{meta:{changes:s.run(...args).changes}};}};};
 const db={prepare,async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const store=f=>sql.prepare('INSERT OR REPLACE INTO fixtures VALUES(?,?,?,?,?,?)').run(f.id,f.league,f.ts,+f.finished,JSON.stringify(f),f.updatedAt??(f.finished?f.ts+7200000:NOW-1000));
 const f=id=>({id,league:39,season:2026,ts:NOW+DAY+id*1000,home:100+id,away:10000+id,homeName:'H'+id,awayName:'A'+id,competition:'League',status:'NS',finished:false,hg:null,ag:null});
 const seed=(n=TEST_TICKET_LEGS,options={})=>{for(let i=1;i<=n;i++)seedClubCandidate(sql,store,f(i),NOW,options);};
 const ticket=(n=TEST_TICKET_LEGS)=>{const legs=Array.from({length:n},(_,i)=>{const g=f(i+1);store(g);return qualityLeg(g,NOW);});return{legs,odd:TEST_LEG_ODD**n,bookmaker:'Betano'};};
 return{sql,db,store,f,seed,ticket,env:{DB:db,LEAGUES:'39'}};
}
test('production generation invokes exact optimizer, publishes and freezes candidate evidence',async()=>{
 const s=setup();s.seed();const r=await generateBigOdds(s.env,NOW,()=>NOW+1000);assert.equal(r.status,'published');
 const feed=await bigOddsFeed(s.db,null,NOW+1000),t=feed.current;
 assert.equal(t.policy.id,'bigodes-quality-betano-v6');assert.equal(t.policy.objective,'max_legs_then_probability');assert.equal(t.legs.length,TEST_TICKET_LEGS);assert.ok(t.odd>=2);assert.equal(t.policy.maxLegs,null);assert.equal(t.policy.maxOdd,null);assert.ok(t.jointProbability>=.20);assert.ok(t.expectedNetPerUnit>=.03);assert.equal(t.optimization.optimalityProved,true);
 assert.ok(t.legs.every(l=>l.probability>=.75&&l.marketProbability>=.70&&Math.abs(l.modelProbability-l.marketProbability)<=.15));
 assert.ok(t.legs.every(l=>l.model.evidence.home.games>=8&&l.model.evidence.away.games>=8&&l.model.quality.eligible));
 assert.ok(t.legs.every(l=>l.probability*l.odd>=1));const audit=JSON.parse(s.sql.prepare("SELECT data FROM openfoot_state WHERE key='bigodds:last_selection'").get().data);assert.equal(audit.status,'optimal');assert.ok(audit.candidateCount>=8);assert.ok(s.sql.prepare('SELECT data FROM openfoot_state WHERE key=?').get(audit.decisionId));
});
test('publisher accepts exactly two games at odd two and rejects either minimum being missed',async()=>{
 const s=setup(),t=s.ticket(2);t.legs[0].odd=1.25;t.legs[1].odd=1.6;t.odd=2;
 assert.equal((await publishBigOdds(s.db,t,NOW)).status,'published');
 const stored=JSON.parse(s.sql.prepare('SELECT data FROM bigodds_tickets').get().data);
 assert.equal(stored.legs.length,2);assert.equal(stored.odd,2);assert.equal(stored.policy.maxOdd,null);assert.equal(stored.policy.maxLegs,null);
 for(const kind of ['one_game','below_odd']){
  const z=setup(),candidate=z.ticket(kind==='one_game'?1:2);
  if(kind==='one_game'){candidate.legs[0].odd=2.5;candidate.odd=2.5;}
  else{candidate.legs[0].odd=1.25;candidate.legs[1].odd=1.5992;candidate.odd=1.999;}
  await assert.rejects(publishBigOdds(z.db,candidate,NOW),/invalid_bigodds_ticket/);
  assert.equal(z.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
 }
});
test('publisher and feed handle over twelve games, odds over fifteen and fixed SQL parameter counts',async()=>{
 // This synthetic high-probability contract exercises storage capacity, not calibration.
 const s=setup(),t=s.ticket(101);
 for(const leg of t.legs){leg.probability=.99;leg.probabilities.O15=.99;leg.modelProbability=.995;leg.marketProbability=.985;leg.modelProbabilities.O15=.995;}
 t.odd=t.legs.reduce((p,l)=>p*l.odd,1);
 const result=await publishBigOdds(s.db,t,NOW);assert.equal(result.status,'published');assert.equal(result.legs,101);assert.ok(result.odd>15);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_ticket_legs').get().n,101);
 const before=s.sql.prepare('SELECT total_changes() n').get().n,feed=await bigOddsFeed(s.db,null,NOW);
 assert.equal(feed.current.legs.length,101);assert.equal(feed.current.odd,t.odd);assert.equal(s.sql.prepare('SELECT total_changes() n').get().n,before);
 assert.deepEqual(s.sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('optimizer, publisher and database agree on the exact minimum odd without rounding up',async()=>{
 for(const odd of [1.5999999999997,1.6,1.6000000000003]){
  const s=setup(),t=s.ticket(2);t.legs[0].odd=1.25;t.legs[1].odd=odd;
  const result=analyzeTicketExact(t.legs,NOW),product=1.25*odd;
  if(product<2){
   assert.equal(result.status,'no_eligible_ticket');assert.equal(result.ticket,null);
   // A rounded aggregate must not bypass the minimum of the actual price product.
   t.odd=2;await assert.rejects(publishBigOdds(s.db,t,NOW),/invalid_bigodds_legs/);
   assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
  }else{
   assert.equal(result.status,'optimal');assert.equal(result.ticket.odd,product);
   assert.equal((await publishBigOdds(s.db,result.ticket,NOW)).status,'published');
  }
 }
});
test('publisher independently rejects individually negative value and invalid probabilities',async()=>{
 for(const kind of ['negative','nan','infinite','above_one','estimated','duplicate_team']){const s=setup(),t=s.ticket();if(kind==='negative'){t.legs[0].odd=1.2;t.legs[1].odd=1.45;t.odd=t.legs.reduce((p,l)=>p*l.odd,1);}if(kind==='nan')t.legs[0].probability=NaN;if(kind==='infinite')t.legs[0].odd=Infinity;if(kind==='above_one')t.legs[0].probability=1.1;if(kind==='estimated')t.legs[0].estimated=true;if(kind==='duplicate_team')t.legs[0].home=t.legs[1].away;
 if(kind==='infinite')await assert.rejects(publishBigOdds(s.db,t,NOW),/invalid_bigodds_legs/);else{const result=await publishBigOdds(s.db,t,NOW);assert.notEqual(result.status,'published',kind);if(kind==='negative')assert.equal(result.status,'insufficient_expected_value');}assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);}
});
test('break-even tickets fail joint quality; the optimizer retains its independent 3% EV gate',async()=>{
 const s=setup(),t=s.ticket();
 for(const l of t.legs){l.probability=1/l.odd;l.probabilities.O15=l.probability;l.modelProbability=2*l.probability-l.marketProbability;l.modelProbabilities.O15=l.modelProbability;}
 assert.equal((await publishBigOdds(s.db,t,NOW)).status,'joint_probability_below_minimum');
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
 // The eight-leg proposal misses the joint floor. Isolate the retained EV
 // rule without weakening the publication settings; shorter subsets also need EV.
 const policy={...BIGODDS_POLICY,now:NOW,minJointProbability:0};
 assert.equal(optimizeBigOdds(t.legs,policy).status,'no_eligible_ticket');
 assert.equal(optimizeBigOdds(t.legs,{...policy,minTicketExpectedReturn:0}).status,'optimal');
});
test('published snapshot is immutable; one active ticket and atomic rollback preserved',async()=>{const s=setup(),t=s.ticket();assert.equal((await publishBigOdds(s.db,t,NOW)).status,'published');assert.equal((await publishBigOdds(s.db,t,NOW)).status,'blocked_or_inputs_changed');assert.throws(()=>s.sql.exec("UPDATE bigodds_tickets SET data='{}'"),/immutable/);assert.throws(()=>s.sql.exec('DELETE FROM bigodds_tickets'),/immutable/);
 const z=setup(),zt=z.ticket();z.sql.exec("CREATE TRIGGER fail BEFORE INSERT ON bigodds_ticket_legs WHEN NEW.fixture_id=3 BEGIN SELECT RAISE(ABORT,'failure');END");await assert.rejects(publishBigOdds(z.db,zt,NOW),/failure/);assert.equal(z.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
});
test('JSON fixture matching still rejects changed identities, rescheduling and settled games atomically',async()=>{
 for(const kind of ['identity','kickoff','finished','result']){
  const s=setup(),t=s.ticket(),f=s.f(1);
  if(kind==='identity')s.store({...f,home:99999});
  if(kind==='kickoff')s.store({...f,ts:f.ts+3600000});
  if(kind==='finished')s.store({...f,finished:true,status:'FT',hg:2,ag:1});
  if(kind==='result')s.sql.prepare('INSERT INTO results VALUES(1,2,1,?)').run(NOW);
  assert.equal((await publishBigOdds(s.db,t,NOW)).status,'blocked_or_inputs_changed',kind);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_ticket_legs').get().n,0);
 }
});
test('a ticket below odd two freezes the decision without forcing publication',async()=>{const s=setup();s.seed();s.sql.prepare('DELETE FROM fixtures WHERE id>2 AND id<=?').run(TEST_TICKET_LEGS);const r=await generateBigOdds(s.env,NOW,()=>NOW);assert.equal(r.status,'no_eligible_ticket');const d=JSON.parse(s.sql.prepare("SELECT data FROM openfoot_state WHERE key='bigodds:last_selection'").get().data);assert.equal(d.fixtureCount,2);assert.equal((await bigOddsFeed(s.db,null,NOW)).summary.tickets,0);});
test('empty team history cannot publish even with enough future fixtures and valid paired prices',async()=>{
 const s=setup();s.seed(TEST_TICKET_LEGS,{history:false});
 const r=await generateBigOdds(s.env,NOW,()=>NOW);assert.equal(r.status,'no_eligible_ticket');
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_all_legs').get().n,0);
 const audit=JSON.parse(s.sql.prepare("SELECT data FROM openfoot_state WHERE key='bigodds:last_selection'").get().data);
 assert.equal(audit.fixtureCount,0);assert.ok(audit.rejections.insufficient_model_evidence>=TEST_TICKET_LEGS);
 assert.ok(s.sql.prepare('SELECT data FROM openfoot_state WHERE key=?').get(audit.decisionId));
});
test('manual rebuild consumes exactly once; reset hides old history and permits fixture reuse',async()=>{
 const s=setup();s.seed();const old=await generateBigOdds(s.env,NOW,()=>NOW);assert.equal(old.status,'published');const original=s.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old.id).data;
 const reset=NOW+1000;s.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:history_reset',?)").run(JSON.stringify({startAt:reset}));
 s.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:manual_rebuild',?)").run(JSON.stringify({id:'authorized-reset',policy:BIGODDS_POLICY.id,requestedAt:reset,expires:reset+300000}));
 const out=await syncBigOdds(s.env,reset,()=>reset,reset);assert.equal(out.status,'published');assert.equal(out.manual,true);assert.notEqual(out.id,old.id);
 const feed=await bigOddsFeed(s.db,null,reset);assert.equal(feed.summary.tickets,1);assert.equal(feed.summary.lost,0);assert.equal(feed.history.length,1);assert.equal(feed.current.id,out.id);assert.equal(s.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old.id).data,original);
 const count=s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n;assert.equal((await syncBigOdds(s.env,reset+60000,()=>reset+60000)).status,'outside_daily_window');assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,count);
});
test('daily 08h slot and active ticket suppression retained',async()=>{const s=setup();s.seed();const out=await syncBigOdds(s.env,NOW,()=>NOW+2000,NOW);assert.equal(out.status,'published');assert.equal((await syncBigOdds(s.env,NOW+60000,()=>NOW+60000,NOW)).status,'daily_slot_consumed');assert.equal(dailySlot(NOW+15*60000,NOW),null);assert.equal((await syncBigOdds(s.env,NOW+DAY,()=>NOW+DAY,NOW+DAY)).status,'skipped_active');});
test('analytical direction is filtered before exact optimization',()=>{const s=setup(),t=s.ticket(),c=t.legs;const a={...c[0],fixtureId:99,home:999,away:888,market:'X2',probability:.9,modelProbabilities:{'1X':.7,X2:.6}};const out=analyzeTicketExact([...c,a],NOW);assert.equal(out.rejections.analytical_direction,1);assert.ok(out.ticket.legs.every(l=>l.fixtureId!==99));});
test('model probabilities are unchanged for random score rates and historical models',()=>{for(let i=0;i<50;i++)assert.deepEqual(scoreProbabilities(.15+i*.11,4.5-i*.07),oldScore(.15+i*.11,4.5-i*.07));const h=Array.from({length:30},(_,i)=>({id:i+1,league:39,home:1+i%3,away:4+i%3,hg:i%5,ag:i%3,kickoff:NOW-(i+2)*DAY,settled_at:NOW-(i+1)*DAY}));for(let i=0;i<3;i++){const f={id:101+i,league:39,home:1+i,away:4+i};assert.deepEqual(xgMarketModel(h,NOW)(f),oldModel(h,NOW)(f));assert.deepEqual(goalModel(h,NOW)(f),oldGoal(h,NOW)(f));}});
test('settlement and GET feed remain independent and read-only',async()=>{const s=setup(),t=s.ticket();await publishBigOdds(s.db,t,NOW);const f={...s.f(1),hg:0,ag:0,finished:true,status:'FT'};s.store(f);s.sql.prepare('INSERT INTO results VALUES(?,?,?,?)').run(1,0,0,NOW+2*DAY);await settleBigOdds(s.db,NOW+2*DAY);const before=s.sql.prepare('SELECT total_changes() n').get().n;const feed=await bigOddsFeed(s.db,null,NOW+2*DAY);assert.equal(feed.summary.lost,1);assert.equal(feed.current,null);assert.equal(s.sql.prepare('SELECT total_changes() n').get().n,before);});
