import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {syncFootballPresentation} from '../list-presentation.mjs';
import {decorateFrontOffice} from '../front-office.mjs';

const worker=readFileSync(new URL('../production-worker.mjs',import.meta.url),'utf8');
const embedded=worker.split('\n').find(line=>line.trimStart().startsWith('index_default = ')).trim();
const html=decorateFrontOffice(syncFootballPresentation(JSON.parse(embedded.slice('index_default = '.length,-1))));
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\s+loadGames\(\);\s*$/,'');

function runtime(rows=[]){
  const nodes=new Map(),listeners=new Map();
  const document={
    querySelector(selector){
      if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',addEventListener(){}});
      return nodes.get(selector);
    },
    querySelectorAll(){return [];},
    addEventListener(name,fn){listeners.set(name,[...(listeners.get(name)||[]),fn]);}
  };
  const context=vm.createContext({document,location:{hostname:'luxtips.90carlosmachado.workers.dev'},Date,setInterval(){},rows,
    fetch:async()=>({ok:true,json:async()=>({historyEntries:context.rows})})});
  vm.runInContext(script,context);
  // The history tests exercise the actual emitted renderer and click handlers;
  // updating the separate upcoming-games grid is outside this fixture.
  vm.runInContext('render=()=>{};historyEntries=rows;renderHistory();',context);
  const body=()=>nodes.get('#historyBody').innerHTML;
  const ids=()=>[...body().matchAll(/<article\b[^>]*data-fixture="(\d+)"/g)].map(match=>Number(match[1]));
  const more=()=>listeners.get('click').forEach(fn=>fn({target:{closest:selector=>selector==='#footballHistoryMore'?{}:null}}));
  return {context,body,ids,more};
}
function game(id){
  return {fixture:{id,ts:Date.parse('2026-10-01T18:00:00Z')+id*86400000,home:id,away:id+100,homeName:'Casa '+id,awayName:'Fora '+id},
    published:{at:1},displayTip:{market:'H',odd:1.5,oddsAt:Date.parse('2026-10-01T01:23:00Z')},priceBookmaker:'Betano',
    history:{kind:'recommendation',provenance:'reconstructed'},historyStatus:id===1?'pending':id===8?'cancelled':'settled',
    result:{home:2,away:0},displayHit:id%2===0?1:0};
}

test('football history is newest first across statuses, expands by ten and preserves its total and page on refresh',async()=>{
  const rows=Array.from({length:23},(_,i)=>game(i+1));
  const r=runtime([...rows,rows[22]]);
  assert.deepEqual(r.ids(),[23,22,21,20,19,18,17,16,15,14]);
  assert.match(r.body(),/10 certos em 21 resolvidos/);
  assert.match(r.body(),/>Mostrar mais<\/button>/);
  assert.doesNotMatch(r.body(),/Registo recuperado|apresentação original|reconstituídos/);
  r.more();
  assert.equal(r.ids().length,20);
  r.context.rows=[...rows].reverse();
  await vm.runInContext('history()',r.context);
  assert.equal(r.ids().length,20);
  r.more();
  assert.deepEqual(r.ids(),Array.from({length:23},(_,i)=>23-i));
  assert.match(r.body(),/10 certos em 21 resolvidos/);
  assert.doesNotMatch(r.body(),/id="footballHistoryMore"/);
});

test('empty and complete first pages do not offer more history',()=>{
  const empty=runtime();assert.match(empty.body(),/O histórico começa aqui/);assert.deepEqual(empty.ids(),[]);
  assert.doesNotMatch(empty.body(),/id="footballHistoryMore"/);
  const full=runtime(Array.from({length:10},(_,i)=>game(i+1)));
  assert.equal(full.ids().length,10);assert.doesNotMatch(full.body(),/id="footballHistoryMore"/);
});

test('football cards preserve odds and match times without the quote clock or removed labels',()=>{
  const r=runtime([game(1)]);
  assert.match(r.body(),/>1,50<\/strong>/);
  assert.match(r.body(),/datetime="2026-10-02T18:00:00.000Z"/);
  assert.doesNotMatch(r.body(),/01:23|02:23|Registo recuperado|apresentação original/);
  assert.doesNotMatch(html,/FUTEBOL · R1\+R2 · ATÉ 3 POR DIA|Como funciona|como-funciona|method-page|priceStamp/);
});
