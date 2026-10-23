import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {testDatabase} from './sqlite.mjs';
import {retainedQuotes,extractQuotes,collectFixtureOdds,cachedOdds} from '../src/context/odds.mjs';
import {marketReference} from '../src/context/features.mjs';
import {winnerAnalysis,winnerResponse} from '../src/context/winners.mjs';
import {CONTEXT_VERSION} from '../src/context/model.mjs';
import {publishMarketPicks,WINNER_MARKETS} from '../src/context/selection.mjs';
import {publishDailyPicks} from '../src/legacy-worker.mjs';
import {evaluationRecord,evaluateRows} from '../src/context/evaluation.mjs';
import {lisbonDay,POLICY} from '../src/context/policy.mjs';
import worker from '../src/worker.mjs';
const now=Date.now(),DAY=86400000;
function db(){const d=testDatabase();d.sql.exec('ALTER TABLE fixtures ADD COLUMN updated_at INTEGER;CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);');for(const m of ['0002_publication_archive.sql','0003_context_live.sql','0004_match_details.sql'])d.sql.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));return d;}
function quote(id,code,odd,bookmaker='Book',at=now-1000){return {fixtureId:id,code,market:code,selection:code,source:'API-Football',verifiedReceipt:true,bookmaker,odd,at,providerAt:at,observedAt:now,providerMarket:'Match Winner',providerSelection:{H:'Home',D:'Draw',A:'Away'}[code]};}
function game(id=1){return {selectionContract:'selection-inputs-v2',fixture:{id,ts:now+DAY,league:39,home:id,away:id+100,homeName:'Casa',awayName:'Fora',status:'NS',finished:false},sourceUpdatedAt:now,
 prediction:{version:CONTEXT_VERSION,cutoff:now,sample:20,probabilities:{H:.65,D:.2,A:.15,U45:.95},risks:[],contextAdjustment:{uncertainty:{spread:{H:.02,D:.01,A:.01,U45:.01}}}},odds:{H:quote(id,'H',1.6),U45:{...quote(id,'U45',1.4),providerMarket:'Goals Over/Under',providerSelection:'Under 4.5'}}};}
function store(d,g){d.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?,?)').run(g.fixture.id,g.fixture.league,g.fixture.ts,0,JSON.stringify(g.fixture),now);d.sql.prepare('INSERT INTO cache VALUES(?,?,?)').run('forecast:'+g.fixture.id,JSON.stringify(g),g.fixture.ts+DAY);}
function reference(f,hs=[1.5,1.6]){return marketReference(hs.flatMap((h,i)=>['H','D','A'].map((k,j)=>({...quote(f.id,k,[h,4,6][j],'Book'+i),market:'1X2',selection:k}))),f,now);}
function payload(id,books){return [{fixture:{id},update:new Date(now-1000).toISOString(),bookmakers:books.map((values,i)=>({name:'Book'+i,bets:[{name:'Match Winner',values:['Home','Draw','Away'].map((value,j)=>({value,odd:String(values[j])}))}]}))}];}

