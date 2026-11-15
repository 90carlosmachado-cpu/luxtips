import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionEvents,hash,read,write} from '../selection-events.mjs';
import {testDatabase} from './sqlite.mjs';
const at=Date.parse('2026-11-07T08:00:00Z');
const list={day:'2026-11-07',locked:true,items:[{payload:{fixture:{homeName:'Roma',awayName:'Bayern'},displayTip:{market:'A'}}}]};
test('Telegram publication events retain the Lisbon lock in summer and winter',()=>{
 assert.equal(selectionEvents([list],[],at-1).length,0);
 assert.equal(selectionEvents([{...list,locked:false}],[],at).length,0);
 const [e]=selectionEvents([list],[],at);assert.equal(e.createdAt,at);assert.match(e.body,/Bayern vence/);
 assert.equal(selectionEvents([{...list,day:'2026-11-08'}],[],at).length,0);
 const summer={...list,day:'2026-07-07'};const s=Date.parse('2026-07-07T07:00:00Z');
 assert.equal(selectionEvents([summer],[],s-1).length,0);assert.equal(selectionEvents([summer],[],s)[0].createdAt,s);
});
test('Big Odds contains no selections or odds and is keyed by ticket',()=>{
 const [e]=selectionEvents([],[{id:'one',status:'active',created_at:at}],at);
 assert.equal(e.body,'Existe uma nova múltipla BIGODES disponível.');assert.equal(e.url,'/big-odds');
 assert.equal(selectionEvents([],[{id:'old',status:'active',created_at:at-3600000}],at).length,0);
});
test('Telegram keeps late entries for today and ignores cancelled or future selections',()=>{
 const later=at+4*3600000;
 const item={id:'fresh',gameId:2,firstListedAt:later,kickoff:later+3600000,payload:list.items[0].payload};
 const events=selectionEvents([
  {...list,items:[item,{...item,id:'cancelled',payload:{...item.payload,historyStatus:'cancelled'}}]},
  {...list,day:'2026-11-08',items:[{...item,id:'tomorrow'}]}
 ],[],later).filter(e=>e.expiresAt>later);
 assert.equal(events.length,1);assert.equal(events[0].key,'football-late:2026-11-07:fresh');
 assert.equal(events[0].url,'/?jogo=2');assert.deepEqual(events[0].selectionIds,['fresh']);
 assert.equal(selectionEvents([{...list,items:[item]}],[],item.kickoff).filter(e=>e.expiresAt>item.kickoff).length,0);
});
test('Telegram state keys retain the original hash encoding and stored delivery state',async()=>{
 assert.equal(await hash('telegram-channel'),'fUXOlIxKrs2pHMp_ypHQYdlZCtsLLfw7vZb3zJxx55o');
 const db=testDatabase(),key='telegram:'+await hash('telegram-channel')+':baseline';
 assert.equal(await read(db,key),null);
 await write(db,key,{at});assert.deepEqual(await read(db,key),{at});
 await write(db,key,{at:at+1});assert.deepEqual(await read(db,key),{at:at+1});
});
