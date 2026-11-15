import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {applyDesign,designStyle} from '../design-system.mjs';
import {crystalIcon,crystalMark} from '../crystal-brand.mjs';
import {legState,ticketProgress} from '../ticket-presentation.mjs';
import {dayChips,decorateFrontOffice,analysisDetails,esc} from '../front-office.mjs';
import {bigOddsPage} from '../bigodds-view.mjs';
import {manifest,pwaRoute} from '../pwa.mjs';

const NOW=Date.parse('2026-11-15T12:00:00Z');
const shell=`<!doctype html><html><head><title>LuxTips · Prognósticos de futebol</title></head><body><header class="shell topbar"><a class="brand" href="/"><img class="brand-logo" src="data:image/png;base64,UNCHANGED" alt="LuxTips" width="240" height="80"></a><nav class="sports" aria-label="Modalidade"><a href="/" aria-current="page"><svg></svg><span>Futebol</span></a><a href="/big-odds"><svg></svg><span>Bigodes</span></a></nav><span class="header-caption">FOOTBALL INTELLIGENCE</span></header><main id="main" class="shell"><h1 id="pageTitle">Prognósticos<span class="title-dot">.</span></h1><p>Futebol aos 90 minutos</p></main><footer class="shell">LUXTIPS<span> / </span>FUTEBOL</footer><script>const change=name=>{return (name==='history'?'Histórico':'Prognósticos')+'<span class="title-dot">.</span>';};</script></body></html>`;
const leg=(id,status='pending',more={})=>({fixtureId:id,homeName:'Casa '+id,awayName:'Fora '+id,status,kickoff:NOW+id*3600000,...more});