test('full same-book triplets survive best-price selection and produce a normalized market reference',()=>{
 const f=game().fixture,quotes=extractQuotes(payload(1,[[1.5,4,7],[1.6,3.8,6]]),f,now,true);
 const kept=retainedQuotes(quotes,now);assert.equal(kept.length,6);
 const r=marketReference(kept.map(q=>({...q,market:'1X2',selection:q.code})),f,now);
 assert.equal(r.books,2);assert.ok(Math.abs(r.probabilities.H+r.probabilities.D+r.probabilities.A-1)<1e-12);
 assert.equal(r.at,now-1000);assert.equal(r.observedAt,now);
});
test('market reference counts each book once, rejects conflicts, expiry and mixed timestamps',()=>{
 const f=game().fixture,qs=extractQuotes(payload(1,[[1.5,4,7]]),f,now,true).map(q=>({...q,market:'1X2',selection:q.code}));
 assert.equal(marketReference([...qs,...qs.map(q=>({...q,providerAt:q.providerAt-1000}))],f,now).books,1);
 assert.equal(marketReference([...qs,{...qs[0],odd:1.8}],f,now).books,0);
 assert.equal(marketReference(qs,f,now+POLICY.oddsMaxAge).books,0);
 assert.equal(marketReference(qs.map((q,i)=>i===0?{...q,providerAt:q.providerAt-1000}:q),f,now).books,0);
});
test('unverified raw cached responses never acquire verified receipt status',async()=>{
 const d=db(),g=game();store(d,g);d.sql.prepare('INSERT INTO cache VALUES(?,?,?)').run('api:odds?fixture=1',JSON.stringify({fetchedAt:now,items:payload(1,[[1.5,4,7]])}),now+DAY);
 const prices=await cachedOdds(d,g.fixture,now);assert.deepEqual(prices.odds,{});assert.ok(prices.quotes.every(q=>!q.verifiedReceipt));d.sql.close();
});
test('collection preserves complete reference books across pages, retries and a fresh database read',async()=>{
 const d=db(),g=game();store(d,g);let calls=0;
 const request=async()=>({data:payload(1,[calls++===0?[1.5,4,7]:[1.6,3.8,6]]).map(p=>({...p,bookmakers:p.bookmakers.map(b=>({...b,name:'Page'+calls}))})),fetchedAt:now,paging:{current:calls,total:2}});
 const first=await collectFixtureOdds({DB:d},g.fixture,now,request);assert.equal(first.status,'incomplete_response');
 await collectFixtureOdds({DB:d},g.fixture,now+61000,request);
 const prices=await cachedOdds(d,g.fixture,now+61000),r=marketReference(prices.quotes.filter(q=>q.verifiedReceipt).map(q=>({...q,market:'1X2',selection:q.code})),g.fixture,now+61000);
 assert.equal(r.books,2);assert.equal(prices.odds.H.odd,1.6);
 assert.equal(d.sql.prepare('SELECT count(*) n FROM openfoot_market_quotes').get().n,6);d.sql.close();
});
test('negative EV stays informational for fresh and expired quotes and never becomes recommended',()=>{
 const g=game();g.odds.H.odd=1.5;
 let a=winnerAnalysis(g,now);assert.ok(a);assert.equal(a.status,'analysis-only');assert.ok(a.value.expectedReturn<0);assert.equal(a.value.eligible,false);
 g.odds.H.at=now-POLICY.oddsMaxAge;a=winnerAnalysis(g,now);assert.ok(a);assert.equal(a.quoteStatus,'quote_expired');assert.equal(a.value.expectedReturn,null);assert.equal(a.value.eligible,false);
 g.odds.H=quote(1,'H',1.55);a=winnerAnalysis(g,now);assert.ok(a.value.rawExpectedReturn>0);assert.ok(a.value.expectedReturn<0);assert.equal(a.value.eligible,false);
});
test('nonnegative EV below the recommendation threshold stays informational',()=>{
 const g=game(),before=structuredClone(g),a=winnerAnalysis(g,now);
 assert.equal(a.status,'analysis-only');assert.equal(a.quote.odd,1.6);assert.equal(a.value.eligible,false);assert.ok(a.value.expectedReturn>=0);assert.deepEqual(g,before);
});
test('market reference cannot admit a model favourite below60 even with positive EV',()=>{
 const g=game();g.prediction.probabilities={H:.58,D:.25,A:.17};g.prediction.contextAdjustment.market=reference(g.fixture);g.odds.H.odd=2;
 assert.equal(winnerAnalysis(g,now),null);
});
test('away winners and disagreement are explicit; unknown or stale reference cannot manufacture a favourite',()=>{
 const g=game();g.prediction.probabilities={H:.3,D:.2,A:.5};g.odds.H=quote(1,'H',1.5);g.prediction.contextAdjustment.market=reference(g.fixture);
 assert.equal(winnerAnalysis(g,now),null);
 g.prediction.contextAdjustment.market.at=now-POLICY.oddsMaxAge;assert.equal(winnerAnalysis(g,now),null);
 g.prediction.probabilities={H:.15,D:.2,A:.65};g.odds.A=quote(1,'A',1.7);const a=winnerAnalysis(g,now);assert.equal(a.market,'A');assert.equal(a.label,'Fora vence');assert.equal(a.value.eligible,true);
});
test('analysis rejects inadequate model inputs while unusable prices never become recommendations',()=>{
 const changes=[g=>g.prediction.sample=11,g=>g.prediction.version='old',g=>g.prediction.probabilities.D=.4,g=>g.sourceUpdatedAt=now+1,g=>g.prediction.cutoff=now+1,g=>g.fixture.ts=now,g=>g.odds.H.odd=1.24];
 for(const change of changes){const g=game();change(g);assert.equal(winnerAnalysis(g,now),null);}
 for(const change of [g=>g.odds.H.fixtureId=99,g=>g.odds.H.observedAt=now+1,g=>g.odds.H.verifiedReceipt=false]){const g=game();change(g);const a=winnerAnalysis(g,now);assert.equal(a.quote,null);assert.equal(a.value.eligible,false);assert.equal(a.value.expectedReturn,null);}
});
test('winner-only runtime publication chooses a qualified victory instead of a higher probability goals market',async()=>{
 for(const publish of [(d,gs)=>publishMarketPicks(d,gs,now,{markets:WINNER_MARKETS}), (d,gs)=>publishDailyPicks(d,gs,now)]){
  const d=db(),g=game();g.prediction.probabilities={H:.75,D:.15,A:.1,U45:.95};g.odds.H.odd=1.5;store(d,g);
  await publish(d,[g]);const rows=d.sql.prepare('SELECT * FROM openfoot_current_picks').all();assert.equal(rows.length,1);assert.equal(rows[0].market,'H');assert.equal(rows[0].alternative,0);assert.equal(JSON.parse(rows[0].data).selectionPolicy,'winner-1x2-v1');d.sql.close();
 }
});
test('old goal picks do not consume new winner capacity and are never rewritten',async()=>{
 const d=db(),g=game();g.prediction.probabilities={H:.75,D:.15,A:.1};g.odds.H.odd=1.5;store(d,g);
 for(let i=2;i<5;i++){const old=game(i);d.sql.prepare('INSERT INTO published_picks VALUES(?,?,?,?,?,?,?,?,?)').run(lisbonDay(g.fixture.ts),i,g.fixture.ts,'U45',1,now-1000,now-1000,0,JSON.stringify(old));}
 const before=d.sql.prepare('SELECT data FROM published_picks ORDER BY fixture_id').all();await publishDailyPicks(d,[g],now);
 assert.equal(d.sql.prepare("SELECT count(*) n FROM openfoot_current_picks WHERE market='H'").get().n,1);assert.deepEqual(d.sql.prepare('SELECT data FROM published_picks ORDER BY fixture_id').all(),before);d.sql.close();
});
test('public winner response is pure read-only, returns unpriced-by-value analyses and keeps completed partial days actionable',async()=>{
 const d=db(),g=game();store(d,g);const day=lisbonDay(g.fixture.ts);d.sql.prepare('INSERT INTO openfoot_state VALUES(?,?)').run('publication_day:'+day,JSON.stringify({at:now,status:'partial_available',pending:[{id:9}]}));
 const prepare=d.prepare.bind(d);d.prepare=q=>{assert.ok(q.trim().startsWith('SELECT'),q);return prepare(q);};
 const response=await winnerResponse(d,now);assert.equal(response.winnerAnalyses.length,1);assert.equal(response.games.length,0);assert.equal(response.analysis.days[day].updating,false);assert.equal(response.analysis.days[day].partial,true);
 let jobs=0;const http=await worker.fetch(new Request('https://test/api/games'),{DB:d,PREDICTION_CONTEXT_MODE:'live'},{waitUntil(){jobs++;}});assert.equal(http.status,200);assert.equal(http.headers.get('cache-control'),'no-store');assert.equal(jobs,0);
 assert.equal((await worker.fetch(new Request('https://test/api/games',{method:'POST'}),{DB:d,PREDICTION_CONTEXT_MODE:'live'},{})).status,405);d.sql.close();
});
test('captured complete market reference is scored prospectively on exactly paired outcomes',()=>{
 const g=game();g.prediction.contextAdjustment.market=reference(g.fixture);
 const h=[{id:99,league:39,ts:now-DAY,hg:1,ag:0,finished:true,status:'FT'}];
 g.evaluation=evaluationRecord(g,h,[{updated_at:now-1}],{},[],now,'a'.repeat(64));
 const report=evaluateRows([{data:g,createdAt:now,current:{...g.fixture,finished:true,status:'FT',hg:1,ag:0}}],[]);
 assert.equal(report.marketComparison.byMarket.H.comparison.n,1);assert.equal(report.marketComparison.byMarket.H.comparison.model.n,report.marketComparison.byMarket.H.comparison.reference.n);
 const changed=structuredClone(g);changed.evaluation.marketReference.observedAt=now+1;
 assert.deepEqual(evaluateRows([{data:changed,createdAt:now,current:{...g.fixture,finished:true,status:'FT',hg:1,ag:0}}],[]).marketComparison.byMarket,{});
});

