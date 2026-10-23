// Focus the existing UI on 1X2. Historical cards retain their original markets.
export function winnerUI(html){
 html=html.replace('<h1>Os prognósticos.</h1>','<h1>Quem tem mais hipóteses de vencer?</h1>')
  .replace('Seleções do dia · odds registadas ≥ 1,25.','Vitórias casa ou fora · análise e recomendações separadas · odds ≥ 1,25.')
  .replace('let analysisByDay = {};','let analysisByDay = {};\n      let winnerAnalyses = [];')
  .replace('games = d.games;','games = d.games;\n          winnerAnalyses = d.winnerAnalyses || [];');
 html=html.replace('<h3 class="selection">${esc(pickLabel(g))}</h3>', '<h3 class="selection">${esc(pickLabel(g))}</h3>${scoreline(g)}');
 const start=html.indexOf('      function render() {'),end=html.indexOf('      async function loadGames() {',start);
 if(start<0||end<0)throw Error('winner_ui_anchor_missing');
 const render=`      function scoreline(g) {
        const s=g.prediction?.luxg?.topScores?.[0]??g.winnerAnalysis?.mostLikelyScore;
        const valid=s&&Number.isInteger(s.home)&&s.home>=0&&Number.isInteger(s.away)&&s.away>=0&&Number.isFinite(s.probability)&&s.probability>0&&s.probability<=1;
        return '<p class="scoreline">Resultado exato mais provável: <strong>'+(valid?s.home+'–'+s.away+' · '+(100*s.probability).toFixed(1).replace('.',',')+'%':'Indisponível')+'</strong></p>';
      }
      function winnerCard(g) {
        const a=g.winnerAnalysis,q=a.quote,f=g.fixture;
        const percentage=p=>Number.isFinite(p)?(100*p).toFixed(1)+'%':'Indisponível';
        const stamp=t=>new Date(t).toLocaleString('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
        const stale=!!q&&(a.quoteStatus==='quote_expired'||a.quoteStatus==='awaiting_recalculation'||Date.now()-q.at>=6*3600000);
        const awaiting=!q||stale;
        const value=awaiting?'A aguardar atualização da odd':a.value.eligible?'Candidata com valor estimado':'Sem recomendação de aposta';
        const reason=awaiting?'A análise mantém-se visível; sem uma odd recente não há recomendação nem valor esperado atual.':a.value.reason==='insufficient_probability'?'O modelo não atinge 60%.':a.value.reason==='insufficient_expected_return'?'A odd não compensa a estimativa e a reserva do modelo.':'Critérios de valor avaliados separadamente da probabilidade.';
        return '<article class="card"><div class="fixture-meta"><span>'+esc(f.competition||'')+'</span><time>'+esc(stamp(f.ts))+'</time></div><p class="teams">'+esc(f.homeName)+' · '+esc(f.awayName)+'</p><h3>'+esc(a.label)+'</h3>'+scoreline(g)+'<p>Modelo <strong>'+percentage(a.modelProbability)+'</strong><br>Mercado sem margem <strong>'+percentage(a.marketProbability)+'</strong></p><span class="tag">'+esc(a.basis==='market-reference'?'Favorito do mercado':'Favorito do modelo')+'</span><p class="price"><span>Odd registada · '+esc(q?.bookmaker||'A aguardar cotação')+'</span><b>'+(q?q.odd.toFixed(2):'—')+'</b></p><p class="small">'+(q?'Cotação '+esc(stamp(q.at))+' · Lisboa':'Sem cotação verificada')+'</p>'+(stale?'<p class="price-note warn">Odd desatualizada — a aguardar atualização</p>':'')+'<details><summary>'+value+'</summary><p>'+esc(reason)+'</p><p>Retorno esperado após reserva: '+(!awaiting&&Number.isFinite(a.value.expectedReturn)?(100*a.value.expectedReturn).toFixed(1)+'%':'Indisponível')+'</p>'+(a.value.minimumOdd?'<p>Odd mínima segundo o modelo: '+(Math.ceil(a.value.minimumOdd*100)/100).toFixed(2)+'</p>':'')+'<p class="small">'+esc(a.note)+(a.disagreement?' Modelo e mercado discordam sobre o favorito.':'')+'</p></details></article>';
      }
      function render() {
        const now=Date.now(),days=dayKeys(now),league=Number($('#league').value);
        if(!days.includes(chosenDay))chosenDay=days[0];
        const names=['Hoje','Amanhã','Depois de amanhã'];
        $('#dayNav').innerHTML=days.map((day,i)=>'<button data-day="'+day+'" aria-selected="'+(chosenDay===day)+'">'+names[i]+'</button>').join('');
        const onDay=g=>localDay(g.fixture.ts)===chosenDay&&(!league||g.fixture.league===league);
        const picks=games.filter(g=>onDay(g)&&g.published&&['H','A'].includes((g.displayTip||g.winnerTip)?.market));
        const publishedIds=new Set(picks.map(g=>g.fixture.id));
        const analyses=winnerAnalyses.filter(g=>onDay(g)&&g.fixture.ts>now&&!publishedIds.has(g.fixture.id));
        $('#dayTitle').textContent=names[days.indexOf(chosenDay)];
        $('#best').innerHTML='<h3>Recomendações de vitória</h3><p class="small">'+(picks.length?picks.length+' seleções publicadas.':'Sem recomendações de vitória que cumpram todos os critérios neste momento.')+'</p>';
        const empty=analysisByDay[chosenDay]?.updating?'<div class="empty wide"><h3>Análise em atualização</h3><p>A recolher os dados disponíveis para este dia.</p></div>':'<div class="empty wide"><h3>Análise concluída</h3><p>Sem vitórias prováveis com dados suficientes neste momento.</p></div>';
        $('#cards').innerHTML=picks.map(card).join('')+'<div class="wide"><h3>Vitórias mais prováveis</h3><p class="small">Análise informativa. Uma equipa favorita pode não oferecer uma aposta com valor.</p></div>'+(analyses.length?analyses.map(winnerCard).join(''):empty);
      }
`;
 html=html.slice(0,start)+render+html.slice(end);
 return html.replace('Até três jogos por dia, uma seleção por jogo e várias alternativas possíveis.','Até três recomendações de vitória por dia, uma por jogo. A análise dos favoritos não equivale a uma recomendação.');
}
