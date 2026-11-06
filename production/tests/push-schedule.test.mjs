import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionEvents,notifyNewSelections,write} from '../push.mjs';
import {testDatabase} from './sqlite.mjs';
const at=Date.parse('2026-11-07T08:00:00Z');
const list={day:'2026-11-07',locked:true,items:[{payload:{fixture:{homeName:'Roma',awayName:'Bayern'},displayTip:{market:'A'}}}]};
test('football only notifies today at its Lisbon lock, summer and winter',()=>{
 assert.equal(selectionEvents([list],[],at-1).length,0);
 assert.equal(selectionEvents([{...list,locked:false}],[],at).length,0);
 const [e]=selectionEvents([list],[],at);assert.equal(e.createdAt,at);assert.match(e.body,/Bayern vence/);
 assert.equal(selectionEvents([{...list,day:'2026-11-08'}],[],at).length,0);
 const summer={...list,day:'2026-07-07'};const s=Date.parse('2026-07-07T07:00:00Z');
 assert.equal(selectionEvents([summer],[],s-1).length,0);assert.equal(selectionEvents([summer],[],s)[0].createdAt,s);
});
test('Big Odds contains no selections or odds and is keyed by ticket',()=>{
 const [e]=selectionEvents([],[{id:'one',status:'active',created_at:at}],at);
 assert.equal(e.body,'Existe uma nova Big Odds disponível.');assert.equal(e.url,'/big-odds');
 assert.equal(selectionEvents([],[{id:'old',status:'active',created_at:at-3600000}],at).length,0);
});
function setup(){const db=testDatabase();db.sql.exec('CREATE TABLE bigodds_tickets(id TEXT,created_at INTEGER,status TEXT)');return db;}
test('scheduled deliveries deduplicate, ignore legacy events and retain existing subscribers',async()=>{
 const db=setup(),env={DB:db,PWA_VAPID_JWK:'{}'};
 await write(db,'pwa:scheduled-baseline',{at:at-1000});
 await write(db,'daily_list:lisbon-0800-v1:football:2026-11-07',list);
 await write(db,'pwa:sub:test',{id:'test',subscription:{},preferences:{football:true},createdAt:at-2000,footballSince:at-2000});
 await write(db,'pwa:event:old',{id:'old',key:'football:old',createdAt:at,kickoff:at+10000});
 db.sql.prepare('INSERT INTO bigodds_tickets VALUES(?,?,?)').run('new',at,'active');
 const calls=[],send=async(_,e)=>{calls.push(e);return {ok:true,status:201};};
 assert.equal((await notifyNewSelections(env,at,send)).sent,2);
 assert.equal((await notifyNewSelections(env,at+1000,send)).sent,0);
 assert.equal(calls.length,2);
});
test('initial migration never sends historical notifications',async()=>{
 const db=setup();await write(db,'daily_list:lisbon-0800-v1:football:2026-11-07',list);
 await write(db,'pwa:sub:test',{id:'test',subscription:{},preferences:{football:true},createdAt:at-2000});
 const r=await notifyNewSelections({DB:db,PWA_VAPID_JWK:'{}'},at+10000,async()=>{throw Error('unexpected send');});assert.equal(r.events,0);assert.equal(r.sent,0);
});
test('failed delivery retries without repeating an already successful event',async()=>{
 const db=setup();await write(db,'pwa:scheduled-baseline',{at:at-1000});
 await write(db,'daily_list:lisbon-0800-v1:football:2026-11-07',list);
 await write(db,'pwa:sub:t',{id:'t',subscription:{},preferences:{football:true},createdAt:at-2000});
 const env={DB:db,PWA_VAPID_JWK:'{}'};
 assert.equal((await notifyNewSelections(env,at,async()=>({ok:false,status:503,json:async()=>({})}))).failed,1);
 assert.equal((await notifyNewSelections(env,at+1000,async()=>{throw Error('too early');})).failed,0);
 assert.equal((await notifyNewSelections(env,at+60001,async()=>({ok:true,status:201}))).sent,1);
});
test('late entries for today notify once, future days and odds updates do not notify',async()=>{
 const db=setup(),env={DB:db,PWA_VAPID_JWK:'{}'},sent=[];
 const send=async(_,e)=>{sent.push(e);return {ok:true,status:201};};
 const key='daily_list:lisbon-0800-v1:football:2026-11-07';
 const old={id:'old',gameId:1,firstListedAt:at-1000,kickoff:at+12*3600000,payload:list.items[0].payload};
 await write(db,'pwa:scheduled-baseline',{at:at-1000});
 await write(db,'pwa:sub:t',{id:'t',subscription:{},preferences:{football:true},createdAt:at-2000});
 await write(db,key,{...list,items:[old]});await notifyNewSelections(env,at,send);assert.equal(sent.length,1);
 const later=at+4*3600000;
 const fresh={...old,id:'fresh',gameId:2,firstListedAt:later};
 await write(db,key,{...list,items:[old,fresh]});
 await write(db,key.replace('2026-11-07','2026-11-08'),{...list,day:'2026-11-08',items:[{...fresh,id:'tomorrow'}]});
 await notifyNewSelections(env,later,send);assert.equal(sent.length,2);assert.match(sent[1].key,/football-late:/);assert.equal(sent[1].url,'/?jogo=2');
 fresh.payload={...fresh.payload,displayTip:{market:'A',odd:1.45}};
 await write(db,key,{...list,items:[old,fresh]});await notifyNewSelections(env,later+1000,send);assert.equal(sent.length,2);
});
test('entry first discovered during 08h cycle is included without a duplicate late alert',async()=>{
 const db=setup(),env={DB:db,PWA_VAPID_JWK:'{}'},sent=[];
 await write(db,'pwa:scheduled-baseline',{at:at-1000});
 await write(db,'pwa:sub:t',{id:'t',subscription:{},preferences:{football:true},createdAt:at-2000});
 await write(db,'daily_list:lisbon-0800-v1:football:2026-11-07',{...list,items:[{id:'at8',gameId:1,firstListedAt:at+10000,kickoff:at+3600000,payload:list.items[0].payload}]});
 await notifyNewSelections(env,at+20000,async(_,e)=>{sent.push(e);return {ok:true,status:201};});assert.equal(sent.length,1);assert.match(sent[0].key,/football-lock:/);
});
test('first pick of an initially empty day still notifies after 09h',async()=>{
 const db=setup(),env={DB:db,PWA_VAPID_JWK:'{}'},later=at+4*3600000,sent=[];
 await write(db,'pwa:scheduled-baseline',{at:at-1000});
 await write(db,'pwa:sub:t',{id:'t',subscription:{},preferences:{football:true},createdAt:at-2000});
 await write(db,'daily_list:lisbon-0800-v1:football:2026-11-07',{...list,items:[{id:'late',gameId:1,firstListedAt:later,kickoff:later+3600000,payload:list.items[0].payload}]});
 await notifyNewSelections(env,later,async(_,e)=>{sent.push(e);return {ok:true,status:201};});assert.equal(sent.length,1);assert.match(sent[0].key,/football-late:/);
});