test('real browser script distinguishes a published winner, model-only analysis and old goal selections, escaping team names',async()=>{
 const html=await(await worker.fetch(new Request('https://test/'),{},{})).text();const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 const clock=Date.parse(lisbonDay(now)+'T10:00:00Z'),g=game();g.fixture.ts=clock+3600000;g.fixture.homeName='<img src=x onerror=alert(1)>';
 const analysis=winnerAnalysis(game(),now);analysis.quote.at=clock-1000;analysis.quote.observedAt=clock;analysis.label='<script>bad</script> vence';
 const published={...g,published:{at:clock-1000},displayTip:{market:'H',label:'Casa vence',probability:.7,odd:1.5,bookmaker:'Book',priceEligible:true,risks:[]},winnerTip:{majority:true}};
 const old={...published,fixture:{...g.fixture,id:2},displayTip:{...published.displayTip,market:'U45',label:'Menos de 4,5 golos'}};
 const elements=new Map(),element=()=>({innerHTML:'',textContent:'',value:'',options:[],append(o){this.options.push(o);},addEventListener(){},classList:{toggle(){}},setAttribute(){}});
 const document={querySelector(k){if(!elements.has(k))elements.set(k,element());return elements.get(k);},querySelectorAll(){return [];},createElement:element,addEventListener(){}};
 class Clock extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
 await new Script(script).runInNewContext({document,location:{hostname:'luxtips.90carlosmachado.workers.dev'},Date:Clock,AbortSignal,setInterval(){},fetch:async url=>({ok:true,json:async()=>url==='/api/games'?{games:[published,old],winnerAnalyses:[{fixture:{...g.fixture,id:3},winnerAnalysis:analysis},{fixture:{...g.fixture,id:4},winnerAnalysis:{...analysis,quote:null,quoteStatus:'awaiting_quote'}},{fixture:{...g.fixture,id:5},winnerAnalysis:{...analysis,quote:{...analysis.quote,at:clock-7*3600000},quoteStatus:'quote_expired'}}],competitions:[],analysis:{days:{}}}:{ready:true,sync:{at:clock,ok:true}}})});
 const cards=elements.get('#cards').innerHTML;assert.ok(cards.includes('class="card pick"'));assert.ok(cards.includes('&lt;img src=x'));assert.ok(cards.includes('Sem recomendação de aposta'));assert.ok(cards.includes('Odd desatualizada'));assert.ok(cards.includes('Sem cotação verificada'));assert.ok(cards.includes('&lt;script&gt;bad'));assert.ok(!cards.includes('<script>bad'));assert.ok(!cards.includes('Menos de 4,5 golos'));assert.ok(!cards.includes('<img src=x'));
});

