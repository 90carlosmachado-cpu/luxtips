import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './sqlite.mjs';
import {providerFetch} from '../src/context/provider.mjs';
import {operationsAuthorized} from '../src/context/operations.mjs';
import worker from '../src/worker.mjs';
import {browserApiFetch} from '../src/context/browser-fetch.mjs';
import {publishDailyPicks} from '../src/legacy-worker.mjs';
import {readFileSync} from 'node:fs';
import {maintenance} from '../src/context/maintenance.mjs';
import {RELAY_PROCESS,validProviderPath} from '../src/context/relay-process.mjs';
import {Script} from 'node:vm';

test('isolated relay restricts upstream paths and its runtime process parses without embedding credentials',()=>{
 assert.equal(validProviderPath('fixtures?league=39&season=2026'),true);
 assert.equal(validProviderPath('fixtures/lineups?fixture=1'),true);
 for(const path of ['https://evil.test/status','//evil.test/status','fixtures/../status','status#x','/status',''])assert.equal(validProviderPath(path),false,path);
 assert.doesNotThrow(()=>new Script(RELAY_PROCESS));
});

test('container transport uses the private singleton and preserves real provider headers',async()=>{
 const db=testDatabase();db.sql.exec('CREATE TABLE locks(key TEXT PRIMARY KEY,until INTEGER);CREATE TABLE meta(key TEXT PRIMARY KEY,data TEXT);');
 const env={DB:db,FOOTBALL_API_TRANSPORT:'container',API_FOOTBALL_KEY:'test-secret',FOOTBALL_RELAY:{getByName(name){assert.equal(name,'api-football');return {async request(path){assert.equal(path,'fixtures?league=39');return {status:200,headers:{'x-ratelimit-limit':'300'},body:JSON.stringify({errors:[],response:[]})};}};}}};
 const response=await providerFetch(env,'https://v3.football.api-sports.io/fixtures?league=39',{});
 assert.equal(response.headers.get('x-ratelimit-limit'),'300');
 const record=JSON.parse(db.sql.prepare("SELECT data FROM meta WHERE key='provider:last-response'").get().data);
 assert.equal(record.valid,true);assert.equal(record.transport,'container');db.sql.close();
});

test('the whole maintenance sequence has one owner, recovers expired leases and releases after errors',async()=>{
 const db=testDatabase();let release,ran=0;
 const first=maintenance({DB:db},async()=>{ran++;await new Promise(resolve=>{release=resolve;});return {status:'ok'};});
 while(!release)await new Promise(resolve=>setTimeout(resolve,1));
 assert.deepEqual(await maintenance({DB:db},async()=>{ran++;}),{status:'locked'});
 release();assert.deepEqual(await first,{status:'ok'});assert.equal(ran,1);
 db.sql.prepare("UPDATE openfoot_locks SET until=? WHERE key='maintenance'").run(Date.now()-1);
 await assert.rejects(maintenance({DB:db},async()=>{throw Error('source');}),/source/);
 assert.equal(db.sql.prepare("SELECT until FROM openfoot_locks WHERE key='maintenance'").get().until,0);db.sql.close();
});

