import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mixtureProjection,grid} from '../src/legacy-worker.mjs';
const bundle=readFileSync(new URL('../src/legacy-worker.mjs',import.meta.url),'utf8');
const start=bundle.indexOf('var index_default = '),html=runInNewContext(bundle.slice(start+20,bundle.indexOf(';\n',start)));
const helpers=html.slice(html.indexOf('      function scoreline('),html.indexOf('      function render()'));
const published=html.slice(html.indexOf('      function card('),html.indexOf('      function pickLabel('));
const ui=runInNewContext(helpers+'\n'+published+'\n({scoreline,winnerCard,card})',{Date,esc:s=>String(s??''),pickLabel:()=> 'Casa vence'});
const fixture={id:1,homeName:'Casa',awayName:'Fora',ts:Date.now()+86400000,competition:'Liga'};
test('one actual modal score appears in both card types, including draws despite likely over2.5',()=>{
 const luxg=mixtureProjection([{weight:1,homeGoals:1.5,awayGoals:1.5}]);
 assert.ok(grid(1.5,1.5).O25>.5);
 assert.equal(luxg.topScores[0].home,1);assert.equal(luxg.topScores[0].away,1);
 const g={fixture,prediction:{luxg},winnerTip:{odd:1.5},winnerAnalysis:{mostLikelyScore:luxg.topScores[0],quote:null,value:{},modelProbability:.65}};
 for(const rendered of [ui.card(g),ui.winnerCard({...g,prediction:undefined})]){
  assert.equal((rendered.match(/Resultado exato mais provável:/g)||[]).length,1);
  assert.ok(rendered.includes('<strong>1–1 · 11,2%</strong>'));
  assert.ok(!rendered.includes('1–1 · 65'));
  assert.ok(!rendered.includes('topScores'));
 }
});
test('missing or invalid score cannot produce a fabricated result',()=>{
 for(const score of [undefined,{home:NaN,away:1,probability:.1},{home:1,away:-1,probability:.1},{home:1,away:1,probability:0}]){
  assert.ok(ui.scoreline({prediction:{luxg:{topScores:[score]}}}).includes('Indisponível'));
 }
});