test('concurrent winner publication keeps three winner slots despite legacy alternatives and preserves settled snapshots',async()=>{
 const d=db(),gs=[1,2,3,4,5].map(id=>{const g=game(id);g.prediction.probabilities={H:.75,D:.15,A:.1};g.odds.H.odd=1.5;store(d,g);return g;});
 for(let i=20;i<23;i++){const g=game(i);d.sql.prepare('INSERT INTO published_picks VALUES(?,?,?,?,?,?,?,?,?)').run(lisbonDay(g.fixture.ts),i,g.fixture.ts,'U45',1,now-1000,now-1000,0,JSON.stringify(g));}
 await Promise.all([publishDailyPicks(d,gs,now),publishMarketPicks(d,gs,now,{markets:WINNER_MARKETS})]);await publishDailyPicks(d,gs,now+1000);
 assert.equal(d.sql.prepare("SELECT count(*) n FROM openfoot_current_picks WHERE market IN ('H','A')").get().n,3);
 const immutable=d.sql.prepare('SELECT data FROM openfoot_pick_revisions WHERE fixture_id=1').get().data;
 const current={...gs[0].fixture,finished:true,status:'FT',hg:2,ag:0};d.sql.prepare('UPDATE fixtures SET finished=1,data=? WHERE id=1').run(JSON.stringify(current));
 const response=await winnerResponse(d,now),saved=response.games.find(g=>g.fixture.id===1);assert.equal(saved.result.hit,1);assert.equal(saved.currentFixture.status,'FT');assert.deepEqual(saved.prediction,JSON.parse(immutable).prediction);assert.equal(d.sql.prepare('SELECT data FROM openfoot_pick_revisions WHERE fixture_id=1').get().data,immutable);d.sql.close();
});