test('crystal icon is inline, accessible by adjacent text, without remote assets',()=>{
 assert.match(crystalIcon,/aria-hidden="true"/);assert.match(crystalIcon,/focusable="false"/);
 assert.match(crystalIcon,/viewBox="0 0 32 32"/);assert.doesNotMatch(crystalIcon,/https?:|<image|<script/);
 assert.match(crystalMark,/Bola de <strong>Cristal/);
});
test('branding replaces area, not sport references, logo, destinations or active navigation',()=>{
 const html=applyDesign(shell);assert.equal(html.match(/<img class="brand-logo"[^>]+>/)[0],shell.match(/<img class="brand-logo"[^>]+>/)[0]);
 assert.match(html,/BOLA DE CRISTAL/);assert.match(html,/<span>Bola de Cristal<\/span>/);assert.match(html,/Futebol aos 90 minutos/);
 assert.match(html,/<a href="\/" aria-current="page">/);assert.match(html,/<a href="\/big-odds">/);assert.doesNotMatch(html,/<span class="header-caption">/);
});
test('current/history title switches remain branded and scripts parse',()=>{
 const h=applyDesign(shell),script=h.match(/<script>([\s\S]*?)<\/script>/)[1];
 const context=vm.createContext({});vm.runInContext(script,context);
 assert.equal(vm.runInContext('change("games")',context),'Bola de Cristal');assert.equal(vm.runInContext('change("history")',context),'Histórico');
});
test('design style inserts once and leaves retired NBA unmodified',()=>{
 assert.equal(applyDesign(applyDesign(shell)),applyDesign(shell));assert.equal(applyDesign(shell,'nba'),shell);
 assert.equal((applyDesign(shell).match(/id="luxtips-design-v2"/g)||[]).length,1);
});
test('metadata and footer are consistent with the new section',()=>{
 const h=decorateFrontOffice(shell);assert.match(h,/<meta property="og:title" content="Bola de Cristal · LuxTips"/);assert.match(h,/18\+/);assert.match(h,/BOLA DE CRISTAL/);
});
test('day labels fit mobile while retaining the complete accessible label',()=>{
 const h=dayChips(['d0','d1','d2','d3'],['Ontem','Hoje','Amanhã','Depois de amanhã'],'d1',[1,2,0,3]);
 assert.match(h,/>Depois<\/span>/);assert.match(h,/aria-label="Depois de amanhã, 3 jogos"/);assert.match(h,/aria-selected="true"/);assert.match(h,/tabindex="0"/);
});
for(const [status,kind,label,icon] of [['won','win','Ganha','✓'],['lost','loss','Perdida','×'],['void','void','Anulada','—']]){
 test('selection state '+status+' has independent textual and symbolic feedback',()=>assert.deepEqual(legState(leg(1,status),NOW),{kind,label,icon}));
}
test('kickoff alone is never shown as live',()=>{
 assert.equal(legState(leg(1,'pending',{kickoff:NOW-3600000}),NOW).label,'A aguardar resultado');
 assert.equal(legState(leg(1,'pending'),NOW).label,'Por disputar');assert.equal(legState(leg(1,'pending',{fixtureStatus:'2H'}),NOW).label,'Em jogo');
});
test('known result takes precedence over a stale live status',()=>assert.equal(legState(leg(1,'won',{fixtureStatus:'2H'}),NOW).kind,'win'));
test('rescheduling uses current kickoff and does not invent a result',()=>{
 const s=legState(leg(1,'pending',{rescheduled:true,currentKickoff:NOW+86400000}),NOW);assert.equal(s.label,'Reagendado');assert.equal(s.kind,'pending');
});
test('empty and absent ticket legs do not fabricate progress',()=>{assert.equal(ticketProgress({},NOW),'');assert.equal(ticketProgress({legs:[]},NOW),'');});
test('progress counts won legs only and uses the current chronological order without mutation',()=>{
 const ticket={legs:[leg(3,'void'),leg(1,'won',{currentKickoff:NOW+40000000}),leg(2,'lost'),leg(4,'won'),leg(5)]};const copy=structuredClone(ticket);
 const html=ticketProgress(ticket,NOW);assert.match(html,/2 de 5 seleções ganhas · 1 anulada/);assert.equal((html.match(/<li /g)||[]).length,5);
 assert.ok(html.indexOf('Casa 2')<html.indexOf('Casa 3'));assert.ok(html.indexOf('Casa 5')<html.indexOf('Casa 1'));assert.deepEqual(ticket,copy);
});
test('malicious names are escaped in tooltip and screen-reader text',()=>{
 const html=ticketProgress({legs:[leg(1,'won',{homeName:'<img src=x onerror=alert(1)>',awayName:'" onmouseover="x'})]},NOW);
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/&quot;/);
});
test('unknown completion and empty analysis remain unknown',()=>{
 assert.equal(analysisDetails({probability:null},esc),'');assert.match(ticketProgress({legs:[leg(1,'mystery',{kickoff:null})]},NOW),/A aguardar resultado/);
});
test('PWA shortcut renamed, original icons, URL and install identity retained',()=>{
 assert.equal(manifest.name,'LuxTips');assert.equal(manifest.start_url,'/?source=pwa');assert.equal(manifest.shortcuts[0].name,'Bola de Cristal');assert.equal(manifest.shortcuts[0].url,'/');assert.equal(manifest.icons[0].src,'/icons/icon-192.png');
});
test('retired push API remains disabled',async()=>{
 const r=await pwaRoute(new Request('https://local.test/api/push/config'));assert.equal(r.status,410);assert.equal((await r.json()).enabled,false);
});
test('Bigodes page retains logo, history wiring, production CSP and serializes required helpers',async()=>{
 const r=await bigOddsPage(new Response(shell,{headers:{'Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"}}),h=>h);
 const h=await r.text();assert.match(h,/Bola de Cristal/);assert.match(h,/data-big-tab="current"/);assert.match(h,/data-big-tab="history"/);
 assert.match(h,/function ticketProgress/);assert.match(h,/function legState/);assert.match(h,/historyLimit=10/);assert.match(h,/historyLimit\+10/);
 assert.match(h,/<span class="bigodes-name-inline">BIG/);assert.match(h,/UNCHANGED/);assert.match(r.headers.get('Content-Security-Policy'),/worker-src 'self'/);
 for(const script of h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
});
test('styles support reduced motion, visible status labels and safe-area layout',()=>{
 assert.match(designStyle,/prefers-reduced-motion:reduce/);assert.match(designStyle,/safe-area-inset-bottom/);assert.match(designStyle,/\.outcome\.loss/);assert.match(designStyle,/min-height:44px/);
});
