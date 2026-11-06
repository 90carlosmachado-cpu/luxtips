export function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function dayChips(days,labels,selected,counts){
 return days.map((day,i)=>{const n=Number.isInteger(counts[i])&&counts[i]>=0?counts[i]:0;
 return '<button type="button" role="tab" tabindex="'+esc(day===selected?0:-1)+'" aria-controls="cards" data-day="'+esc(day)+'" aria-selected="'+esc(day===selected)+'" aria-label="'+esc(labels[i]+', '+n+' '+(n===1?'jogo':'jogos'))+'"><span>'+esc(labels[i])+'</span><span class="day-badge" aria-hidden="true">'+esc(n)+'</span></button>';}).join('');
}
export function analysisDetails(p,esc,key=''){
 const probability=p?.decisionProbability??p?.modelProbability??p?.probability;
 const r1r2=p?.selectionVersion==='winner-1x2-r1-r2-v2';
 if(!Number.isFinite(probability)||probability<0||probability>1)return '';
 const q=p.quote||{},odd=q.odd??p.odd,book=q.bookmaker??p.bookmaker;
 const implied=Number.isFinite(odd)&&odd>1?1/odd:null;
 const pct=n=>(100*n).toLocaleString('pt-PT',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
 const decimal=n=>n.toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2});
 const row=(label,n,cls)=>'<div class="analysis-meter"><div><span>'+esc(label)+'</span><strong>'+esc(pct(n))+'</strong></div><div class="meter-track" role="img" aria-label="'+esc(label+': '+pct(n))+'"><span class="'+esc(cls)+'" style="width:'+esc(100*n)+'%"></span></div></div>';
 const expected=p.expectedReturn??p.value?.expectedReturn??p.assessment?.expectedReturn;
 const minimum=p.minimumExpectedReturn??p.value?.minimumExpectedReturn??p.assessment?.minimumExpectedReturn;
 const books=p.referenceBooks??p.assessment?.referenceBooks;
 let note=implied===null?'Sem cotação suficiente para comparar com o modelo.':probability<implied?'O modelo atribui uma probabilidade inferior à implícita nesta odd. Isto não indica vantagem de preço.':probability>implied?'O modelo atribui uma probabilidade superior à implícita nesta odd. A diferença é uma estimativa, não uma garantia de resultado.':'O modelo e a probabilidade implícita nesta odd estão alinhados.';
 if(r1r2)note=(Number.isFinite(p.marketProbability)?'Decisão: 50% modelo + 50% consenso de mercado. Limiar: 65%.':'Sem consenso válido: modelo com pelo menos 70% e amostra 12.')+(p.samplePolicy==='r2-market-anchor-4'?' R2: amostra entre 4 e 12; consenso de mercado de pelo menos 70%.':'')+' O retorno estimado é informativo e não é um filtro de publicação.';
 if(p.disagreement===true)note+=' O favorito do modelo difere do favorito do consenso de mercado.';
 if(p.disagreement===false&&Number.isInteger(books)&&books>0)note+=' O modelo e o consenso de mercado apontam o mesmo favorito.';
 const open=typeof document!=='undefined'&&/^(?:current|history):\d+$/.test(key)&&document.querySelector('details[data-analysis-key="'+key+'"]')?.open===true;
 return '<details class="analysis-details" data-analysis data-analysis-key="'+esc(key)+'"'+(open?' open':'')+'><summary role="button" aria-expanded="'+esc(!!open)+'"><span class="analysis-closed">Ver análise</span><span class="analysis-open">Fechar análise</span><span class="analysis-chevron" aria-hidden="true">⌄</span></summary><div class="analysis-panel">'+row(r1r2?'Probabilidade de decisão · R1+R2':'Probabilidade do modelo',probability,'model-meter')+(r1r2&&Number.isFinite(p.modelProbability)?row('Modelo',p.modelProbability,'market-meter'):'')+(r1r2&&Number.isFinite(p.marketProbability)?row('Consenso de mercado · sem margem',p.marketProbability,'market-meter'):'')+(implied===null?'':row('Implícita na odd · sem retirar margem',implied,'market-meter'))+'<dl>'+(Number.isFinite(odd)?'<div><dt>Cotação de referência</dt><dd>'+esc(decimal(odd))+(book?' · '+esc(book):'')+'</dd></div>':'')+(Number.isInteger(books)&&books>0?'<div><dt>Casas consultadas</dt><dd>'+esc(books)+'</dd></div>':'')+(Number.isFinite(expected)?'<div><dt>Retorno esperado estimado</dt><dd class="'+(expected>=0?'return-positive':'return-negative')+'">'+esc((expected>0?'+':'')+pct(expected))+'</dd></div>':'')+(Number.isFinite(minimum)?'<div><dt>Limiar da recomendação</dt><dd>'+esc(pct(minimum))+'</dd></div>':'')+'</dl><p>'+esc(note)+'</p></div></details>';
}
export function disclosureEvents(){
 document.addEventListener('keydown',e=>{
  const button=e.target.closest?.('#dayNav [data-day]');if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  const buttons=[...document.querySelectorAll('#dayNav [data-day]')],i=buttons.indexOf(button);
  const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:buttons.length-1))%buttons.length;
  e.preventDefault();buttons[next].click();buttons[next].focus();
 });
 document.addEventListener('toggle',e=>{
  const panel=e.target;if(!panel.matches?.('details[data-analysis]'))return;
  const summary=panel.querySelector('summary');summary.setAttribute('aria-expanded',String(panel.open));
  if(panel.open&&window.matchMedia('(max-width:620px)').matches){const r=summary.getBoundingClientRect();if(r.top<0||r.bottom>window.innerHeight)summary.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}
 },true);
}
export function yesterdayFootball(games,analyses,day,league,now){
 const onDay=g=>fixtureDay(g.fixture.ts)===day&&(!league||g.fixture.league===league);
 if(day<localDay(now))return {analyses:[],games:uniqueHistory(historyEntries).filter(onDay).sort((a,b)=>a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id)};
 const picks=games.filter(g=>onDay(g)&&g.published&&['H','A'].includes((g.displayTip||g.winnerTip)?.market));
 const ids=new Set(picks.map(g=>g.fixture.id));
 const visibleAnalyses=analyses.filter(g=>onDay(g)&&(g.fixture.ts>now||g.dailyList?.locked)&&!g.result&&!ids.has(g.fixture.id));
 return {analyses:visibleAnalyses,games:[...picks,...visibleAnalyses].sort((a,b)=>a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id)};
}
export function footballRender(){
 const now=Date.now(),days=dayKeys(now),league=Number($('#league').value);
 if(!days.includes(chosenDay))chosenDay=localDay(now);
 const labels=['Ontem','Hoje','Amanhã','Depois de amanhã'];
 stableDom($('#dayNav'),dayChips(days,labels,chosenDay,days.map(d=>displayedGames(games,winnerAnalyses,d,league,now).games.length)));
 const visible=displayedGames(games,winnerAnalyses,chosenDay,league,now),past=chosenDay<localDay(now);
 $('#dayTitle').innerHTML=esc(new Date(chosenDay+'T12:00:00Z').toLocaleDateString('pt-PT',{timeZone:'Europe/Lisbon',day:'numeric',month:'long'}));
 $('#gameCount').innerHTML=esc(visible.games.length+' '+(visible.games.length===1?'jogo':'jogos'));
 let empty=analysisByDay[chosenDay]?.updating?'<div class="empty wide"><h3>Análise em atualização</h3><p>Os prognósticos surgem assim que estiverem disponíveis.</p></div>':'<div class="empty wide"><h3>Sem prognósticos para este dia</h3><p>Volte mais tarde.</p></div>';
 if(past&&yesterdayLoad!=='ready')empty='<div class="empty wide" role="status"><h3>'+(yesterdayLoad==='error'?'Não foi possível carregar o histórico':'A carregar o histórico')+'</h3>'+(yesterdayLoad==='error'?'<button type="button" id="retryYesterday">Tentar novamente</button>':'')+'</div>';
 stableDom($('#cards'),past&&yesterdayLoad!=='ready'?empty:visible.games.length?visible.games.map(g=>matchCard(g,past)).join(''):empty);
 void captureShownAnalyses(visible.analyses);
}
export async function refreshYesterday(){
 const request=++yesterdayRequest;
 try{
  const response=await fetch(API+'/api/history',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('history_unavailable');
  const data=await response.json();if(request!==yesterdayRequest)return;
  historyEntries=data.historyEntries||data.publishedSelections||[];yesterdayLoad='ready';
  render();if(!document.querySelector('#history').classList.contains('hidden'))renderHistory();
 }catch{
  if(request!==yesterdayRequest)return;if(yesterdayLoad!=='ready')yesterdayLoad='error';render();
 }
}
function replaceSection(html,start,end,replacement){const a=html.indexOf(start),b=html.indexOf(end,a);if(a<0||b<0)throw Error('front_office_anchor_missing:'+start);return html.slice(0,a)+replacement+'\n'+html.slice(b);}
export function footballEnhancements(html){
 const helpers='const dayChips='+dayChips.toString()+';const analysisDetails='+analysisDetails.toString()+';'+refreshYesterday.toString()+';('+disclosureEvents.toString()+')();let yesterdayLoad="loading",yesterdayRequest=0;';
 html=html.replace('<script>','<script>'+helpers);
 html=html.replace('FUTEBOL · 1X2','FUTEBOL · R1+R2 · ATÉ 3 POR DIA');
 html=html.replace("const stale=!settled&&f.ts>Date.now()&&analysis&&pick.quote&&(['quote_expired','awaiting_recalculation'].includes(pick.quoteStatus)||Date.now()-pick.quote.at>=6*3600000);","const quoteAt=analysis?pick.quote?.at:pick.oddsAt;const stale=!settled&&f.ts>Date.now()&&Number.isFinite(quoteAt)&&(g.quoteStale||Date.now()-quoteAt>=6*3600000);");
 html=html.replace('return [0, 1, 2].map((i) =>','return [-1, 0, 1, 2].map((i) =>');
 html=replaceSection(html,'function displayedGames(','function historyOutcome(',yesterdayFootball.toString().replace('function yesterdayFootball(','function displayedGames('));
 html=replaceSection(html,'function render()','async function loadGames()',footballRender.toString().replace('function footballRender(','function render('));
 const mark='async function loadGames() {\n        try {';if(!html.includes(mark))throw Error('history_load_anchor_missing');
 html=html.replace(mark,'async function loadGames() {\n        void refreshYesterday();\n        try {');
 html=html.replace("        renderHistory();\n      }",'        yesterdayLoad="ready";renderHistory();render();\n      }');
 const end="')+'</article>';";if(!html.includes(end))throw Error('analysis_card_anchor_missing');
 html=html.replace(end,"')+(historical?'':analysisDetails(pick,esc,'current:'+Number(f.id)))+'</article>';");
 html=html.replace('      loadGames();\n    </script>','      document.addEventListener("click",e=>{if(e.target.closest("#retryYesterday"))void loadGames();});\n      loadGames();\n    </script>');
 return html;
}
export const responsibleNotice='<div class="responsible-notice"><span class="age-badge" aria-label="Maiores de 18 anos">18+</span><div><p>Prognósticos com fins informativos. Não garantimos resultados.</p><a href="https://www.jogoresponsavel.pt" target="_blank" rel="noopener">Joga com responsabilidade — jogoresponsavel.pt</a></div></div>';
export function howLink(){return '<a href="/como-funciona">Como funciona</a>';}
export function shareMeta(kind='football'){
 const big=kind==='bigodds',about=kind==='about',nba=kind==='nba',url='https://luxtips.90carlosmachado.workers.dev'+(about?'/como-funciona':big?'/big-odds':nba?'/nba':'/');
 const title=big?'Big Odds · LuxTips':about?'Como funciona · LuxTips':nba?'LuxTips · Prognósticos de NBA':'LuxTips · Prognósticos de futebol';
 const description=big?'Uma múltipla de cada vez, com odds registadas, resultados por seleção e histórico de boletins.':about?'Conhece os modelos, os critérios de seleção e as regras do histórico do LuxTips.':nba?'Prognósticos diários de NBA com odds registadas e histórico público.':'Prognósticos 1X2 diários com odds registadas e histórico público.';
 return '<meta name="description" content="'+esc(about||nba||big?description:'Prognósticos diários de futebol e Big Odds com odds registadas, taxa de acerto pública e histórico verificável.')+'"><link rel="canonical" href="'+esc(url)+'"><meta property="og:type" content="website"><meta property="og:site_name" content="LuxTips">'+['og:title','twitter:title'].map(k=>'<meta '+(k.startsWith('og:')?'property':'name')+'="'+esc(k)+'" content="'+esc(title)+'">').join('')+['og:description','twitter:description'].map(k=>'<meta '+(k.startsWith('og:')?'property':'name')+'="'+esc(k)+'" content="'+esc(description)+'">').join('')+'<meta property="og:url" content="'+esc(url)+'"><meta property="og:image" content="https://luxtips.90carlosmachado.workers.dev/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="LuxTips — Prognósticos de futebol e Big Odds"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://luxtips.90carlosmachado.workers.dev/og.png">';
}
export const frontStyle=`<style>
#cards>.match-card .match-teams{min-height:138px}#cards>.match-card .team-name{min-height:2.8em}#cards>.match-card .pick-row{min-height:104px}
@supports(grid-template-rows:subgrid){#cards>.match-card{display:grid;grid-template-rows:subgrid;grid-row:span 4;row-gap:0;align-content:start}#cards>.match-card>.match-meta{grid-row:1}#cards>.match-card>.match-teams{grid-row:2}#cards>.match-card>.pick-row{grid-row:3}#cards>.match-card>.analysis-details,#cards>.match-card>.match-result{grid-row:4}}
.days{padding-top:10px!important;overflow:visible;gap:16px 12px!important;flex-wrap:wrap}.days button{position:relative;overflow:visible!important;white-space:normal!important}.day-badge{position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;border:3px solid var(--bg);font-variant-numeric:tabular-nums;background:var(--accent);color:#141d0b}.days button[aria-selected=true] .day-badge{background:#0d1309;color:var(--accent)}
.analysis-details{border-top:1px solid var(--line);text-align:left}.analysis-details summary{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;list-style:none;padding:12px 18px;color:var(--cyan,#78dce8);font-size:12px;min-height:44px;box-sizing:border-box;scroll-margin:20px}.analysis-details summary::-webkit-details-marker{display:none}.analysis-open{display:none}.analysis-details[open] .analysis-open{display:inline}.analysis-details[open] .analysis-closed{display:none}.analysis-chevron{transition:transform .2s}.analysis-details[open] .analysis-chevron{transform:rotate(180deg)}.analysis-panel{padding:4px 18px 18px;font-size:12px;line-height:1.6}.analysis-meter{margin:12px 0}.analysis-meter>div:first-child{display:flex;justify-content:space-between;gap:12px}.meter-track{height:6px;background:var(--line);border-radius:8px;overflow:hidden;margin-top:6px}.meter-track>span{height:100%;display:block}.model-meter{background:var(--accent)}.market-meter{background:#8099aa}.analysis-panel dl{margin:16px 0}.analysis-panel dl>div{display:flex;justify-content:space-between;gap:14px;padding:6px 0}.analysis-panel dt{color:var(--muted)}.analysis-panel dd{margin:0;text-align:right;overflow-wrap:anywhere}.analysis-panel p{color:var(--muted);margin:12px 0 0}.return-positive{color:var(--accent)}.return-negative{color:#efbe70}
footer.shell{display:flex;flex-wrap:wrap;gap:18px}.responsible-notice{display:flex;align-items:center;gap:12px;font-size:11px;line-height:1.6;max-width:540px}.responsible-notice p{margin:0;color:var(--muted)}.responsible-notice a{color:#a8bcc9;text-decoration:underline dotted;text-underline-offset:4px;overflow-wrap:anywhere}.responsible-notice a:hover{color:var(--accent)}.age-badge{width:26px;height:26px;border:1.5px solid #5a6b78;border-radius:50%;display:grid;place-items:center;color:#93a5b1;font-size:8px;flex:none}.sports{flex-wrap:wrap}.new-badge{font-size:8px;color:var(--cyan,#78dce8);letter-spacing:.06em}.sports a{white-space:normal}.analysis-details summary:focus-visible,.days button:focus-visible,.responsible-notice a:focus-visible,.method-page a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.method-page{padding-top:48px;padding-bottom:48px}.method-hero{max-width:850px;margin-bottom:50px}.method-hero h1{font-size:clamp(32px,5vw,60px);line-height:1.1}.method-hero h1 em{font-style:normal;color:var(--accent)}.method-page p{color:var(--muted);line-height:1.8}.method-page h2{font-size:24px;margin:44px 0 20px}.method-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.method-grid.policy-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.method-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;min-width:0}.method-card h3{font-size:14px}.method-card .rule-number{font-size:32px;font-weight:800;color:var(--accent);overflow-wrap:anywhere}.method-card p{font-size:13px;margin-bottom:0}.method-checks{padding-left:24px;line-height:1.8;color:var(--muted)}.method-checks li{padding:8px}.method-checks li::marker{color:var(--accent)}
@media(max-width:1000px){.topbar{flex-wrap:wrap;height:auto;gap:16px;padding-top:18px;padding-bottom:18px}.method-grid.policy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.days{display:flex!important;gap:18px 12px!important;padding-right:8px;max-width:100%;box-sizing:border-box}.days button{flex:1 1 calc(50% - 12px);min-width:0;min-height:44px}.sports{gap:6px!important}.topbar .sports a{padding:10px 8px;font-size:12px;min-width:0}.topbar .sports a:last-child{flex-basis:100%}.pwa-panel{margin-left:auto}.method-grid,.method-grid.policy-grid{grid-template-columns:1fr}.method-page{padding-top:28px}.method-card{padding:20px}.analysis-panel dl>div{flex-wrap:wrap}.responsible-notice{align-items:flex-start;max-width:100%}footer.shell{flex-direction:column;align-items:flex-start}.match-card{min-width:0}}
@media(prefers-reduced-motion:reduce){.analysis-chevron{transition:none}}
</style>`;
export function decorateFrontOffice(html,kind='football'){
 if(kind==='nba'){
  html=html.replace('.sort((a,b)=>a.kickoff-b.kickoff);','.sort((a,b)=>(b.selectionConfidence||0)-(a.selectionConfidence||0)||a.kickoff-b.kickoff);');
  html=html.replace('<div class="page-heading">','<p class="small nba-policy">Favoritos NBA · 50% modelo + 50% mercado · mínimo 65% · odd ≥ 1,25 · sem limite diário.</p><div class="page-heading">');
 }
 html=html.replace(/(<nav\b[^>]*id="dayNav")/,'$1 role="tablist"').replace(/(<div\b[^>]*id="cards")/,'$1 role="tabpanel" aria-labelledby="dayTitle"');
 html=html.replace(/<meta\b[^>]*(?:name="(?:description|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/gi,'').replace(/<link\b[^>]*rel="canonical"[^>]*>/gi,'');
 html=html.replace('</head>',shareMeta(kind)+frontStyle+'</head>');
 html=html.replace(/(<footer\b[^>]*class="shell"[^>]*>[\s\S]*?)(<\/footer>)/,(_,content,end)=>content+responsibleNotice+end);
 return html;
}
export function methodContent(policy={}){
 const card=(n,title,text)=>'<article class="method-card"><div class="rule-number">'+esc(n)+'</div><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p></article>';
 return '<main id="main" class="shell method-page"><section class="method-hero"><p class="eyebrow">FOOTBALL INTELLIGENCE</p><h1>Modelo e mercado. <em>R1 + R2.</em></h1><p>Até três previsões de vitória 1X2 por dia, ordenadas pela probabilidade de decisão. Quando não existem três jogos elegíveis, publicamos menos.</p></section><section><h2>Política de seleção · Futebol</h2><div class="method-grid policy-grid">'+card('50 / 50','R1 · Modelo e mercado','A probabilidade de decisão combina 50% do modelo e 50% do consenso das casas, retirando a margem de cada trio 1X2 completo. Exigimos pelo menos 65%.')+card('4 / 12','R2 · Amostra condicionada','A amostra normal é 12. Entre 4 e 12, só admitimos a previsão com consenso de mercado de pelo menos 70% e decisão de pelo menos 65%. Abaixo de 4, não publicamos.')+card('≥ 70%','Sem consenso válido','Sem consenso recente e verificável, exigimos pelo menos 70% no modelo e amostra normal de 12. Não inventamos odds de execução.')+card('≥ 1,20','Odds reais e recentes','Preço registado na API-Football, com menos de seis horas, observado antes do início e com identidade do jogo validada.')+'</div><p>O retorno esperado e a divergência dos componentes são informativos. Não são filtros de publicação desta política. O modelo estatístico mantém os seus componentes ativos.</p></section><section><h2>Três melhores por dia</h2><p>Ordenamos os jogos elegíveis pela probabilidade de decisão; em empate, pela odd e depois pelo início e identidade do jogo. As três vagas incluem as seleções do dia que já começaram. Não há obrigação de preencher vagas sem jogos elegíveis. As seleções publicadas são preservadas no histórico; o bloqueio diário às 08h de Lisboa mantém as saídas existentes.</p><p>O Big Odds usa uma estratégia própria em avaliação: 5 a 12 seleções, odd total entre 8 e 15 e uma única múltipla ativa. Combina 50% do modelo e 50% da referência da casa sem margem. Usa xG com amostra suficiente e recorre aos golos quando falta cobertura; não publica mercados de menos golos. A seleção é feita apenas às 08h de Lisboa, com jogos de hoje e dos dois dias seguintes. Se existir um boletim em curso nessa hora, a seleção desse dia é ignorada. Mesmo que termine depois, só há nova tentativa às 08h do dia seguinte. Não reutilizamos jogos de boletins anteriores. O histórico conta apenas publicações reais, sem incluir simulações.</p></section><section><h2>Transparência</h2><p>A análise mostra separadamente a probabilidade de decisão, o modelo e o consenso disponível. As cotações podem mudar. As regras R1+R2 aplicam-se às novas publicações; os registos anteriores mantêm a política original.</p></section><section><h2>Joga com responsabilidade</h2>'+responsibleNotice+'<p>Uma previsão não garante o resultado nem lucro.</p></section></main>';
}