test('expiry retains the football analysis and original price but cannot supply current EV or a recommendation',()=>{
 const g=game();g.odds.H.odd=2;g.odds.H.at=now-POLICY.oddsMaxAge;g.odds.H.providerAt=g.odds.H.at;
 const a=winnerAnalysis(g,now);assert.equal(a.modelProbability,.65);assert.equal(a.quote.odd,2);assert.equal(a.quote.at,g.odds.H.at);assert.equal(a.quoteStatus,'quote_expired');assert.equal(a.value.eligible,false);assert.equal(a.value.expectedReturn,null);assert.equal(a.value.rawExpectedReturn,null);
 delete g.odds.H;const missing=winnerAnalysis(g,now);assert.equal(missing.quote,null);assert.equal(missing.quoteStatus,'awaiting_quote');assert.equal(missing.modelProbability,.65);
});
test('last verified database quote survives forecast-cache price removal without becoming an executable recommendation',async()=>{
 const d=db(),g=game();delete g.odds.H;store(d,g);
 d.sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)').run(1,g.fixture.ts,'LastBook','Match Winner','Home',1.8,now-7*3600000,now-6*3600000);
 const r=await winnerResponse(d,now),a=r.winnerAnalyses[0].winnerAnalysis;assert.equal(a.quote.odd,1.8);assert.equal(a.quote.bookmaker,'LastBook');assert.equal(a.value.eligible,false);assert.equal(a.quoteStatus,'awaiting_recalculation');assert.equal(a.value.expectedReturn,null);
 const before=d.sql.prepare('SELECT data FROM cache').get().data;await winnerResponse(d,now);assert.equal(d.sql.prepare('SELECT data FROM cache').get().data,before);d.sql.close();
});
