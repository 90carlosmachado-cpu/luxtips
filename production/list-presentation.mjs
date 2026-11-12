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
  const entries=uniqueHistory(rows),outcomes=entries.map(historyOutcome);
  const correct=outcomes.filter(o=>o.hit===1).length,wrong=outcomes.filter(o=>o.hit===0).length,total=correct+wrong;
  return {entries,correct,wrong,total,rate:total?100*correct/total:null,pending:outcomes.filter(o=>o.kind==='pending').length,reconstructed:entries.filter(g=>g.history?.provenance==='reconstructed').length};
}
export function syncFootballPresentation(html) {
  const running='g.fixture.ts>now&&!ids.has(g.fixture.id)';
  const refresh='          render();\n        } catch (e) {';
  const dayButtons=`days.map((day,i)=>'<button data-day="'+day+'" aria-selected="'+(chosenDay===day)+'">'+names[i]+'</button>').join('')`;
  if(!html.includes(running)||!html.includes(refresh)||!html.includes(dayButtons))throw Error('football_list_ui_anchor_missing');
  const output=html.replace('<script>','<script>const stableDom='+stableDom.toString()+';')
    .replace(dayButtons,`days.map((day,i)=>{const count=displayedGames(games,winnerAnalyses,day,league,now).games.length;return '<button data-day="'+day+'" aria-selected="'+(chosenDay===day)+'" aria-label="'+names[i]+', '+count+' '+(count===1?'jogo':'jogos')+'">'+names[i]+' · '+count+'</button>';}).join('')`)
    .replace('</head>','<style>@media(max-width:620px){.days button{white-space:normal;min-width:0}}</style></head>')
    .replace(/(\$\('#(?:cards|dayNav)'\))\.innerHTML=([^\n]*);/g,(_,target,value)=>'stableDom('+target+','+value+');')
    .replace(running,'(g.fixture.ts>now||g.dailyList?.locked)&&!g.result&&!ids.has(g.fixture.id)')
    .replace("const pending=s.entries.filter(g=>historyOutcome(g).kind==='pending'), settled=s.entries.filter(g=>historyOutcome(g).kind!=='pending');", "const voided=s.entries.filter(g=>historyOutcome(g).kind==='void'), pending=s.entries.filter(g=>historyOutcome(g).kind==='pending'), settled=s.entries.filter(g=>['win','loss'].includes(historyOutcome(g).kind));")
    .replace("const groups=(pending.length?", "const groups=(voided.length?'<section class=\"history-group\"><h2>Reagendados/Anulados</h2>'+grouped(voided)+'</section>':'')+(pending.length?")
    .replace("const grouped=(entries)=>{let last='';return entries.map", "const grouped=(entries)=>{let last='';return [...entries].sort((a,b)=>a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id).map")
    .replace('const stale=!settled','const stale=!!g.quoteStale||!settled')
    .replace('const outcome=historical?historyOutcome(g):null,recovered=',"const outcome=(historical||['changed','cancelled'].includes(g.historyStatus))?historyOutcome(g):null,recovered=")
    .replace("(historical?'<div class=\"match-result\">'","(historical||outcome?.kind==='void'?'<div class=\"match-result\">'")
    .replace(refresh,"          render();\n          if (!document.querySelector('#history').classList.contains('hidden')) await history();\n        } catch (e) {");
  const start=output.indexOf('function historyOutcome(g)'),end=output.indexOf('function crest(',start);
  if(start<0||end<0)throw Error('football_history_ui_anchor_missing');
  const historyCode=[historyPick,historyOutcome,uniqueHistory,historySummary].map(fn=>fn.toString()).join('\n');
  return footballEnhancements(output.slice(0,start)+historyCode+'\n'+output.slice(end));
}

