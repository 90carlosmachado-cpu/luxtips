import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BIGODDS_POLICY,analyzeTicketExact,scoreProbabilities,xgMarketModel,goalModel} from '../bigodds-model.mjs';
import {scoreProbabilities as oldScore,xgMarketModel as oldModel,goalModel as oldGoal} from './fixtures/bigodds-model-before.mjs';
import {generateBigOdds,publishBigOdds,syncBigOdds,settleBigOdds,bigOddsFeed,dailySlot} from '../bigodds.mjs';
const NOW=Date.parse('2026-11-14T08:00:00Z'),DAY=86400000;
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE fixtures(id INTEGER PRIMARY KEY,league INTEGER NOT NULL,kickoff INTEGER NOT NULL,finished INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE results(fixture_id INTEGER PRIMARY KEY,hg INTEGER NOT NULL,ag INTEGER NOT NULL,settled_at INTEGER NOT NULL);
 CREATE TABLE openfoot_state(key TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE openfoot_market_quotes(fixture_id INTEGER,kickoff INTEGER,bookmaker TEXT,market TEXT,selection TEXT,odd REAL,provider_at INTEGER,observed_at INTEGER);
 CREATE TABLE openfoot_match_details(fixture_id INTEGER,league INTEGER,kickoff INTEGER,observed_at INTEGER,data TEXT);
 CREATE TABLE bigodds_tickets(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,policy TEXT NOT NULL,status TEXT NOT NULL,closed_at INTEGER,odd REAL NOT NULL CHECK(odd>=8 AND odd<=15.000000001),bookmaker TEXT NOT NULL,data TEXT NOT NULL);
 CREATE UNIQUE INDEX one_active ON bigodds_tickets(status) WHERE status='active';
 CREATE TABLE bigodds_legs(fixture_id INTEGER PRIMARY KEY,ticket_id TEXT REFERENCES bigodds_tickets(id),kickoff INTEGER,snapshot TEXT,status TEXT DEFAULT 'pending',settled_at INTEGER,result TEXT);
 CREATE TABLE bigodds_ticket_legs(fixture_id INTEGER,ticket_id TEXT REFERENCES bigodds_tickets(id),kickoff INTEGER,snapshot TEXT,status TEXT DEFAULT 'pending',settled_at INTEGER,result TEXT,PRIMARY KEY(ticket_id,fixture_id));
 CREATE VIEW bigodds_all_legs AS SELECT *, 'legacy' storage FROM bigodds_legs UNION ALL SELECT *, 'ticket' storage FROM bigodds_ticket_legs;
 CREATE TRIGGER ticket_immutable BEFORE UPDATE OF id,created_at,policy,odd,bookmaker,data ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable');END;
 CREATE TRIGGER ticket_no_delete BEFORE DELETE ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable');END;
 CREATE TRIGGER leg_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable');END;
 CREATE TRIGGER leg_no_delete BEFORE DELETE ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable');END;`);
 const prepare=q=>{const s=sql.prepare(q);let args=[];return{bind(...a){args=a;return this;},async all(){return{results:s.all(...args)};},async first(){return s.get(...args)??null;},async run(){return{meta:{changes:s.run(...args).changes}};}};}; 
 const db={prepare,async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const store=f=>sql.prepare('INSERT OR REPLACE INTO fixtures VALUES(?,?,?,?,?,?)').run(f.id,f.league,f.ts,+f.finished,JSON.stringify(f),NOW-1000);
 const f=id=>({id,league:39,season:2026,ts:NOW+DAY+id*1000,home:100+id,away:10000+id,homeName:'H'+id,awayName:'A'+id,competition:'League',status:'NS',finished:false,hg:null,ag:null});
 const seed=(n=8)=>{for(let i=1;i<=n;i++){const g=f(i);store(g);for(const [selection,odd]of [['Over 1.5',1.6],['Under 1.5',2.4]])sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(i,g.ts,'Betano','Goals Over/Under',selection,odd,NOW-1000,NOW-500);}};
 const ticket=(n=5)=>{const legs=Array.from({length:n},(_,i)=>{const g=f(i+1);store(g);return{fixtureId:g.id,home:g.home,away:g.away,kickoff:g.ts,market:'O15',label:'Mais de 1,5 golos',odd:1.6,bookmaker:'Betano',probability:.8,quoteAt:NOW-1000,observedAt:NOW-500,estimated:false};});return{legs,odd:1.6**n,bookmaker:'Betano'};};
 return{sql,db,store,f,seed,ticket,env:{DB:db,LEAGUES:'39'}};
}
test('production generation invokes exact optimizer, publishes and freezes candidate evidence',async()=>{
 const s=setup();s.seed();const r=await generateBigOdds(s.env,NOW,()=>NOW+1000);assert.equal(r.status,'published');
 const feed=await bigOddsFeed(s.db,null,NOW+1000),t=feed.current;
 assert.equal(t.policy.id,'bigodds-exact-ev-betano-v4');assert.equal(t.legs.length,5);assert.ok(t.odd>=8&&t.odd<=15);assert.ok(t.expectedNetPerUnit>=.03);assert.equal(t.optimization.optimalityProved,true);
 assert.ok(t.legs.every(l=>l.probability*l.odd>=1));const audit=JSON.parse(s.sql.prepare("SELECT data FROM openfoot_state WHERE key='bigodds:last_selection'").get().data);assert.equal(audit.status,'optimal');assert.ok(audit.candidateCount>=8);assert.ok(s.sql.prepare('SELECT data FROM openfoot_state WHERE key=?').get(audit.decisionId));
});
test('publisher independently rejects individually negative value and invalid probabilities',async()=>{
 for(const kind of ['negative','nan','infinite','above_one','estimated','duplicate_team']){const s=setup(),t=s.ticket();if(kind==='negative')t.legs[0].probability=.6;if(kind==='nan')t.legs[0].probability=NaN;if(kind==='infinite')t.legs[0].odd=Infinity;if(kind==='above_one')t.legs[0].probability=1.1;if(kind==='estimated')t.legs[0].estimated=true;if(kind==='duplicate_team')t.legs[0].home=t.legs[1].away;
 if(kind==='infinite')await assert.rejects(publishBigOdds(s.db,t,NOW),/invalid_bigodds_legs/);else{const result=await publishBigOdds(s.db,t,NOW);assert.notEqual(result.status,'published',kind);}assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);}
});
test('publisher requires ticket EV >=3% even when each leg is nonnegative',async()=>{const s=setup(),t=s.ticket();t.legs.forEach(l=>l.probability=1/l.odd);assert.equal((await publishBigOdds(s.db,t,NOW)).status,'insufficient_expected_value');});
test('published snapshot is immutable; one active ticket and atomic rollback preserved',async()=>{const s=setup(),t=s.ticket();assert.equal((await publishBigOdds(s.db,t,NOW)).status,'published');assert.equal((await publishBigOdds(s.db,t,NOW)).status,'blocked_or_inputs_changed');assert.throws(()=>s.sql.exec("UPDATE bigodds_tickets SET data='{}'"),/immutable/);assert.throws(()=>s.sql.exec('DELETE FROM bigodds_tickets'),/immutable/);
 const z=setup(),zt=z.ticket();z.sql.exec("CREATE TRIGGER fail BEFORE INSERT ON bigodds_ticket_legs WHEN NEW.fixture_id=3 BEGIN SELECT RAISE(ABORT,'failure');END");await assert.rejects(publishBigOdds(z.db,zt,NOW),/failure/);assert.equal(z.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);
});
test('no eligible ticket freezes rejections and never fills remaining slots with negative EV',async()=>{const s=setup();s.seed(4);const r=await generateBigOdds(s.env,NOW,()=>NOW);assert.equal(r.status,'no_eligible_ticket');const d=JSON.parse(s.sql.prepare("SELECT data FROM openfoot_state WHERE key='bigodds:last_selection'").get().data);assert.equal(d.fixtureCount,4);assert.equal((await bigOddsFeed(s.db,null,NOW)).summary.tickets,0);});
test('manual rebuild consumes exactly once; reset hides old history and permits fixture reuse',async()=>{
 const s=setup();s.seed();const old=await generateBigOdds(s.env,NOW,()=>NOW);assert.equal(old.status,'published');const original=s.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old.id).data;
 const reset=NOW+1000;s.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:history_reset',?)").run(JSON.stringify({startAt:reset}));
 s.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:manual_rebuild',?)").run(JSON.stringify({id:'authorized-reset',policy:BIGODDS_POLICY.id,requestedAt:reset,expires:reset+300000}));
 const out=await syncBigOdds(s.env,reset,()=>reset,reset);assert.equal(out.status,'published');assert.equal(out.manual,true);assert.notEqual(out.id,old.id);
 const feed=await bigOddsFeed(s.db,null,reset);assert.equal(feed.summary.tickets,1);assert.equal(feed.summary.lost,0);assert.equal(feed.history.length,1);assert.equal(feed.current.id,out.id);assert.equal(s.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old.id).data,original);
 const count=s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n;assert.equal((await syncBigOdds(s.env,reset+60000,()=>reset+60000)).status,'outside_daily_window');assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,count);
});
test('daily 08h slot and active ticket suppression retained',async()=>{const s=setup();s.seed();const out=await syncBigOdds(s.env,NOW,()=>NOW+2000,NOW);assert.equal(out.status,'published');assert.equal((await syncBigOdds(s.env,NOW+60000,()=>NOW+60000,NOW)).status,'daily_slot_consumed');assert.equal(dailySlot(NOW+15*60000,NOW),null);assert.equal((await syncBigOdds(s.env,NOW+DAY,()=>NOW+DAY,NOW+DAY)).status,'skipped_active');});
test('analytical direction is filtered before exact optimization',()=>{const s=setup(),t=s.ticket(),c=t.legs.map(l=>({...l,probabilities:{O15:.8}}));const a={...c[0],fixtureId:99,home:999,away:888,market:'X2',probability:.9,modelProbabilities:{'1X':.7,X2:.6}};const out=analyzeTicketExact([...c,a],NOW);assert.equal(out.rejections.analytical_direction,1);assert.ok(out.ticket.legs.every(l=>l.fixtureId!==99));});
test('model probabilities are unchanged for random score rates and historical models',()=>{for(let i=0;i<50;i++)assert.deepEqual(scoreProbabilities(.15+i*.11,4.5-i*.07),oldScore(.15+i*.11,4.5-i*.07));const h=Array.from({length:30},(_,i)=>({id:i+1,league:39,home:1+i%3,away:4+i%3,hg:i%5,ag:i%3,kickoff:NOW-(i+2)*DAY,settled_at:NOW-(i+1)*DAY}));for(let i=0;i<3;i++){const f={id:101+i,league:39,home:1+i,away:4+i};assert.deepEqual(xgMarketModel(h,NOW)(f),oldModel(h,NOW)(f));assert.deepEqual(goalModel(h,NOW)(f),oldGoal(h,NOW)(f));}});
test('settlement and GET feed remain independent and read-only',async()=>{const s=setup(),t=s.ticket();await publishBigOdds(s.db,t,NOW);const f={...s.f(1),hg:0,ag:0,finished:true,status:'FT'};s.store(f);s.sql.prepare('INSERT INTO results VALUES(?,?,?,?)').run(1,0,0,NOW+2*DAY);await settleBigOdds(s.db,NOW+2*DAY);const before=s.sql.prepare('SELECT total_changes() n').get().n;const feed=await bigOddsFeed(s.db,null,NOW+2*DAY);assert.equal(feed.summary.lost,1);assert.equal(feed.current,null);assert.equal(s.sql.prepare('SELECT total_changes() n').get().n,before);});
