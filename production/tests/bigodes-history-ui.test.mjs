import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {legState,ticketProgress} from '../ticket-presentation.mjs';
import {bigOddsClient} from '../bigodds-view.mjs';

const NOW=Date.parse('2026-11-15T12:00:00Z');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function ticket(i,status='won'){
 return {id:'T'+i,createdAt:NOW+i*1000,status,currentOdd:8.3,currentOddStatus:'ready',legs:[{
  fixtureId:i+1,kickoff:NOW+(1000-i)*60000,home:1,away:2,homeName:'Casa',awayName:'Fora',
  market:'1',status:'won',result:{home:2,away:0},currentQuote:{odd:1.3,status:'ready',at:NOW-60000}
 }]};
}
function feed(rows,nextCursor=null,historyStartAt=0){
 return {at:NOW,history:rows,nextCursor,historyStartAt,current:null,summary:{won:80,lost:43,void:0,active:1}};
}
async function client(respond){
 const nodes=new Map(),listeners={},calls=[];
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{innerHTML:id==='#pageTitle'?'BIG<span>OD</span>ES':'',textContent:'',classList:{toggle(){}},setAttribute(){}});
  return nodes.get(id);
 };
 let tick;
 const context=vm.createContext({console,legState,ticketProgress,Date,Intl,Map,Set,String,Number,JSON,Object,Promise,encodeURIComponent,
  AbortController,setTimeout,clearTimeout,setInterval(fn){tick=fn;},
  document:{querySelector:node,querySelectorAll:()=>[],addEventListener:(name,fn)=>{listeners[name]=fn;}},
  fetch:async url=>{calls.push(url);const data=await respond(url,calls.length);return {ok:true,json:async()=>data};},
  stableDom:(target,markup)=>{target.innerHTML=markup;},analysisDetails:()=>'',disclosureEvents:()=>{}
 });
 vm.runInContext('('+bigOddsClient.toString()+')(stableDom,analysisDetails,disclosureEvents)',context);
 await flush();
 return {
  node,calls,
  ids:()=>[...node('#bigHistory').innerHTML.matchAll(/data-fixture="history-ticket:([^"]+)"/g)].map(m=>m[1]),
  more:()=>listeners.click({target:{closest:()=>({id:'bigMore',dataset:{}})}}),
  refresh:async()=>{tick();await flush();}
 };
}

test('Bigodes shows newest created tickets first, ten at a time, with the full summary',async()=>{
 const all=Array.from({length:27},(_,i)=>ticket(i));
 const c=await client(()=>feed([ticket(100,'active'),...all.filter((_,i)=>i%2===0),...all.filter((_,i)=>i%2)]));
 const expected=all.toReversed().map(t=>t.id);
 assert.deepEqual(c.ids(),expected.slice(0,10));
 assert.match(c.node('#bigHistory').innerHTML,/80 ganhas em 123 resolvidas/);
 await c.more();assert.deepEqual(c.ids(),expected.slice(0,20));
 await c.refresh();assert.deepEqual(c.ids(),expected.slice(0,20));
 await c.more();assert.deepEqual(c.ids(),expected);
 assert.doesNotMatch(c.node('#bigHistory').innerHTML,/id="bigMore"/);
 assert.equal(c.calls.length,2,'cached increments do not fetch another API page');
});

test('Bigodes crosses 50-row API pages, retries errors, and preserves its cursor through refreshes',async()=>{
 const all=Array.from({length:123},(_,i)=>ticket(i)).toReversed();
 const first=feed([ticket(200,'active'),...all.slice(0,49)],'page2');
 let fail=true;
 const c=await client(url=>{
  if(!url.includes('?'))return first;
  if(url.endsWith('page2')){if(fail)throw Error('offline');return feed(all.slice(49,99),'page3');}
  assert.ok(url.endsWith('page3'),'the next cursor must not rewind after a refresh');
  return feed(all.slice(99));
 });
 for(const n of [20,30,40]){await c.more();assert.equal(c.ids().length,n);}
 assert.equal(c.calls.length,1);
 await c.more();assert.equal(c.ids().length,40);
 assert.match(c.node('#status').textContent,/Não foi possível carregar/);
 assert.match(c.node('#bigHistory').innerHTML,/Mostrar mais/);
 fail=false;await c.more();assert.equal(c.ids().length,50);
 assert.match(c.node('#status').textContent,/^Atualizado /);
 await c.refresh();assert.equal(c.ids().length,50);
 for(const n of [60,70,80,90,100,110,120]){await c.more();assert.equal(c.ids().length,n);}
 await c.more();assert.deepEqual(c.ids(),all.map(t=>t.id));
 assert.equal(new Set(c.ids()).size,123);
 assert.doesNotMatch(c.node('#bigHistory').innerHTML,/id="bigMore"/);
 await c.refresh();assert.equal(c.ids().length,123);
 assert.doesNotMatch(c.node('#bigHistory').innerHTML,/id="bigMore"/);
 assert.deepEqual(c.calls.filter(url=>url.includes('?')),['/api/big-odds?cursor=page2','/api/big-odds?cursor=page2','/api/big-odds?cursor=page3']);
});

test('a history reset discards an older page still in flight and restores the first ten',async()=>{
 const old=Array.from({length:70},(_,i)=>ticket(i)).toReversed();
 const fresh=Array.from({length:12},(_,i)=>ticket(i+100)).toReversed();
 let reset=false,release;
 const older=new Promise(resolve=>{release=resolve;});
 const c=await client(url=>url.includes('?')?older:reset?feed(fresh,null,NOW+100000):feed(old.slice(0,50),'older'));
 for(let i=0;i<4;i++)await c.more();
 assert.equal(c.ids().length,50);
 const pending=c.more();await flush();
 const calls=c.calls.length;await c.more();assert.equal(c.calls.length,calls,'busy prevents duplicate requests');
 reset=true;await c.refresh();assert.deepEqual(c.ids(),fresh.slice(0,10).map(t=>t.id));
 release(feed(old.slice(50)));await pending;
 assert.deepEqual(c.ids(),fresh.slice(0,10).map(t=>t.id));
 await c.more();assert.deepEqual(c.ids(),fresh.map(t=>t.id));
 assert.doesNotMatch(c.node('#bigHistory').innerHTML,/id="bigMore"/);
});