test('public reads do not start network or recalculation jobs that can be cancelled with the response',async()=>{
 const db=testDatabase();
 db.sql.exec('CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);CREATE TABLE sync_requests(finished_at INTEGER);');
 db.sql.exec(readFileSync(new URL('../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));
 let jobs=0;
 const response=await worker.fetch(new Request('https://luxtips.test/api/games'),{DB:db,OPENFOOT_MODE:'live',PREDICTION_CONTEXT_MODE:'live',LEAGUES:'39'},{waitUntil(){jobs++;}});
 assert.equal(response.status,200);assert.equal(jobs,0);assert.deepEqual((await response.json()).games,[]);db.sql.close();
});

test('unpriced favorites cannot occupy publication slots ahead of a qualified alternative; thresholds stay intact',async()=>{
 const now=Date.now();
 for(const scenario of ['valid','low_probability','stale','negative_ev']){
  const db=testDatabase();
  db.sql.exec('CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);');
  db.sql.exec(readFileSync(new URL('../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));
  const game=(id,p)=>({fixture:{id,ts:now+3*3600000,home:id,away:id+10,homeName:'H'+id,awayName:'A'+id,status:'NS',finished:false},
   sourceUpdatedAt:now,prediction:{sample:20,cutoff:now,probabilities:{H:p,D:.15,A:1-p-.15,U35:.8},contextAdjustment:{uncertainty:{spread:{H:.02,D:.01,A:.01,U35:.02}}}},
   winnerTip:{market:'H',probability:p,majority:true,sourceUpdatedAt:now,risks:[]},odds:{H:{fixtureId:id,odd:1.25,at:now,observedAt:now,source:'API-Football',verifiedReceipt:true,market:'H',selection:'H',bookmaker:'B'}}});
  const favorites=[game(1,.75),game(2,.7),game(3,.65)],alternative=game(4,.55);
  alternative.prediction.probabilities.U35=scenario==='low_probability'?.69:.8;
  alternative.odds.U35={fixtureId:4,odd:scenario==='negative_ev'?1.25:1.4,at:scenario==='stale'?now-6*3600000:now,observedAt:now,source:'API-Football',verifiedReceipt:true,market:'U35',selection:'U35',bookmaker:'B'};
  await publishDailyPicks(db,[...favorites,alternative],now);
  const saved=db.sql.prepare('SELECT fixture_id,market FROM openfoot_current_picks').all();
  assert.equal(saved.length,scenario==='valid'?1:0,scenario);
  if(saved.length){assert.equal(saved[0].fixture_id,4);assert.equal(saved[0].market,'U35');}
  db.sql.close();
 }
});

test('browser API transport restricts the host, keeps the key in headers and bounds monthly usage',async()=>{
 const db=testDatabase();let calls=0;
 const env={DB:db,API_FOOTBALL_KEY:'test-secret',FOOTBALL_BROWSER:{async quickAction(action,options){
  calls++;assert.equal(action,'scrape');assert.equal(options.setJavaScriptEnabled,false);
  assert.equal(options.setExtraHTTPHeaders['x-apisports-key'],'test-secret');
  assert.ok(!options.url.includes('test-secret'));
  return Response.json({success:true,result:[{selector:'pre',results:[{text:JSON.stringify({errors:[],response:[]})}]}]});
 }}};
 await assert.rejects(browserApiFetch(env,'https://example.com/status'),/browser_transport_unavailable/);
 assert.equal(calls,0);
 assert.deepEqual(await(await browserApiFetch(env,'https://v3.football.api-sports.io/status')).json(),{errors:[],response:[]});
 const key='browser_usage:'+new Date().toISOString().slice(0,7);
 db.sql.prepare('UPDATE openfoot_state SET data=? WHERE key=?').run(JSON.stringify({ms:20*3600000}),key);
 await assert.rejects(browserApiFetch(env,'https://v3.football.api-sports.io/status'),/browser_transport_budget/);
 assert.equal(calls,1);db.sql.close();
});

test('provider lease rejects simultaneous callers and releases after success or network failure',async()=>{
 const db=testDatabase();db.sql.exec('CREATE TABLE locks(key TEXT PRIMARY KEY,until INTEGER);CREATE TABLE meta(key TEXT PRIMARY KEY,data TEXT);');
 const original=globalThis.fetch;let release;
 try{
  globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(new Response('{}',{headers:{'x-ratelimit-limit':'300'}}));});
  const first=providerFetch({DB:db},'https://v3.football.api-sports.io/status',{});
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  await assert.rejects(providerFetch({DB:db},'https://v3.football.api-sports.io/status',{}),e=>e.code==='rate_limit_busy');
  release();await first;
  assert.equal(db.sql.prepare("SELECT until FROM locks WHERE key='api-flight'").get().until,0);
  db.sql.exec("UPDATE locks SET until=0 WHERE key='api-next'");
  globalThis.fetch=async()=>{throw Error('network');};
  await assert.rejects(providerFetch({DB:db},'https://v3.football.api-sports.io/status',{}),/network/);
  assert.equal(db.sql.prepare("SELECT until FROM locks WHERE key='api-flight'").get().until,0);
 }finally{globalThis.fetch=original;db.sql.close();}
});

test('operations access is hashed, expires, and cannot be used anonymously',async()=>{
 const db=testDatabase(),token='local-maintenance-test';
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 const hash=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
 db.sql.prepare('INSERT INTO openfoot_state VALUES(?,?)').run('operations_access',JSON.stringify({hash,expires:Date.now()+60000}));
 const request=()=>new Request('https://luxtips.test/api/admin/recalculate',{headers:{Authorization:'Bearer '+token}});
 assert.equal(await operationsAuthorized(request(),db),true);
 assert.equal(await operationsAuthorized(new Request('https://luxtips.test'),db),false);
 db.sql.prepare('UPDATE openfoot_state SET data=? WHERE key=?').run(JSON.stringify({hash,expires:Date.now()-1}),'operations_access');
 assert.equal(await operationsAuthorized(request(),db),false);
 assert.equal((await worker.fetch(new Request('https://luxtips.test/api/admin/recalculate',{method:'POST'}),{DB:db},{})).status,401);
 db.sql.close();
});
