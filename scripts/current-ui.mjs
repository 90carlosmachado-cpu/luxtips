import {runInNewContext} from 'node:vm';
function between(html,start,end,replacement){
 const a=html.indexOf(start),b=html.indexOf(end,a);
 if(a<0||b<0)throw Error('ui_anchor_missing');
 return html.slice(0,a)+replacement+html.slice(b);
}
export function currentUI(bundle){
 const start=bundle.indexOf('var index_default = '),end=bundle.indexOf(';\n',start);
 if(start<0||end<0)throw Error('html_literal_missing');
 let html=runInNewContext(bundle.slice(start+20,end),Object.create(null),{timeout:1000});
 html=html.replace('let chosenDay =','let analysisByDay = {};\n      let chosenDay =');
 html=html.replace('importsPending = d.imports?.pending || 0;', 'importsPending = d.imports?.pending || 0;\n          analysisByDay = d.analysis?.days || {};');
 html=html.replace('(importsPending\n', '(analysisByDay[chosenDay]?.updating\n');
 html=html.replace('A preparar as novas competições','Análise em atualização').replace('O histórico está a ser carregado. Os prognósticos surgem quando os dados e as odds estiverem verificados.','Os jogos deste dia ainda estão a ser analisados.');
 html=html.replace('Sem prognósticos elegíveis','Análise concluída').replace('Sem jogos que cumpram os requisitos de probabilidade, odds recentes e vantagem esperada para este dia.','Sem oportunidades que cumpram os critérios neste momento.');
 html=html.replace('b.winnerTip.probability - a.winnerTip.probability','(b.displayTip || b.winnerTip).probability - (a.displayTip || a.winnerTip).probability');
 html=html.replaceAll('Atualização automática · a cada minuto','Análise automática · página atualizada a cada 5 min');
 html=html.replace('Último prognóstico guardado antes de cada jogo, identificado como\n          final ou provisório.', 'Seleções efetivamente publicadas, preservadas com a odd registada.');
 html=html.replace('A evidência por trás do modelo','Avaliação do modelo');
 html=html.replaceAll('${esc(e.message)}','Dados temporariamente indisponíveis. A tentar novamente.');
 html=between(html,'      async function history() {','      async function validation() {',`      async function history() {
        const d = await get('/api/history');
        const selections = d.publishedSelections || [];
        $('#historyBody').innerHTML = selections.length ? '<div class="history-list">' + selections.map(f => {
          const pick=f.displayTip || f.winnerTip || f.recommendation;
          if(!pick)return '';
          const hit=f.displayTip ? f.displayHit : f.winnerTip ? f.winnerHit : f.hit;
          return '<article class="history-row"><span class="result '+(hit?'':'loss')+'">'+(hit?'Certo':'Errado')+'</span><strong>'+esc(pick.label)+'</strong><div class="small">'+esc(f.fixture.homeName)+' · '+esc(f.fixture.awayName)+'<br>'+date(f.fixture.ts)+' · Resultado '+f.result.home+'–'+f.result.away+' · '+(f.prediction?.version===d.activeModel?'Modelo atual':'Modelo anterior')+'</div></article>';
        }).join('')+'</div>' : '<p class="small">Ainda não há seleções publicadas com resultado confirmado.</p>';
      }
`);
 html=between(html,'      async function validation() {','      $("#league").addEventListener',`      async function validation() {
        await get('/api/validation');
        $('#validationBody').innerHTML = '<p>A avaliação do modelo atual está em curso. Os resultados de versões anteriores não demonstram a precisão desta versão.</p><p class="small">Até três jogos por dia, uma seleção por jogo e várias alternativas possíveis. Odds registadas de pelo menos 1,25. Nenhuma seleção é publicada para preencher vagas.</p>';
      }
`);
 return bundle.slice(0,start)+'var index_default = '+JSON.stringify(html)+bundle.slice(end);
}
