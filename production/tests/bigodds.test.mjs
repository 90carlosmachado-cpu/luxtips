import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {testDatabase} from './sqlite.mjs';
import {BIGODDS_POLICY,goalModel,scoreProbabilities,selectTicket,marketHit} from '../bigodds-model.mjs';
import {publishBigOdds,settleBigOdds,bigOddsFeed,bigOddsResponse,candidatesFromQuotes,lisbonDay,syncBigOdds,generateBigOdds,dailySlot,archiveActiveBigOdds} from '../bigodds.mjs';
import {bigOddsPage,bigOddsClient} from '../bigodds-view.mjs';
import {manifest} from '../pwa.mjs';
const NOW=Date.parse('2026-11-05T12:00:00Z');
function setup(){
 const db=testDatabase();db.sql.exec('ALTER TABLE fixtures ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0; CREATE TABLE openfoot_match_details(source_id TEXT,fixture_id INTEGER,league INTEGER,kickoff INTEGER,observed_at INTEGER,data TEXT); CREATE TABLE results(fixture_id INTEGER PRIMARY KEY,hg INTEGER,ag INTEGER,settled_at INTEGER); CREATE TABLE openfoot_market_quotes(fixture_id INTEGER,kickoff INTEGER,bookmaker TEXT,market TEXT,selection TEXT,odd REAL,provider_at INTEGER,observed_at INTEGER);');
 db.sql.exec(readFileSync(new URL('../../migrations/0010_bigodds.sql',import.meta.url),'utf8'));
 db.sql.exec(readFileSync(new URL('../../migrations/0011_bigodds_withdrawn_reuse.sql',import.meta.url),'utf8'));
 const fixture=id=>({id,league:39,ts:NOW+DAY+id*1000,home:id,away:10000+id,homeName:'Casa '+id,awayName:'Fora '+id,competition:'Liga',status:'NS',finished:false,hg:null,ag:null});
 const store=f=>db.sql.prepare('INSERT OR REPLACE INTO fixtures(id,league,kickoff,finished,data) VALUES(?,?,?,?,?)').run(f.id,f.league,f.ts,Number(f.finished),JSON.stringify(f));
 const ticket=(offset=0)=>{
  const legs=Array.from({length:5},(_,i)=>{const f=fixture(offset+i+1);store(f);return {fixtureId:f.id,kickoff:f.ts,home:f.home,away:f.away,homeName:f.homeName,awayName:f.awayName,competition:'Liga',league:f.league,market:'O15',label:'Mais de 1,5 golos',odd:1.6,bookmaker:'Casa A',probability:.8,quoteAt:NOW-1000,observedAt:NOW-500,estimated:false};});
  return {legs,odd:1.6**5,bookmaker:'Casa A'};
 };
 const finish=(id,hg,ag,at=NOW+3*DAY)=>{let f=JSON.parse(db.sql.prepare('SELECT data FROM fixtures WHERE id=?').get(id).data);f={...f,hg,ag,finished:true,status:'FT'};store(f);db.sql.prepare('INSERT OR REPLACE INTO results VALUES(?,?,?,?)').run(id,hg,ag,at);};
 return {db,ticket,store,fixture,finish};
}
const DAY=86400000;
test('publication is atomic, pre-match, immutable and has a single active ticket',async()=>{
 const {db,ticket}=setup();const t=ticket(),first=await publishBigOdds(db,t,NOW);assert.equal(first.status,'published');
 const second=await publishBigOdds(db,ticket(20),NOW);assert.equal(second.status,'blocked_or_inputs_changed');
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,1);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM bigodds_all_legs').get().n,5);
 assert.throws(()=>db.sql.prepare("UPDATE bigodds_tickets SET data='{}'").run(),/immutable/);
 assert.throws(()=>db.sql.prepare("DELETE FROM bigodds_ticket_legs").run(),/immutable/);
 assert.throws(()=>db.sql.prepare("UPDATE bigodds_ticket_legs SET snapshot='{}'").run(),/immutable/);
});
test('a later-day pending leg blocks a new ticket despite settled wins',async()=>{
 const s=setup();await publishBigOdds(s.db,s.ticket(),NOW);s.finish(1,2,0);await settleBigOdds(s.db,NOW+3*DAY);
 assert.equal((await bigOddsFeed(s.db)).current.status,'active');
 assert.equal((await publishBigOdds(s.db,s.ticket(20),NOW)).status,'blocked_or_inputs_changed');
});
test('one confirmed loss closes immediately; unused legs never enter another ticket',async()=>{
 const s=setup(),t=s.ticket();await publishBigOdds(s.db,t,NOW);s.finish(1,0,0,NOW+2*DAY);await settleBigOdds(s.db,NOW+2*DAY);
 assert.equal((await bigOddsFeed(s.db)).current,null);assert.equal((await bigOddsFeed(s.db)).history[0].status,'lost');
 assert.equal((await publishBigOdds(s.db,t,NOW)).status,'blocked_or_inputs_changed');
 const next=s.ticket(20);assert.equal((await publishBigOdds(s.db,next,NOW)).status,'published');
 s.finish(2,2,0);await settleBigOdds(s.db,NOW+3*DAY);
 const feed=await bigOddsFeed(s.db);assert.equal(feed.history.find(t=>t.legs.some(l=>l.fixtureId===2)).legs.find(l=>l.fixtureId===2).status,'won');assert.equal(feed.summary.lost,1);
});
test('future result, score mismatch and changed identity fail closed',async()=>{
 const s=setup();await publishBigOdds(s.db,s.ticket(),NOW);s.finish(1,0,0,NOW+4*DAY);await settleBigOdds(s.db,NOW+3*DAY);assert.equal((await bigOddsFeed(s.db)).current.status,'active');
 const f=JSON.parse(s.db.sql.prepare('SELECT data FROM fixtures WHERE id=1').get().data);f.home=999;s.store(f);await settleBigOdds(s.db,NOW+5*DAY);assert.equal((await bigOddsFeed(s.db)).current.legs[0].status,'pending');
});
test('all wins close only after the last confirmed result',async()=>{
 const s=setup();await publishBigOdds(s.db,s.ticket(),NOW);for(let id=1;id<=4;id++)s.finish(id,2,0);await settleBigOdds(s.db,NOW+3*DAY);assert.equal((await bigOddsFeed(s.db)).current.status,'active');
 s.finish(5,1,1);await settleBigOdds(s.db,NOW+3*DAY);const f=await bigOddsFeed(s.db);assert.equal(f.current,null);assert.equal(f.summary.won,1);assert.equal(f.history[0].status,'won');
});
test('all cancellations produce a void ticket, excluded from won/lost accuracy',async()=>{
 const s=setup(),t=s.ticket();await publishBigOdds(s.db,t,NOW);for(const l of t.legs)s.store({...s.fixture(l.fixtureId),status:'CANC'});await settleBigOdds(s.db,NOW+DAY);const f=await bigOddsFeed(s.db);assert.equal(f.summary.void,1);assert.equal(f.summary.won,0);assert.equal(f.summary.lost,0);
});
test('AET/PEN scores cannot settle 90-minute markets',async()=>{
 const s=setup();await publishBigOdds(s.db,s.ticket(),NOW);s.finish(1,2,0);const f=JSON.parse(s.db.sql.prepare('SELECT data FROM fixtures WHERE id=1').get().data);f.status='AET';s.store(f);await settleBigOdds(s.db,NOW+3*DAY);assert.equal((await bigOddsFeed(s.db)).current.legs[0].status,'pending');
});
test('failed leg insert rolls back the entire publication',async()=>{
 const s=setup(),t=s.ticket();s.db.sql.exec("CREATE TRIGGER fail_leg BEFORE INSERT ON bigodds_ticket_legs WHEN NEW.fixture_id=3 BEGIN SELECT RAISE(ABORT,'test failure'); END;");await assert.rejects(publishBigOdds(s.db,t,NOW),/test failure/);assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,0);assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM bigodds_all_legs').get().n,0);
});
test('atomic fixture guard rejects started, moved, settled or different fixtures',async()=>{
 for(const change of ['started','moved','identity','settled']){const s=setup(),t=s.ticket(),f=s.fixture(1);if(change==='started')f.status='1H';if(change==='moved')f.ts+=DAY;if(change==='identity')f.away=123;s.store(f);if(change==='settled')s.finish(1,2,0);assert.equal((await publishBigOdds(s.db,t,NOW)).status,'blocked_or_inputs_changed');}
});
test('odds at six-hour boundary and quotes observed in the future cannot publish',async()=>{
 for(const change of ['stale','future','started','estimated']){const s=setup(),t=s.ticket();if(change==='stale')t.legs[0].quoteAt=NOW-21600000;if(change==='future')t.legs[0].observedAt=NOW+1;if(change==='started')t.legs[0].kickoff=NOW;if(change==='estimated')t.legs[0].estimated=true;assert.equal((await publishBigOdds(s.db,t,NOW)).status,'inputs_expired');}
});
test('Milan case: lower home price never switches analytical direction to X2',()=>{
 const probabilities={'1X':.673,X2:.595},common={fixtureId:1,bookmaker:'A',probabilities,estimated:false};
 const legs=[{...common,market:'1X',odd:1.18},{...common,market:'X2',odd:2.32}];
 const extra=Array.from({length:5},(_,i)=>({...common,fixtureId:i+2,market:'O15',odd:1.6,probabilities:{O15:.8}}));
 assert.ok(selectTicket([...legs,...extra]).legs.every(l=>l.fixtureId!==1));
 legs[0].odd=1.2;const t=selectTicket([...legs,...extra]);assert.ok(!t.legs.some(l=>l.fixtureId===1&&l.market==='X2'));
});
test('optimizer enforces one bookmaker, fixture uniqueness and odds 8–15',()=>{
 const c=Array.from({length:8},(_,i)=>({fixtureId:i+1,bookmaker:'A',market:'O15',odd:1.6,estimated:false,probabilities:{O15:.9-i*.01}}));
 const t=selectTicket([...c,...c.map(l=>({...l,market:'U35',probabilities:{U35:.7}}))]);assert.equal(t.legs.length,5);assert.ok(t.odd>=8&&t.odd<=15);assert.equal(new Set(t.legs.map(l=>l.fixtureId)).size,5);assert.equal(selectTicket(c.slice(0,4)),null);
});
test('quote builder rejects stale, mismatched, future and synthetic market prices',()=>{
 const f={id:1,home:1,away:2,ts:NOW+DAY},predict=()=>({probabilities:{O15:.8,U15:.2}}),base={fixture_id:1,kickoff:f.ts,bookmaker:'A',market:'Goals Over/Under',odd:1.6,provider_at:NOW-1000,observed_at:NOW};
 const quotes=[{...base,selection:'Over 1.5'},{...base,selection:'Under 1.5'}];assert.equal(candidatesFromQuotes([f],quotes,predict,NOW).length,2);
 for(const field of ['kickoff','provider_at','observed_at']){const q=structuredClone(quotes);q[0][field]=field==='kickoff'?f.ts+1:field==='provider_at'?NOW-21600000:NOW+1;assert.equal(candidatesFromQuotes([f],q,predict,NOW).length,0);}
});
test('scoreline distribution is normalized and markets settle at exact goal thresholds',()=>{
 const p=scoreProbabilities(1.5,1.2);assert.ok(Math.abs(p.O15+p.U15-1)<1e-12);assert.ok(Math.abs(p.BY+p.BN-1)<1e-12);assert.equal(marketHit('U35',2,1),true);assert.equal(marketHit('U35',2,2),false);assert.equal(marketHit('O15',0,1),false);assert.equal(marketHit('X2',2,4),true);
});
test('model never uses future results and matches frozen Python goals4 reference',()=>{
 const ref=JSON.parse(readFileSync(new URL('./bigodds-model-reference.json',import.meta.url),'utf8'));
 const p=goalModel(ref.history,ref.now)(ref.fixture).probabilities;
 for(const [k,v] of Object.entries(ref.probabilities))assert.ok(Math.abs(p[k]-v)<1e-11,k+': '+p[k]+' vs '+v);
 const future={...ref.history[0],kickoff:ref.now+DAY,settled_at:ref.now+2*DAY,hg:20,ag:0};assert.deepEqual(goalModel([...ref.history,future],ref.now)(ref.fixture).probabilities,p);
});
test('GET feed is read-only, HEAD has no body and invalid cursor is rejected',async()=>{
 const s=setup();await publishBigOdds(s.db,s.ticket(),NOW);const before=s.db.sql.prepare('SELECT total_changes() n').get().n;
 assert.equal((await bigOddsResponse(new Request('https://test/api/big-odds'),{DB:s.db})).status,200);assert.equal(s.db.sql.prepare('SELECT total_changes() n').get().n,before);
 assert.equal(await (await bigOddsResponse(new Request('https://test/api/big-odds',{method:'HEAD'}),{DB:s.db})).text(),'');
 assert.equal((await bigOddsResponse(new Request('https://test/api/big-odds?cursor=bad'),{DB:s.db})).status,400);
 assert.equal((await bigOddsResponse(new Request('https://test/api/big-odds',{method:'POST'}),{DB:s.db})).status,405);
});
test('empty ledger has no imported retrospective results; active cycle skips generation',async()=>{
 const s=setup();const f=await bigOddsFeed(s.db);assert.equal(f.history.length,0);assert.equal(f.summary.tickets,0);
 await publishBigOdds(s.db,s.ticket(),NOW);assert.equal((await syncBigOdds({DB:s.db},NOW)).status,'outside_daily_window');
});
test('Lisbon clock handles summer and winter and PWA points to Big Odds',()=>{assert.equal(lisbonDay(Date.parse('2026-07-05T23:30:00Z')),'2026-07-06');assert.equal(lisbonDay(NOW),'2026-11-05');assert.ok(manifest.shortcuts.some(x=>x.url==='/big-odds'));assert.ok(!manifest.shortcuts.some(x=>x.url==='/nba'));});
test('Big Odds page has tabs, accurate canonical metadata and a standalone valid client',async()=>{
 const original='<html><head><title>LuxTips</title></head><body><header></header><main id="main" class="shell">old</main><script>throw Error("old client")</script><footer class="shell"></footer></body></html>';
 const navigation=html=>html.replace('<header>','<header><a href="/" aria-current="page">Futebol</a><a href="/big-odds">Big Odds</a>');
 const response=await bigOddsPage(new Response(original),navigation),html=await response.text();assert.ok(html.includes('data-big-tab="history"'));assert.ok(html.includes('aria-current="page">Big Odds'));assert.ok(!html.includes('old client'));assert.ok(html.includes('https://luxtips.90carlosmachado.workers.dev/big-odds'));assert.ok(!html.includes('> NBA'));
 new vm.Script('('+bigOddsClient.toString()+')');
});
test('complete scheduled cycle builds, publishes, blocks, settles and generates the next ticket',async()=>{
 const s=setup();
 for(let id=1;id<=8;id++)s.store({...s.fixture(100+id),ts:NOW-DAY,home:id,away:10000+id,hg:3,ag:1,status:'FT',finished:true}); // Historical fixture rows without results ledger entries
 for(let id=1;id<=8;id++){
  const f={...s.fixture(id),ts:NOW+7200000+id*1000};s.store(f);
  for(const [selection,odd] of [['Over 1.5',1.6],['Under 1.5',2.4]])s.db.sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(id,f.ts,'Casa A','Goals Over/Under',selection,odd,NOW-1000,NOW-500);
 }
 const env={DB:s.db,LEAGUES:'39'},r=await generateBigOdds(env,NOW,()=>NOW);assert.equal(r.status,'published');
 const first=(await bigOddsFeed(s.db)).current;assert.equal(first.legs.length,5);assert.ok(first.legs.every(l=>l.model.homeSample>=1));assert.equal((await syncBigOdds(env,NOW,()=>NOW)).status,'outside_daily_window');
 s.finish(first.legs[0].fixtureId,0,0,NOW+3*3600000);await syncBigOdds(env,NOW+3*3600000,()=>NOW+3*3600000);
 const feed=await bigOddsFeed(s.db);assert.equal(feed.history[0].status,'lost');assert.equal(feed.current,null); // remaining fixtures have begun
 for(let id=20;id<28;id++){
  const f={...s.fixture(id),ts:NOW+6*3600000+id*1000};s.store(f);
  for(const [selection,odd] of [['Over 1.5',1.6],['Under 1.5',2.4]])s.db.sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(id,f.ts,'Casa A','Goals Over/Under',selection,odd,NOW+3*3600000-1000,NOW+3*3600000-500);
 }
 assert.equal((await generateBigOdds(env,NOW+3*3600000,()=>NOW+3*3600000)).status,'published');
 assert.ok((await bigOddsFeed(s.db)).current.legs.every(l=>l.fixtureId>=20));
});
test('feed pagination preserves the active ticket and does not import simulations',async()=>{
 const s=setup();for(let i=0;i<53;i++)s.db.sql.prepare("INSERT INTO bigodds_tickets VALUES(?,?,?,'void',?,?,?,?)").run('T'+i,NOW+i,BIGODDS_POLICY.id,NOW+i,10,'A',JSON.stringify({id:'T'+i,createdAt:NOW+i,legs:[]}));
 const first=await bigOddsFeed(s.db),next=await bigOddsFeed(s.db,first.nextCursor);assert.equal(first.history.length,50);assert.equal(next.history.length,3);assert.equal(new Set([...first.history,...next.history].map(t=>t.id)).size,53);
});
test('browser client loads cards, escapes names, changes tabs, paginates and reports fetch errors',async()=>{
 const s=setup();const t=s.ticket();t.legs[0].homeName='<script>alert(1)</script>';await publishBigOdds(s.db,t,NOW);const feed=await bigOddsFeed(s.db);feed.nextCursor=String(NOW-1);
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{toggle(){}},setAttribute(){}});return nodes.get(id);};
 const listeners={};const tabs=['current','history'].map(name=>({dataset:{bigTab:name},setAttribute(k,v){this[k]=v;}}));
 let fail=false,calls=0;
 const context=vm.createContext({console,Date,Intl,Map,Set,String,Number,JSON,Object,encodeURIComponent,setInterval(){},document:{querySelector:node,querySelectorAll:()=>tabs,addEventListener:(name,f)=>{listeners[name]=f;}},fetch:async()=>{calls++;if(fail)throw Error('offline');return {ok:true,json:async()=>({...feed,nextCursor:calls===1?feed.nextCursor:null})};}});
 context.stableDom=(target,markup)=>{if(target.innerHTML!==markup)target.innerHTML=markup;};context.analysisDetails=()=>'';context.disclosureEvents=()=>{};
 vm.runInContext('('+bigOddsClient.toString()+')(stableDom,analysisDetails,disclosureEvents)',context);await new Promise(resolve=>setImmediate(resolve));
 assert.ok(node('#bigCurrent').innerHTML.includes('&lt;script&gt;'));assert.ok(!node('#bigCurrent').innerHTML.includes('<script>alert'));
 await listeners.click({target:{closest:()=>tabs[1]}});assert.equal(tabs[1]['aria-selected'],'true');assert.equal(node('#pageTitle').textContent,'Histórico');
 await listeners.click({target:{closest:()=>({id:'bigMore',dataset:{}})}});assert.equal(calls,2);assert.ok(!node('#bigHistory').innerHTML.includes('id="bigMore"'));
 fail=true;await listeners.click({target:{closest:()=>({id:'bigRetry',dataset:{}})}});await new Promise(resolve=>setImmediate(resolve));assert.ok(node('#status').textContent.includes('indisponível'));assert.ok(node('#bigCurrent').innerHTML.includes('&lt;script&gt;'));
});
test('actual integration routes replace NBA with Big Odds and preserve football API delegation',async()=>{
 const source=readFileSync(new URL('../integration.js',import.meta.url),'utf8'),start=source.indexOf('function withNba('),end=source.indexOf('// platform-integration/entry.mjs',start);
 const context=vm.createContext({Request,Response,Headers,URL,JSON,console,pwaRoute:async()=>null,bigOddsResponse,bigOddsPage,integrateSports:h=>h,footballCurrentFeed:async(db,body)=>body});vm.runInContext(source.slice(start,end),context);
 const calls=[],base='<html><head></head><body><header></header><main id="main" class="shell"></main></body></html>';
 const wrapped=context.withNba({fetch:async req=>{calls.push(new URL(req.url).pathname);return new URL(req.url).pathname==='/api/games'?Response.json({games:[]}):new Response(base);}}),env={DB:setup().db};
 assert.equal((await wrapped.fetch(new Request('https://test/nba'),env,{})).headers.get('Location'),'https://test/big-odds');
 assert.equal((await wrapped.fetch(new Request('https://test/api/nba'),env,{})).status,410);
 assert.ok((await (await wrapped.fetch(new Request('https://test/big-odds'),env,{})).text()).includes('data-big-tab="current"'));
 assert.equal((await wrapped.fetch(new Request('https://test/api/games'),env,{})).status,200);assert.ok(calls.includes('/api/games'));
 const navStart=source.indexOf('function sportNavigation('),navEnd=source.indexOf('var extraStyle',navStart);vm.runInContext(source.slice(navStart,navEnd),vm.createContext({football:'',howLink:()=>'',basketball:''}));assert.ok(!source.slice(navStart,navEnd).includes('href="/nba"'));
});
test('08h Lisbon only, including summer and DST transition days',()=>{
 for(const date of ['2026-11-06','2026-07-05','2026-03-29','2026-10-25']){
  const summer=['2026-07-05','2026-03-29'].includes(date),at=Date.parse(date+(summer?'T07:00:00Z':'T08:00:00Z'));
  assert.equal(dailySlot(at-1),null);assert.equal(dailySlot(at).day,date);assert.equal(dailySlot(at+59999,at).day,date);assert.equal(dailySlot(at+60000,at),null);
 }
});
test('active at 08h consumes the day, even if it loses during or after the slot',async()=>{
 const s=setup(),at=Date.parse('2026-11-06T08:00:00Z');await publishBigOdds(s.db,s.ticket(),NOW);
 const first=await syncBigOdds({DB:s.db},at,()=>at,at);assert.equal(first.status,'skipped_active');
 s.finish(1,0,0,at+10000);
 assert.equal((await syncBigOdds({DB:s.db},at+20000,()=>at+20000,at)).status,'daily_slot_consumed');
 assert.equal((await bigOddsFeed(s.db)).current,null);
 assert.equal((await syncBigOdds({DB:s.db},at+3600000,()=>at+3600000)).status,'outside_daily_window');
 const key='bigodds:daily0800:2026-11-06';assert.equal(JSON.parse(s.db.sql.prepare('SELECT data FROM openfoot_state WHERE key=?').get(key).data).status,'skipped_active');
});
test('settlement still runs outside publication hours without generating a replacement',async()=>{
 const s=setup();await publishBigOdds(s.db,s.ticket(),NOW);s.finish(1,0,0,NOW+DAY);
 assert.equal((await syncBigOdds({DB:s.db},NOW+DAY,()=>NOW+DAY)).status,'outside_daily_window');assert.equal((await bigOddsFeed(s.db)).history[0].status,'lost');assert.equal((await bigOddsFeed(s.db)).summary.tickets,1);
});
test('no eligible ticket at 08h consumes that day; next day may attempt again',async()=>{
 const s=setup(),at=Date.parse('2026-11-06T08:00:00Z');
 assert.equal((await syncBigOdds({DB:s.db},at,()=>at)).status,'no_upcoming_fixtures');
 assert.equal((await syncBigOdds({DB:s.db},at+1000,()=>at+1000,at)).status,'daily_slot_consumed');
 assert.equal((await syncBigOdds({DB:s.db},at+DAY,()=>at+DAY)).status,'no_upcoming_fixtures');
 assert.equal(s.db.sql.prepare("SELECT COUNT(*) n FROM openfoot_state WHERE key LIKE 'bigodds:daily0800:%'").get().n,2);
});
test('scheduled generation uses D+2 and rejects D+3 and publication after the minute',async()=>{
 const s=setup(),at=Date.parse('2026-11-06T08:00:00Z');
 for(let id=1;id<=8;id++){
  const f={...s.fixture(100+id),ts:Date.parse('2026-11-08T18:00:00Z')+id*1000};s.store(f);
  for(const [selection,odd]of [['Over 1.5',1.6],['Under 1.5',2.4]])s.db.sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(f.id,f.ts,'A','Goals Over/Under',selection,odd,at-1000,at-500);
 }
 assert.equal((await syncBigOdds({DB:s.db},at,()=>at+60000)).status,'daily_window_expired');assert.equal((await bigOddsFeed(s.db)).summary.tickets,0);
 const fresh=setup();for(let id=1;id<=8;id++){const f={...fresh.fixture(200+id),ts:Date.parse('2026-11-08T18:00:00Z')+id*1000};fresh.store(f);for(const [selection,odd]of [['Over 1.5',1.6],['Under 1.5',2.4]])fresh.db.sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(f.id,f.ts,'A','Goals Over/Under',selection,odd,at-1000,at-500);}
 assert.equal((await syncBigOdds({DB:fresh.db},at,()=>at+10000)).status,'published');const current=(await bigOddsFeed(fresh.db)).current;assert.ok(current.legs.every(l=>lisbonDay(l.kickoff)==='2026-11-08'));assert.equal(current.policy.days,3);
});
test('concurrent cron attempts consume only one daily slot',async()=>{
 const s=setup(),at=Date.parse('2026-11-06T08:00:00Z');const results=await Promise.all([syncBigOdds({DB:s.db},at,()=>at),syncBigOdds({DB:s.db},at,()=>at)]);
 assert.deepEqual(results.map(r=>r.status).sort(),['daily_slot_consumed','no_upcoming_fixtures']);
 assert.equal(s.db.sql.prepare("SELECT COUNT(*) n FROM openfoot_state WHERE key='bigodds:daily0800:2026-11-06'").get().n,1);
});
test('D+3 fixtures cannot enter the daily candidate pool',async()=>{
 const s=setup(),at=Date.parse('2026-11-06T08:00:00Z');
 for(let id=1;id<=6;id++)s.store({...s.fixture(400+id),ts:Date.parse('2026-11-09T18:00:00Z')+id*1000});
 assert.equal((await syncBigOdds({DB:s.db},at,()=>at)).status,'no_upcoming_fixtures');
});
test('authorized internal rebuild archives only the active ticket and runs once outside 08h',async()=>{
 const s=setup(),old=await publishBigOdds(s.db,s.ticket(),NOW),original=s.db.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old.id).data;
 for(let id=20;id<28;id++){const f=s.fixture(id);s.store(f);for(const [selection,odd] of [['Over 1.5',1.6],['Under 1.5',2.4]])s.db.sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(id,f.ts,'A','Goals Over/Under',selection,odd,NOW-1000,NOW-500);}
 const command={id:'test-one-off',policy:BIGODDS_POLICY.id,requestedAt:NOW,expires:NOW+300000};s.db.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:manual_rebuild',?)").run(JSON.stringify(command));
 const result=await syncBigOdds({DB:s.db},NOW,()=>NOW);assert.equal(result.manual,true);assert.equal(result.status,'published');
 const feed=await bigOddsFeed(s.db),archived=feed.history.find(t=>t.id===old.id);assert.equal(archived.status,'void');assert.equal(archived.archived,true);assert.ok(archived.legs.every(l=>l.status==='void'&&l.result.status==='replaced'));assert.equal(s.db.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old.id).data,original);
 assert.ok(feed.current.legs.every(l=>l.fixtureId>=20));assert.equal(feed.current.policy.id,BIGODDS_POLICY.id);assert.equal(s.db.sql.prepare("SELECT COUNT(*) n FROM bigodds_tickets WHERE status='active'").get().n,1);
 assert.equal((await syncBigOdds({DB:s.db},NOW,()=>NOW)).status,'outside_daily_window');assert.equal((await bigOddsFeed(s.db)).summary.tickets,2);
});
test('expired or wrong-policy rebuild commands cannot archive an active publication',async()=>{
 for(const policy of ['expired','wrong']){const s=setup(),old=await publishBigOdds(s.db,s.ticket(),NOW);const c={id:'test',policy:policy==='wrong'?'unknown':BIGODDS_POLICY.id,requestedAt:NOW-1,expires:policy==='expired'?NOW-1:NOW+1000};s.db.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:manual_rebuild',?)").run(JSON.stringify(c));assert.equal((await syncBigOdds({DB:s.db},NOW,()=>NOW)).status,'outside_daily_window');assert.equal((await bigOddsFeed(s.db)).current.id,old.id);}
});
test('explicitly withdrawn legacy fixtures can be reused without rewriting original snapshots',async()=>{
 const s=setup(),t=s.ticket(),old='legacy-withdrawn',original=JSON.stringify({id:old,createdAt:NOW,policy:{id:'old'},bookmaker:t.bookmaker,odd:t.odd,legs:t.legs});
 s.db.sql.prepare("INSERT INTO bigodds_tickets(id,created_at,policy,status,odd,bookmaker,data) VALUES(?,?,?,'active',?,?,?)").run(old,NOW,'old',t.odd,t.bookmaker,original);
 for(const l of t.legs)s.db.sql.prepare('INSERT INTO bigodds_legs(fixture_id,ticket_id,kickoff,snapshot) VALUES(?,?,?,?)').run(l.fixtureId,old,l.kickoff,JSON.stringify(l));
 await archiveActiveBigOdds(s.db,NOW,'owner-replace');const next=await publishBigOdds(s.db,t,NOW);assert.equal(next.status,'published');
 const feed=await bigOddsFeed(s.db);assert.equal(feed.current.id,next.id);assert.equal(feed.history.find(t=>t.id===old).archived,true);assert.equal(s.db.sql.prepare('SELECT data FROM bigodds_tickets WHERE id=?').get(old).data,original);
 s.finish(1,2,0);await settleBigOdds(s.db,NOW+3*DAY);
 const oldLeg=s.db.sql.prepare('SELECT status,result FROM bigodds_legs WHERE fixture_id=1').get(),newLeg=s.db.sql.prepare('SELECT status,result FROM bigodds_ticket_legs WHERE ticket_id=? AND fixture_id=1').get(next.id);assert.equal(oldLeg.status,'void');assert.equal(JSON.parse(oldLeg.result).status,'replaced');assert.equal(newLeg.status,'won');
});
test('withdrawn new-storage tickets can reuse fixtures repeatedly, one active ticket only',async()=>{
 const s=setup(),t=s.ticket();let ids=[];
 for(let i=0;i<3;i++){const r=await publishBigOdds(s.db,t,NOW);assert.equal(r.status,'published');ids.push(r.id);if(i<2)await archiveActiveBigOdds(s.db,NOW,'replace-'+i);}
 assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM bigodds_ticket_legs WHERE fixture_id=1').get().n,3);assert.equal(s.db.sql.prepare("SELECT COUNT(*) n FROM bigodds_tickets WHERE status='active'").get().n,1);assert.equal((await bigOddsFeed(s.db)).history.filter(t=>t.archived).length,2);
});
test('ordinary void or lost tickets still block fixture reuse',async()=>{
 const s=setup(),t=s.ticket();await publishBigOdds(s.db,t,NOW);
 s.db.sql.prepare("UPDATE bigodds_ticket_legs SET status='void'").run();await settleBigOdds(s.db,NOW);
 assert.equal((await publishBigOdds(s.db,t,NOW)).status,'blocked_or_inputs_changed');
});
test('history restart hides prior tickets and metrics without changing the active ticket or ledger',async()=>{
 const s=setup(),old=await publishBigOdds(s.db,s.ticket(),NOW);s.finish(1,0,0,NOW);await settleBigOdds(s.db,NOW);const current=await publishBigOdds(s.db,s.ticket(20),NOW+1);assert.equal(current.status,'published');
 const before=await bigOddsFeed(s.db);assert.equal(before.summary.lost,1);assert.equal(before.history.length,2);
 s.db.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:history_reset',?)").run(JSON.stringify({startAt:NOW+1}));
 const after=await bigOddsFeed(s.db);assert.equal(after.current.id,current.id);assert.equal(after.history.length,1);assert.equal(after.summary.tickets,1);assert.equal(after.summary.lost,0);assert.equal(after.summary.won,0);assert.equal(after.summary.void,0);assert.equal(after.summary.active,1);assert.equal(after.historyStartAt,NOW+1);assert.equal(after.nextCursor,null);
 const page=await bigOddsFeed(s.db,String(NOW+1));assert.equal(page.history.length,0);assert.equal(page.current.id,current.id);assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM bigodds_tickets').get().n,2);assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM bigodds_all_legs').get().n,10);
 s.finish(21,0,0,NOW+1);await settleBigOdds(s.db,NOW+1);assert.equal((await bigOddsFeed(s.db)).summary.lost,1);assert.equal(s.db.sql.prepare('SELECT status FROM bigodds_tickets WHERE id=?').get(old.id).status,'lost');
});
test('invalid history restart fails closed and frontend clears previously loaded tickets after a restart',async()=>{
 const s=setup();s.db.sql.prepare("INSERT INTO openfoot_state VALUES('bigodds:history_reset',?)").run(JSON.stringify({startAt:'bad'}));await assert.rejects(bigOddsFeed(s.db),/invalid_history_reset/);const js=bigOddsClient.toString();assert.ok(js.includes('reset?[]:history'));assert.ok(js.includes('d.historyStartAt||0'));
});
