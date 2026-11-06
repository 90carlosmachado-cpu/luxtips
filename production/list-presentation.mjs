import {stableDom} from './stable-dom.mjs';
import {footballEnhancements} from './front-office.mjs';
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
    .replace("if(status==='changed')return {kind:'void',label:'Jogo alterado',hit:null};", "if(status==='changed')return {kind:'void',label:g.rescheduledTo?'Reagendado para '+new Date(g.rescheduledTo).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Jogo alterado',hit:null};")
    .replace("const pending=s.entries.filter(g=>historyOutcome(g).kind==='pending'), settled=s.entries.filter(g=>historyOutcome(g).kind!=='pending');", "const voided=s.entries.filter(g=>historyOutcome(g).kind==='void'), pending=s.entries.filter(g=>historyOutcome(g).kind==='pending'), settled=s.entries.filter(g=>['win','loss'].includes(historyOutcome(g).kind));")
    .replace("const groups=(pending.length?", "const groups=(voided.length?'<section class=\"history-group\"><h2>Reagendados/Anulados</h2>'+grouped(voided)+'</section>':'')+(pending.length?")
    .replace("const grouped=(entries)=>{let last='';return entries.map", "const grouped=(entries)=>{let last='';return [...entries].sort((a,b)=>a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id).map")
    .replace('const stale=!settled','const stale=!!g.quoteStale||!settled')
    .replace('const outcome=historical?historyOutcome(g):null,recovered=',"const outcome=(historical||['changed','cancelled'].includes(g.historyStatus))?historyOutcome(g):null,recovered=")
    .replace("(historical?'<div class=\"match-result\">'","(historical||outcome?.kind==='void'?'<div class=\"match-result\">'")
    .replace(refresh,"          render();\n          if (!document.querySelector('#history').classList.contains('hidden')) await history();\n        } catch (e) {");
  return footballEnhancements(output);
}

