import {injectPwa} from './pwa.mjs';
import {decorateFrontOffice,esc,analysisDetails,disclosureEvents} from './front-office.mjs';
import {stableDom} from './stable-dom.mjs';
export function bigOddsClient(stableDom,analysisDetails,disclosureEvents){
 disclosureEvents();
 const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=x=>Number(x).toFixed(2).replace('.',','),stamp=t=>new Date(t).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const names={active:'Em curso',won:'Ganha',lost:'Perdida',void:'Anulada',pending:'Por resolver'};
 let data=null,history=[],cursor=null,busy=false,loading=false;
 function update(target,markup){stableDom(target,markup);}
 function crest(id,name){return '<span class="crest"><span class="initials" aria-hidden="true">'+esc(String(name).slice(0,2))+'</span><img src="https://media.api-sports.io/football/teams/'+Number(id)+'.png" alt="Emblema de '+esc(name)+'" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>';}
 const selectionLabel=l=>l.market==='1'&&l.homeName?l.homeName+' vence':l.market==='2'&&l.awayName?l.awayName+' vence':l.label;
 function leg(l,historical=false){
  const displayKickoff=l.currentKickoff||l.kickoff;
  const q=l.currentQuote,price=l.status==='void'?'1,00':q&&Number.isFinite(q.odd)?number(q.odd):'—',priceLabel=l.status==='void'?'Seleção anulada':!q?'Betano indisponível':q.status==='quote_expired'?'Última odd Betano':'Odd Betano';
  const resolved=l.result&&Number.isInteger(l.result.home),score=resolved?l.result.home+'–'+l.result.away:null;
  return '<article class="match-card big-leg" data-fixture="'+Number(l.fixtureId)+'"><div class="match-meta"><span class="competition">'+esc(l.competition||'Futebol')+'</span><time datetime="'+new Date(displayKickoff).toISOString()+'">'+esc(stamp(displayKickoff))+'</time></div><div class="match-teams"><div class="team">'+crest(l.home,l.homeName)+'<span class="team-name">'+esc(l.homeName)+'</span></div><div class="kickoff"><strong>'+esc(score||new Date(displayKickoff).toLocaleTimeString('pt-PT',{timeZone:'Europe/Lisbon',hour:'2-digit',minute:'2-digit'}))+'</strong><span>'+(resolved?'Resultado final':l.status==='void'?'Anulado':displayKickoff<=Date.now()?'A aguardar resultado':'Lisboa')+'</span></div><div class="team">'+crest(l.away,l.awayName)+'<span class="team-name">'+esc(l.awayName)+'</span></div></div><div class="pick-row"><div class="pick"><span class="field-label">Seleção</span><strong>'+esc(selectionLabel(l))+'</strong></div><div class="odd" title="Última cotação Betano recebida pela API; pode diferir da casa neste instante."><span class="field-label">'+priceLabel+'</span><strong>'+price+'</strong>'+(q?'<small class="small">'+esc(stamp(q.at))+'</small>':'')+'</div></div><div class="match-result"><span class="outcome '+(l.status==='won'?'win':l.status==='lost'?'loss':'')+'">'+({won:'✓',lost:'×',void:'—',pending:'○'}[l.status]||'○')+' '+esc(l.rescheduled&&l.status==='pending'?'Reagendado · '+stamp(displayKickoff):names[l.status])+'</span></div>'+(historical?'':legAnalysis(l))+'</article>';
 }
 function legAnalysis(l){
  let markup=analysisDetails({probability:Number.isFinite(l.modelProbability)?l.modelProbability:l.probability,quote:{odd:l.currentQuote?.odd??null,bookmaker:'Betano'}},esc,'big:'+l.fixtureId);
  if(!markup)return '';
  const m=l.model||{},fmt=n=>Number(n).toLocaleString('pt-PT',{maximumFractionDigits:2});
  const pct=n=>(100*n).toLocaleString('pt-PT',{maximumFractionDigits:1})+'%';
  const rows=(Number.isFinite(l.marketProbability)?'<div><dt>Decisão · 50% modelo + 50% mercado</dt><dd>'+pct(l.probability)+'</dd></div><div><dt>Referência de mercado · sem margem</dt><dd>'+pct(l.marketProbability)+'</dd></div>':'')+(typeof m.xgUsed==='boolean'?'<div><dt>Dados usados no modelo</dt><dd>'+(m.xgUsed?'xG':'Golos · sem xG suficiente')+'</dd></div><div><dt>Jogos com xG · casa / fora</dt><dd>'+Number(m.xgHomeSample||0)+' / '+Number(m.xgAwaySample||0)+'</dd></div>':'')+(Number.isFinite(m.homeGoals)&&Number.isFinite(m.awayGoals)?'<div><dt>Golos esperados pelo modelo · casa / fora</dt><dd>'+fmt(m.homeGoals)+' / '+fmt(m.awayGoals)+'</dd></div>':'')+
   (Number.isInteger(m.homeSample)&&Number.isInteger(m.awaySample)?'<div><dt>Jogos anteriores · casa / fora</dt><dd>'+m.homeSample+' / '+m.awaySample+'</dd></div>':'')+
   (Number.isFinite(m.cutoff)?'<div><dt>Análise registada</dt><dd>'+esc(stamp(m.cutoff))+'</dd></div>':'');
  markup=markup.replace('</dl>',rows+'</dl>');
  const note=typeof m.xgUsed==='boolean'?(m.xgUsed?'Modelo com xG, combinado a 50% com a referência da casa.':'Sem amostra xG suficiente: modelo de golos, combinado a 50% com a referência da casa.'):'Estimativa baseada nos golos marcados e sofridos, sem xG.';
  return markup.replace('</div></details>','<p>'+note+' A análise é a registada à publicação; a cotação Betano é atualizada separadamente. Não inclui lesões ou onzes. As amostras referem-se à condição casa ou fora na competição.</p></div></details>');
 }
 const orderedLegs=t=>[...t.legs].sort((a,b)=>a.kickoff-b.kickoff||a.fixtureId-b.fixtureId);
 const ticketStart=t=>Math.min(...t.legs.map(l=>l.kickoff));
 const chronologicalTickets=(a,b)=>ticketStart(a)-ticketStart(b)||a.createdAt-b.createdAt;
 function ticket(t,historical=false){
  const voids=t.legs.filter(l=>l.status==='void').length,effective=t.legs.filter(l=>l.status!=='void').reduce((p,l)=>p*(l.currentQuote?.odd||1),1),total=Number.isFinite(t.currentOdd)?number(t.currentOdd):'—',totalLabel=t.currentOddStatus==='ready'?'Odd total Betano':t.currentOddStatus==='quote_expired'?'Total Betano · desatualizado':t.currentOddStatus==='market_unavailable'?'Total Betano indisponível':'Último total Betano';
  const content='<section class="big-ticket" data-fixture="ticket:'+esc(t.id)+'" aria-label="Boletim de '+esc(stamp(t.createdAt))+'"><div class="big-ticket-heading"><div><h2>'+esc(t.archived?'Substituído':names[t.status])+'</h2><p class="small">'+esc(stamp(t.createdAt))+' · '+t.legs.length+' seleções · '+esc(t.displayBookmaker||'Betano')+'</p></div><div class="big-total"><span class="field-label">'+totalLabel+'</span><strong>'+total+'</strong>'+(voids?'<span class="small">Após anulações: '+number(effective)+'</span>':'')+'</div></div>'+'<div class="grid">'+orderedLegs(t).map(l=>leg(l,historical)).join('')+'</div></section>';
  if(!historical)return content;
  const correct=t.legs.filter(l=>l.status==='won').length;
  return '<details class="big-history-ticket" data-analysis data-analysis-key="history-ticket:'+esc(t.id)+'" data-fixture="history-ticket:'+esc(t.id)+'"><summary role="button" aria-expanded="false"><span class="big-history-info"><strong>'+esc(t.archived?'Substituído':names[t.status])+'</strong><span>'+esc(stamp(t.createdAt))+' · '+t.legs.length+' seleções · '+correct+' certas · '+esc(t.displayBookmaker||'Betano')+'</span></span><span class="big-history-odd"><span class="field-label">'+totalLabel+'</span><strong>'+total+'</strong></span><span class="big-history-chevron" aria-hidden="true">⌄</span></summary><div class="big-history-content"><div class="grid">'+orderedLegs(t).map(l=>leg(l,true)).join('')+'</div></div></details>';

 }
 function render(){
  if(!data)return;
  const current=data.current;
  update($('#bigCurrent'),current?ticket(current):'<div class="empty"><h3>Sem boletim em curso</h3><p>Nova seleção às 08h de Lisboa.</p></div>');
  const s=data.summary,total=Number(s.won||0)+Number(s.lost||0),won=Number(s.won||0),rate=total?100*won/total:null;
  const closed=history.filter(t=>t.status!=='active').sort(chronologicalTickets);
  update($('#bigHistory'),'<div class="history-summary"><div class="summary-main"><span class="rate">'+(rate===null?'—':rate.toFixed(1).replace('.',',')+'<small>%</small>')+'</span><div><span class="summary-title">Acerto das múltiplas</span><span class="summary-detail">'+won+' ganhas em '+total+' resolvidas</span></div></div><span class="small">'+Number(s.void||0)+' anulados/arquivados · '+Number(s.active||0)+' em curso</span></div>'+(closed.length?closed.map(t=>ticket(t,true)).join(''):'<div class="empty"><h3>Ainda sem múltiplas resolvidas</h3><p>O histórico começa com os boletins publicados neste separador.</p></div>')+(cursor?'<button id="bigMore" class="big-more" '+(busy?'disabled':'')+'>Carregar anteriores</button>':''));
 }
 async function get(next){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},15000);});
  try{return await Promise.race([(async()=>{const r=await fetch('/api/big-odds'+(next?'?cursor='+encodeURIComponent(next):''),{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('unavailable');return r.json();})(),timeout]);}
  finally{clearTimeout(timer);}
 }
 async function load(){
  if(loading)return;loading=true;
  try{const d=await get(),reset=data?.historyStartAt!==d.historyStartAt;data=d;const map=new Map((reset?[]:history).filter(t=>t.createdAt>=(d.historyStartAt||0)).map(t=>[t.id,t]));for(const t of d.history)map.set(t.id,t);history=[...map.values()].sort((a,b)=>b.createdAt-a.createdAt);if(reset||history.length<=50)cursor=d.nextCursor;$('#status').textContent='Atualizado '+stamp(d.at)+' · Lisboa';render();}
  catch{$('#status').textContent='Atualização indisponível · a tentar novamente';if(!data)$('#bigCurrent').innerHTML='<div class="empty error"><h3>Não foi possível carregar o Big Odds</h3><button id="bigRetry">Tentar novamente</button></div>';}finally{loading=false;}
 }
 document.addEventListener('load',e=>{if(e.target.tagName==='IMG')e.target.parentElement.classList.add('loaded');},true);
 document.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.remove();},true);
 document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.bigTab){document.querySelectorAll('[data-big-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));$('#bigCurrent').classList.toggle('hidden',b.dataset.bigTab!=='current');$('#bigHistory').classList.toggle('hidden',b.dataset.bigTab!=='history');$('#pageTitle').textContent=b.dataset.bigTab==='history'?'Histórico':'Big Odds';}
  if(b.id==='bigRetry')void load();
  if(b.id==='bigMore'&&cursor&&!busy){busy=true;render();try{const d=await get(cursor),map=new Map(history.map(t=>[t.id,t]));for(const t of d.history)map.set(t.id,t);history=[...map.values()].sort((a,b)=>b.createdAt-a.createdAt);cursor=d.nextCursor;}catch{$('#status').textContent='Não foi possível carregar os boletins anteriores.';}finally{busy=false;render();}}
 });
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void load();});setInterval(()=>void load(),60000);void load();
}
export async function bigOddsPage(response,integrateSports){
 if(!response.ok)return response;
 let html=integrateSports(await response.text(),false);
 html=html.replace('FOOTBALL INTELLIGENCE','BIG ODDS · FUTEBOL').replace('LUXTIPS<span> / </span>FUTEBOL','LUXTIPS<span> / </span>BIG ODDS');
 html=html.replace(/<script>[\s\S]*?<\/script>/g,'').replace(/<title>[^<]*<\/title>/,'<title>Big Odds · LuxTips</title>');
 html=html.replace('<a href="/" aria-current="page"','<a href="/"').replace('<a href="/big-odds"','<a href="/big-odds" aria-current="page"');
 const main='<main id="main" class="shell"><nav class="tabs section-nav" aria-label="Secções"><button data-big-tab="current" aria-selected="true">Boletim</button><button data-big-tab="history" aria-selected="false">Histórico</button></nav><div class="page-heading"><div><p class="eyebrow">FUTEBOL · MÚLTIPLA</p><h1 id="pageTitle">Big Odds<span class="title-dot">.</span></h1></div><div id="status" class="status" role="status">A carregar…</div></div><p class="small big-schedule">Seleção às 08h · mantém-se enquanto estiver em curso.</p><section id="bigCurrent" aria-label="Boletim atual"><div class="empty"><span class="loader" aria-hidden="true"></span>A carregar…</div></section><section id="bigHistory" class="hidden" aria-label="Histórico de boletins"></section></main>';
 html=html.replace(/<main id="main" class="shell">[\s\S]*?<\/main>/,main).replace('</head>',`<style>.big-schedule{color:var(--muted);margin:0 0 18px}.big-ticket{margin:0 0 32px}.big-ticket-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 0 20px;margin-bottom:20px;border-bottom:1px solid var(--line)}.big-ticket-heading h2{font-size:16px;font-weight:600;margin:0}.big-ticket-heading p{color:var(--muted);font-size:11px;margin:6px 0 0}.big-total{text-align:right;flex:none}.big-total strong{display:block;color:var(--accent);font-size:28px;line-height:1.15;font-variant-numeric:tabular-nums}.big-total .small{display:block}.big-more{padding:12px 20px;background:var(--panel);border:1px solid var(--line);border-radius:10px}.big-history-ticket{border:1px solid var(--line);border-radius:14px;margin:0 0 14px;background:var(--panel);overflow:hidden}.big-history-ticket>summary{display:flex;align-items:center;gap:16px;cursor:pointer;padding:18px 20px;list-style:none;min-height:84px}.big-history-ticket>summary::-webkit-details-marker{display:none}.big-history-ticket>summary::marker{content:""}.big-history-info{flex:1;min-width:0}.big-history-info>strong{display:block;font-size:15px}.big-history-info>span{display:block;color:var(--muted);font-size:11px;margin-top:5px}.big-history-odd{text-align:right;flex:none}.big-history-odd>strong{font-size:24px;color:var(--accent);font-variant-numeric:tabular-nums}.big-history-chevron{color:var(--muted);font-size:20px}.big-history-ticket[open]>summary .big-history-chevron{transform:rotate(180deg)}.big-history-content{padding:0 16px 16px}.big-history-content .big-ticket{margin-bottom:0}.big-history-content .big-ticket-heading{padding-top:16px}.big-history-ticket>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}.big-leg{display:flex;flex-direction:column;align-self:start}.big-leg .match-meta{height:54px;min-height:54px;flex:none}.big-leg .competition{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.big-leg .match-teams{grid-template-columns:minmax(0,1fr) 76px minmax(0,1fr);padding:22px 14px 18px;height:174px;align-items:start}.big-leg .team-name{height:38px;min-height:38px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.big-leg .pick-row{min-height:96px;height:96px;margin-bottom:12px}.big-leg .pick strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.big-leg .match-result{min-height:22px;margin-bottom:12px}.big-leg>.analysis-details{margin-top:0}@media(min-width:900px){.big-ticket .grid:has(>.match-card:nth-child(2):last-child) .match-teams{padding-top:22px;padding-bottom:18px}.big-ticket .grid:has(>.match-card:nth-child(2):last-child) .crest{width:70px;height:70px}.big-ticket .grid:has(>.match-card:nth-child(2):last-child) .crest img{width:56px;height:56px;inset:7px}.big-ticket .grid:has(>.match-card:nth-child(2):last-child) .team-name{font-size:13px}}@media(max-width:620px){.big-leg .match-teams{padding-left:10px;padding-right:10px;grid-template-columns:minmax(0,1fr) 68px minmax(0,1fr)}.big-total strong{font-size:26px}}</style></head>`);
 html=decorateFrontOffice(html,'bigodds').replace('</body>','<script>'+[esc,stableDom,analysisDetails,disclosureEvents].map(f=>f.toString()).join('\n')+';('+bigOddsClient.toString()+')(stableDom,analysisDetails,disclosureEvents);</script></body>');
 const headers=new Headers(response.headers);headers.delete('Content-Length');headers.delete('ETag');headers.set('Cache-Control','no-store');
 return new Response(injectPwa(html),{status:response.status,headers});
}
