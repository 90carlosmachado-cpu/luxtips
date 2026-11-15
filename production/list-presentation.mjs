import {stableDom} from './stable-dom.mjs';
import {footballEnhancements} from './front-office.mjs';
export function historyOutcome(g) {
  const hit=g.history?.kind==='analysis'?g.analysisHit:g.displayTip?g.displayHit:g.winnerTip?g.winnerHit:g.hit;
  const status=g.historyStatus||'settled',r=g.result;
  if(status==='settled'&&r&&Number.isInteger(r.home)&&r.home>=0&&Number.isInteger(r.away)&&r.away>=0&&(hit===0||hit===1))
    return {kind:hit===1?'win':'loss',label:hit===1?'Certo':'Errado',hit};
  if(status==='changed')return {kind:'void',label:g.rescheduledTo?'Reagendado para '+new Date(g.rescheduledTo).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Jogo alterado',hit:null};
  if(status==='cancelled')return {kind:'void',label:'Anulado',hit:null};
  return {kind:'pending',label:'Por resolver',hit:null};
}
export function historyPick(g) {
  return g.history?.kind==='analysis'||(!g.published&&g.winnerAnalysis)?g.winnerAnalysis:g.displayTip||g.winnerTip||g.recommendation;
}
export function uniqueHistory(rows) {
  const seen=new Set();
  return rows.filter(g=>{
    const pick=historyPick(g);
    if(!g.fixture||!pick)return false;
    const key=[g.fixture.id,g.fixture.ts,pick.market].join(':');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
export function historySummary(rows) {
  const entries=uniqueHistory(rows).sort((a,b)=>b.fixture.ts-a.fixture.ts||a.fixture.id-b.fixture.id),outcomes=entries.map(historyOutcome);
  const correct=outcomes.filter(o=>o.hit===1).length,wrong=outcomes.filter(o=>o.hit===0).length,total=correct+wrong;
  return {entries,correct,wrong,total,rate:total?100*correct/total:null,pending:outcomes.filter(o=>o.kind==='pending').length,reconstructed:entries.filter(g=>g.history?.provenance==='reconstructed').length};
}
export function footballRenderHistory() {
  const s=historySummary(historyEntries),visible=s.entries.slice(0,historyVisibleCount);
  const rate=s.rate===null?'—':s.rate.toFixed(1).replace('.',',')+'<small>%</small>';
  const detail=s.total?s.correct+' certos em '+s.total+' resolvidos':'Ainda sem jogos resolvidos';
  const recent=s.entries.map(historyOutcome).filter(o=>o.hit!==null).slice(0,10);
  const form='<div class="recent-form" aria-label="Últimos dez resultados, do mais recente para o mais antigo"><span>Últimos '+recent.length+'</span>'+recent.map(o=>'<span class="form-dot '+o.kind+'" aria-label="'+o.label+'">'+(o.hit===1?'✓':'×')+'</span>').join('')+'</div>';
  let previousDay='';
  const cards=visible.map(g=>{
    const day=fixtureDay(g.fixture.ts),heading=day!==previousDay?'<h3 class="history-date">'+new Date(g.fixture.ts).toLocaleDateString('pt-PT',{timeZone:'Europe/Lisbon',day:'numeric',month:'long',year:'numeric'})+'</h3>':'';
    previousDay=day;
    return heading+matchCard(g,true);
  }).join('');
  const summary='<div class="history-summary"><div class="summary-main"><span class="rate">'+rate+'</span><div><span class="summary-title">Taxa de acerto</span><span class="summary-detail">'+detail+'</span></div></div><div class="summary-side"><div class="progress-track" aria-hidden="true"><span style="width:'+(s.rate??0)+'%"></span></div><span class="pending-count">'+s.pending+' por resolver</span></div></div>';
  $('#historyBody').innerHTML=summary+form+(visible.length?'<section class="history-group">'+cards+'</section>':'<div class="empty"><h3>O histórico começa aqui</h3><p>Os prognósticos apresentados ficam guardados automaticamente.</p></div>')+(visible.length<s.entries.length?'<button type="button" id="footballHistoryMore" class="history-more">Mostrar mais</button>':'');
}
export function syncFootballPresentation(html) {
  const running='g.fixture.ts>now&&!ids.has(g.fixture.id)';
  const refresh='          render();\n        } catch (e) {';
  const dayButtons=`days.map((day,i)=>'<button data-day="'+day+'" aria-selected="'+(chosenDay===day)+'">'+names[i]+'</button>').join('')`;
  if(!html.includes(running)||!html.includes(refresh)||!html.includes(dayButtons))throw Error('football_list_ui_anchor_missing');
  let output=html.replace('<script>','<script>const stableDom='+stableDom.toString()+';let historyVisibleCount=10;document.addEventListener("click",e=>{if(e.target.closest?.("#footballHistoryMore")){historyVisibleCount+=10;renderHistory();}});')
    .replace(dayButtons,`days.map((day,i)=>{const count=displayedGames(games,winnerAnalyses,day,league,now).games.length;return '<button data-day="'+day+'" aria-selected="'+(chosenDay===day)+'" aria-label="'+names[i]+', '+count+' '+(count===1?'jogo':'jogos')+'">'+names[i]+' · '+count+'</button>';}).join('')`)
    .replace('</head>','<style>@media(max-width:620px){.days button{white-space:normal;min-width:0}}</style></head>')
    .replace(/(\$\('#(?:cards|dayNav)'\))\.innerHTML=([^\n]*);/g,(_,target,value)=>'stableDom('+target+','+value+');')
    .replace(running,'(g.fixture.ts>now||g.dailyList?.locked)&&!g.result&&!ids.has(g.fixture.id)')
    .replace('const stale=!settled','const stale=!!g.quoteStale||!settled')
    .replace("const outcome=historical?historyOutcome(g):null,recovered=g.history?.provenance==='reconstructed';","const outcome=(historical||['changed','cancelled'].includes(g.historyStatus))?historyOutcome(g):null;")
    .replace(/\+\(recovered\?'<span class="reconstructed"[^>]*>[^<]*<\/span>':''\)/,'')
    .replace("(historical?'<div class=\"match-result\">'","(historical||outcome?.kind==='void'?'<div class=\"match-result\">'")
    .replace(refresh,"          render();\n          if (!document.querySelector('#history').classList.contains('hidden')) await history();\n        } catch (e) {");
  const renderStart=output.indexOf('function renderHistory()'),renderEnd=output.indexOf('async function history()',renderStart);
  if(renderStart<0||renderEnd<0)throw Error('football_history_render_anchor_missing');
  output=output.slice(0,renderStart)+footballRenderHistory.toString().replace('function footballRenderHistory()', 'function renderHistory()')+'\n      '+output.slice(renderEnd);
  const start=output.indexOf('function historyOutcome(g)'),end=output.indexOf('function crest(',start);
  if(start<0||end<0)throw Error('football_history_ui_anchor_missing');
  const historyCode=[historyOutcome,historyPick,uniqueHistory,historySummary].map(fn=>fn.toString()).join('\n');
  return footballEnhancements(output.slice(0,start)+historyCode+'\n'+output.slice(end));
}

