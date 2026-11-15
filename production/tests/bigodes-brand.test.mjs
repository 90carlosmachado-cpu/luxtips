import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bigodesIcon,bigodesHeading,bigodesMark,bigodesStyles} from '../bigodes-brand.mjs';
import {telegramBrand} from '../telegram-brand.mjs';
import {crystalMark,crystalCardStyles} from '../crystal-brand.mjs';
import {esc} from '../front-office.mjs';
const source=readFileSync(new URL('../telegram.mjs',import.meta.url),'utf8');
const render=new Function('esc','telegramBrand','bigodesMark','bigodesStyles','crystalMark','crystalCardStyles',source.slice(source.indexOf('function cardTeam('),source.indexOf('function resultCard('))+'\nreturn card;')(esc,telegramBrand,bigodesMark,bigodesStyles,crystalMark,crystalCardStyles);
const pick={home:{id:1,name:'Casa <teste>'},away:{id:2,name:'Fora'},competition:'Teste',time:'15/11 · 18:00',selection:'Casa vence',odd:'1,50'};
test('BIGODES keeps its Portuguese spelling and explains the Big Odds pun',()=>{
  assert.equal(bigodesHeading.replace(/<svg[\s\S]*?<\/svg>/,'').replace(/<[^>]+>/g,''),'BIGODES');
  assert.match(bigodesMark,/BIG ODDS/);assert.match(bigodesIcon,/<path fill="currentColor"/);assert.match(bigodesStyles,/#ceff75/);
});
for(const count of [1,12])test('Telegram brand, logos and escaped selections: '+count,()=>{
  const html=render('BIGODES',Array.from({length:count},()=>pick),{odd:'10,00',won:false});
  assert.match(html,/class="bigodes-brand"/);assert.match(html,/class="bigodes-moustache"/);
  assert.equal((html.match(/<article>/g)||[]).length,count);assert.equal((html.match(/class="crest"/g)||[]).length,count*2);
  assert.ok(!html.includes('BIGODDES'));assert.ok(!html.includes('<teste>'));assert.match(html,/Boletim em curso/);
});
test('Winning multiple receives the same identity',()=>assert.match(render('BIGODES',[pick],{odd:'10,00',won:true}),/Múltipla ganha/));
test('Ordinary football cards retain their identity',()=>{const html=render('Prognósticos do dia',[pick],null);assert.ok(!html.includes('class="bigodes-brand"'));assert.match(html,/<h1>Prognósticos do dia<\/h1>/);assert.match(html,/class="crystal-mark"/);assert.match(html,/Bola de <strong>Cristal/);});
test('Returning from history restores the complete wordmark',()=>{const view=readFileSync(new URL('../bigodds-view.mjs',import.meta.url),'utf8');assert.match(view,/const pageTitleHtml=/);assert.ok(view.includes(".innerHTML=b.dataset.bigTab==='history'?'Histórico':pageTitleHtml"));});
