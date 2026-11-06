import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {testDatabase} from './sqlite.mjs';
import {worstReplaceable,replaceDailyPick,freezeAt} from '../daily-ranking.mjs';
import {listDay,reconcileDay,readDailyLists,LIST_VERSION,lisbonClock} from '../daily-list.mjs';
import {syncFootballList,footballCurrentFeed,footballHistoryFeed} from '../football-list.mjs';

// Execute the actual production functions and SQL, without importing Cloudflare's
// platform-only DurableObject module into Node. No model or publisher stubs.
const source=readFileSync(new URL('../production-worker.mjs',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function runtime(clock){
  class ClockDate extends Date {static now(){return clock.now;}}
  const context=vm.createContext({Date:ClockDate,Intl,JSON,Math,Number,Map,Set,Object,Array,Infinity,
    worstReplaceable,replaceDailyPick,__name:x=>x});
  vm.runInContext([
    section('function quoteStatus(','var init_policy'),
    section('function pendingReason(','var init_readiness'),
    section('function forecastWindow(','function quoteFor('),
    section('function marketLabel(','function eligible('),
    section('function marketCandidates(','var MARKET_POLICY, WINNER_MARKETS;'),
    `POLICY={minimumOdd:1.20,oddsMaxAge:21600000,minimumSample:12,minimumExpectedReturn:.03,waitMs:900000};
    MARKETS=['H','A','U35']; const CONTEXT_VERSION='luxtips-events-xg-elo020-live-v4';
    const MARKET_POLICY='winner-1x2-r1-r2-v2',WINNER_MARKETS=['H','A'],DAY2=86400000;
    lisbonDay=ts=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(ts);
    const lisbonDay2=lisbonDay;
    function selectionAssessment(g,now){return assessMarket(g,(g.displayTip||g.winnerTip)?.market,now);}`
  ].join('\n'),context);
  return context;
}
function setup(at='2026-11-05T07:00:00Z'){
  const clock={now:Date.parse(at)},db=testDatabase(),rt=runtime(clock);
  db.sql.function('julianday',value=>clock.now/86400000+2440587.5);
  db.sql.exec(`CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT);
    CREATE TABLE published_alternatives(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);
    CREATE TABLE results(fixture_id INTEGER,hg INTEGER,ag INTEGER);
    CREATE TABLE openfoot_market_quotes(fixture_id INTEGER,kickoff INTEGER,bookmaker TEXT,market TEXT,selection TEXT,odd REAL,provider_at INTEGER,observed_at INTEGER);`);
  db.sql.exec(readFileSync(new URL('../../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));
  function game(id,p,day=listDay(clock.now),league=78){
    const ts=Date.parse(day+'T18:00:00Z');
    return {fixture:{id,ts,home:id,away:id+100,league,status:'NS',finished:false,homeName:'H'+id,awayName:'A'+id},
      sourceUpdatedAt:clock.now,selectionContract:'selection-inputs-v2',prediction:{version:'luxtips-events-xg-elo020-live-v4',sample:20,cutoff:clock.now,
      probabilities:{H:p,D:(1-p)/2,A:(1-p)/2},risks:[]},
      odds:{H:{fixtureId:id,market:'H',selection:'H',source:'API-Football',verifiedReceipt:true,odd:1.30,bookmaker:'Betano',at:clock.now,observedAt:clock.now}}};
  }
  function store(g){db.sql.prepare('INSERT OR REPLACE INTO fixtures VALUES(?,?,?,?,?)').run(g.fixture.id,g.fixture.league,g.fixture.ts,0,JSON.stringify(g.fixture));db.sql.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run('forecast:'+g.fixture.id,JSON.stringify(g),clock.now+86400000);}
  const publish=async games=>{for(const g of games)store(g);return rt.publishMarketPicks(db,games,clock.now,{markets:['H','A']});};
  const ids=()=>db.sql.prepare("SELECT fixture_id FROM openfoot_current_picks ORDER BY fixture_id").all().map(r=>r.fixture_id);
  const body=()=>({games:db.sql.prepare('SELECT data,published_at FROM openfoot_current_picks').all().map(r=>({...JSON.parse(r.data),published:{at:r.published_at}})),winnerAnalyses:[]});
  return {clock,db,rt,game,store,publish,ids,body};
}

test('ranks the complete stored pool across leagues, ignoring caller order and batch',async()=>{
  const s=setup();const games=[s.game(1,.71),s.game(2,.73),s.game(3,.75),s.game(4,.84,undefined,39)];
  games.forEach(s.store);await s.rt.publishMarketPicks(s.db,[games[0]],s.clock.now,{markets:['H','A']});
  assert.deepEqual(s.ids(),[2,3,4]);
});
test('late better game replaces only the worst; repeated cycles keep three and preserve originals',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  const r=await s.publish([s.game(4,.79,undefined,39)]);assert.equal(r.replaced,1);assert.deepEqual(s.ids(),[2,3,4]);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM openfoot_pick_revisions').get().n,4);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM openfoot_publication_archives').get().n,1);
  await s.publish([]);assert.deepEqual(s.ids(),[2,3,4]);
  assert.throws(()=>s.db.sql.exec('DELETE FROM openfoot_pick_revisions'),/immutable/);
});
test('successive better games replace the new worst and never exceed three',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  const r=await s.publish([s.game(4,.76),s.game(5,.81)]);assert.equal(r.replaced,2);assert.deepEqual(s.ids(),[3,4,5]);
});
test('equal or lower probabilities do not replace even at a higher odd',async()=>{
  const s=setup();await s.publish([s.game(1,.72),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  const g=s.game(4,.72);g.odds.H.odd=2;await s.publish([g,s.game(5,.71)]);assert.deepEqual(s.ids(),[1,2,3]);
});
test('new latest probabilities determine the worst, rather than old publication probabilities',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  await s.publish([s.game(1,.85),s.game(4,.79)]);assert.deepEqual(s.ids(),[1,3,4]);
});
test('invalid or stale quotes cannot displace valid publications',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  const bad=s.game(4,.95);bad.odds.H.at-=21600000;
  const cheap=s.game(5,.95);cheap.odds.H.odd=1.19;
  await s.publish([bad,cheap]);assert.deepEqual(s.ids(),[1,2,3]);
});
test('R1+R2 decision probability ranks model and market together; conditional sample stays valid',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  const g=s.game(4,.68);g.prediction.sample=4;g.prediction.contextAdjustment={market:{status:'available',books:9,at:s.clock.now,observedAt:s.clock.now,probabilities:{H:.90,D:.06,A:.04}}};
  await s.publish([g]);assert.deepEqual(s.ids(),[2,3,4]);
});
for(const [day,utc] of [['2026-11-05','08:00:00'],['2026-07-05','07:00:00'],['2026-03-29','07:00:00'],['2026-10-25','08:00:00']]){
  test('exact 08:00 Lisbon boundary '+day,async()=>{
    const boundary=Date.parse(day+'T'+utc+'Z');assert.equal(freezeAt(day),boundary);
    const s=setup(new Date(boundary-60000).toISOString());await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);
    s.clock.now=boundary-2;await s.publish([s.game(4,.79)]);assert.deepEqual(s.ids(),[2,3,4]);
    s.clock.now=boundary;await s.publish([s.game(5,.95)]);assert.deepEqual(s.ids(),[2,3,4]);
  });
}
test('tomorrow and D+2 remain replaceable after today has frozen',async()=>{
  const s=setup('2026-11-05T12:00:00Z');const day='2026-11-07';
  await s.publish([s.game(1,.71,day),s.game(2,.75,day),s.game(3,.8,day)]);s.clock.now+=60000;
  await s.publish([s.game(4,.9,day)]);assert.deepEqual(s.ids(),[2,3,4]);
});
test('started selections cannot be replaced',async()=>{
  const s=setup();const games=[s.game(1,.71),s.game(2,.75),s.game(3,.8)];games[0].fixture.ts=s.clock.now+30000;
  await s.publish(games);s.clock.now+=60000;await s.publish([s.game(4,.74)]);assert.deepEqual(s.ids(),[1,2,3]);
});
test('SQL clock rejects a swap that crosses 08:00 after JS eligibility',async()=>{
  const s=setup('2026-11-05T07:59:00Z');await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);
  const before=Date.parse('2026-11-05T07:59:59.999Z'),g=s.game(4,.9),row=s.db.sql.prepare('SELECT * FROM openfoot_current_picks WHERE fixture_id=1').get();
  s.clock.now=Date.parse('2026-11-05T08:00:00Z');const token=s.clock.now+120000;
  s.db.sql.prepare("INSERT OR REPLACE INTO openfoot_locks VALUES('publication',?)").run(token);
  assert.equal(await replaceDailyPick(s.db,row,g,{market:'H'},'2026-11-05',g,before,token),false);assert.deepEqual(s.ids(),[1,2,3]);
});
test('failed replacement insertion rolls back archive and retains all three',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  s.db.sql.exec("CREATE TRIGGER reject_test BEFORE INSERT ON openfoot_pick_revisions WHEN NEW.fixture_id=4 BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  await assert.rejects(s.publish([s.game(4,.9)]),/simulated write failure/);assert.deepEqual(s.ids(),[1,2,3]);
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM openfoot_publication_archives').get().n,0);
});
test('active publication lease rejects concurrent publisher',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);
  s.db.sql.prepare("UPDATE openfoot_locks SET until=? WHERE key='publication'").run(s.clock.now+120000);
  const r=await s.publish([s.game(4,.9)]);assert.equal(r.status,'locked');assert.deepEqual(s.ids(),[1,2,3]);
});
test('display and history replace the archived card and freeze exactly three, even across 08:00',async()=>{
  const s=setup('2026-11-05T07:58:00Z');await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);
  const stale=s.body();await syncFootballList(s.db,stale,s.clock.now);
  s.clock.now=Date.parse('2026-11-05T07:59:59.998Z');await s.publish([s.game(4,.9)]);
  let list=(await readDailyLists(s.db,'openfoot_state','football')).find(l=>l.day==='2026-11-05');
  assert.deepEqual(list.items.map(x=>x.gameId).sort(),[2,3,4]);
  s.clock.now=Date.parse('2026-11-05T08:00:01Z');await syncFootballList(s.db,stale,s.clock.now);
  const feed=await footballCurrentFeed(s.db,s.body(),s.clock.now),history=await footballHistoryFeed(s.db,{historyEntries:[]},s.clock.now);
  assert.deepEqual(feed.games.map(g=>g.fixture.id).sort(),[2,3,4]);
  assert.deepEqual(history.historyEntries.map(g=>g.fixture.id).sort(),[2,3,4]);
  list=(await readDailyLists(s.db,'openfoot_state','football')).find(l=>l.day==='2026-11-05');assert.equal(list.locked,true);assert.equal(list.items.length,3);
});
test('replacements stay within the same day',async()=>{
  const s=setup();await s.publish([s.game(1,.71),s.game(2,.75),s.game(3,.8)]);s.clock.now+=60000;
  await s.publish([s.game(4,.95,'2026-11-06')]);assert.deepEqual(s.ids(),[1,2,3,4]);
});
