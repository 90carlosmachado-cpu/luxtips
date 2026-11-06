import {readDailyLists,syncDailyLists,listDay,listWindow,membership,snapshotPayload,LIST_VERSION,dayLocked} from './daily-list.mjs';
import {validWinnerQuote,filterWinnerAnalyses,QUOTE_MAX_AGE} from './quote-gate.mjs';
const pickOf=g=>g.history?.kind==='analysis'||!g.published&&g.winnerAnalysis?g.winnerAnalysis:g.displayTip||g.winnerTip||g.recommendation;
export const footballKey=g=>`${g.fixture?.id}:${g.fixture?.ts}:${pickOf(g)?.market}`;
function cleanCard(g,kind) {
  const fields=['fixture','winnerAnalysis','displayTip','winnerTip','recommendation','published','sourceUpdatedAt','updatedAt'];
  const card=Object.fromEntries(fields.filter(k=>g[k]!==undefined).map(k=>[k,g[k]]));
  return {...card,history:{kind,provenance:kind==='analysis'?'listed':'published'},historyStatus:'pending',result:null};
}
export function footballCandidates(body,now) {
  const cards=[];
  for(const g of body.games||[]) {
    const pick=pickOf(g),q=g.odds?.[pick?.market];
    if(!g.published||!['H','A'].includes(pick?.market)||!q?.verifiedReceipt||q.source!=='API-Football'||q.market!==pick.market||q.selection!==pick.market||q.fixtureId!==g.fixture?.id)continue;
    if(!Number.isFinite(q.odd)||q.odd<1.20||!Number.isFinite(q.at)||!Number.isFinite(q.observedAt)||q.at>q.observedAt||q.observedAt>now||g.fixture.ts<=now)continue;
    const assessment=pick.assessment;
    if(!pick.selectionVersion&&Number.isFinite(assessment?.conservativeProbability)&&Number.isFinite(assessment?.minimumExpectedReturn)&&q.odd*assessment.conservativeProbability-1+1e-12<assessment.minimumExpectedReturn)continue;
    const card=cleanCard(g,'recommendation'),field=g.displayTip?'displayTip':g.winnerTip?'winnerTip':'recommendation';
    card[field]={...pick,odd:q.odd,bookmaker:q.bookmaker,oddsAt:q.at};
    if(Number.isFinite(assessment?.conservativeProbability))card[field].assessment={...assessment,odd:q.odd,expectedReturn:q.odd*assessment.conservativeProbability-1};
    if(!Number.isFinite(pick.decisionProbability)||pick.selectionVersion!=='winner-1x2-r1-r2-v2')continue;
    cards.push(card);
  }
  return cards.map(g=>({id:footballKey(g),gameId:g.fixture.id,kickoff:g.fixture.ts,payload:g,kind:g.history.kind}));
}
async function currentPublishedPrices(db,body,now) {
  const games=[];
  for(const g of body.games) {
    const pick=pickOf(g),f=g.fixture;
    if(!g.published||!f||!['H','A'].includes(pick?.market)){games.push(g);continue;}
    // This table contains verified collector receipts, not untrusted raw caches.
    const row=await db.prepare(`SELECT bookmaker,market,selection,odd,provider_at,observed_at FROM openfoot_market_quotes
      WHERE fixture_id=? AND kickoff=? AND market='Match Winner' AND selection=?
      AND provider_at<=observed_at AND observed_at<=? AND observed_at<?
      ORDER BY provider_at DESC,odd DESC,bookmaker LIMIT 1`)
      .bind(f.id,f.ts,pick.market==='H'?'Home':'Away',now,f.ts).first();
    if(!row){games.push(g);continue;}
    const q={fixtureId:f.id,code:pick.market,source:'API-Football',verifiedReceipt:true,market:pick.market,selection:pick.market,providerMarket:row.market,providerSelection:row.selection,bookmaker:row.bookmaker,odd:row.odd,at:row.provider_at,observedAt:row.observed_at};
    games.push({...g,odds:{...g.odds,[pick.market]:q}});
  }
  const winnerAnalyses=[];
  for(const g of body.winnerAnalyses) {
    const a=g.winnerAnalysis,f=g.fixture;
    const row=await db.prepare(`SELECT bookmaker,odd,provider_at,observed_at FROM openfoot_market_quotes
      WHERE fixture_id=? AND kickoff=? AND market='Match Winner' AND selection=?
      AND provider_at<=observed_at AND observed_at<=? AND observed_at<?
      ORDER BY provider_at DESC,odd DESC,bookmaker LIMIT 1`)
      .bind(f.id,f.ts,a.market==='H'?'Home':'Away',now,f.ts).first();
    if(!row){winnerAnalyses.push(g);continue;}
    const quote={odd:row.odd,bookmaker:row.bookmaker,at:row.provider_at,observedAt:row.observed_at};
    winnerAnalyses.push({...g,winnerAnalysis:{...a,quote,quoteStatus:now-quote.at>=QUOTE_MAX_AGE?'quote_expired':'ready'}});
  }
  return {...body,games,winnerAnalyses};
}
export async function syncFootballList(db,body,now=Date.now()) {
  if(!Array.isArray(body.games)||!Array.isArray(body.winnerAnalyses))throw Error('incomplete_football_feed');
  // Re-read the current publications: a response obtained before a replacement
  // must not restore the archived card during a slower list synchronization.
  const days=listWindow(now);
  const current=await db.prepare("SELECT data,published_at FROM openfoot_current_picks WHERE day>=? AND day<=? AND market IN ('H','A')").bind(days[0],days[2]).all();
  body={...body,games:current.results.map(row=>({...JSON.parse(row.data),published:{at:row.published_at,alternative:false}}))};
  const priced=await currentPublishedPrices(db,body,now),candidates=footballCandidates(priced,now);
  const keys=new Set(candidates.map(c=>c.id));
  const lists=await readDailyLists(db,'openfoot_state','football');
  for(const old of lists.flatMap(l=>l.items)) {
    if(keys.has(old.id)||old.kickoff<=now)continue;
    if(pickOf(old.payload)?.selectionVersion==='winner-1x2-r1-r2-v2')continue;
    const pick=pickOf(old.payload);
    let current=body.winnerAnalyses.find(g=>g.fixture.id===old.gameId&&g.fixture.ts===old.kickoff);
    if(!current) {
      const cached=await db.prepare('SELECT data FROM cache WHERE key=?').bind('forecast:'+old.gameId).first();
      const g=cached?JSON.parse(cached.data):null,p=g?.prediction,prob=p?.probabilities;
      const side=prob&&Object.keys(prob).filter(k=>['H','D','A'].includes(k)).sort((a,b)=>prob[b]-prob[a])[0];
      if(g?.fixture?.ts===old.kickoff&&side===pick.market&&prob[side]>=.6)
        current={fixture:g.fixture,winnerAnalysis:{market:side,modelProbability:prob[side],quote:null}};
    }
    // Source/quote ageing is not a new negative model decision. The cache
    // preserves the last calculation when the raw feed omits aged inputs.
    if(!current||current.winnerAnalysis.market!==pick.market||current.winnerAnalysis.modelProbability<.6)continue;
    const row=await db.prepare(`SELECT odd,provider_at,observed_at FROM openfoot_market_quotes
      WHERE fixture_id=? AND kickoff=? AND market='Match Winner' AND selection=?
      AND provider_at<=observed_at AND observed_at<=? AND observed_at<?
      ORDER BY provider_at DESC,odd DESC,bookmaker LIMIT 1`)
      .bind(old.gameId,old.kickoff,pick.market==='H'?'Home':'Away',now,old.kickoff).first();
    const q=row?{odd:row.odd,at:row.provider_at,observedAt:row.observed_at}:current.winnerAnalysis.quote;
    if(q&&q.odd<1.20)continue;
    if(q&&now-q.at<QUOTE_MAX_AGE)continue; // Fresh prices must pass normal entry filters.
    const probability=current.winnerAnalysis.modelProbability;
    const assessment=pick.assessment;
    if(old.kind==='recommendation'&&Number.isFinite(assessment?.minimumExpectedReturn)&&
      Number.isFinite(assessment?.conservativeProbability)&&
      (pick.odd||q?.odd)*Math.min(probability,assessment.conservativeProbability)-1<assessment.minimumExpectedReturn)continue;
    candidates.push(old);keys.add(old.id);
  }
  const withdrawnIds=await invalidFootballItems(db,[...candidates,...lists.flatMap(l=>l.items)]);
  return syncDailyLists(db,'openfoot_state','football',candidates.filter(c=>!withdrawnIds.includes(c.id)),now,withdrawnIds);
}
async function invalidFootballItems(db,items) {
  const invalid=[];
  for(const item of items) {
    const row=await db.prepare('SELECT data FROM fixtures WHERE id=?').bind(item.gameId).first();
    if(!row)continue;
    const f=JSON.parse(row.data),saved=item.payload.fixture;
    if(f.ts!==item.kickoff||f.home!==saved.home||f.away!==saved.away||['CANC','ABD','AWD','WO'].includes(f.status))invalid.push(item.id);
  }
  return [...new Set(invalid)];
}
export async function hydrateFootballList(db,items,now) {
  const unique=[...new Set(items.map(x=>x.gameId))],byId=new Map();
  for(let start=0;start<unique.length;start+=100) {
    const ids=unique.slice(start,start+100);
    const rows=await db.prepare(`SELECT f.id,f.data,r.hg,r.ag,r.fixture_id result_id FROM fixtures f LEFT JOIN results r ON r.fixture_id=f.id WHERE f.id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all();
    for(const row of rows.results)byId.set(row.id,row);
  }
  return items.map(item=>{
    const g=snapshotPayload(item),f=g.fixture,row=byId.get(f.id),current=row?JSON.parse(row.data):null;
    const pick=pickOf(g),quoteAt=pick?.quote?.at??pick?.oddsAt;
    g.quoteStale=f.ts>now&&Number.isFinite(quoteAt)&&now-quoteAt>=QUOTE_MAX_AGE;
    if(current && (current.ts!==f.ts||current.home!==f.home||current.away!==f.away))return !item.lockedAt&&!dayLocked(listDay(f.ts),now)?null:{...g,historyStatus:'changed',rescheduledTo:current.ts!==f.ts?current.ts:null,result:null};
    if(current && ['CANC','ABD','AWD','WO'].includes(current.status))return !item.lockedAt&&!dayLocked(listDay(f.ts),now)?null:{...g,historyStatus:'cancelled',result:null};
    if(!row?.result_id||f.ts>=now||!Number.isInteger(row.hg)||!Number.isInteger(row.ag))return {...g,historyStatus:'pending',result:null};
    const hit=Number(pick.market==='H'?row.hg>row.ag:row.ag>row.hg);
    return {...g,result:{home:row.hg,away:row.ag},historyStatus:'settled',analysisHit:hit,displayHit:hit,winnerHit:hit,hit};
  }).filter(Boolean);
}
export async function footballCurrentFeed(db,body,now=Date.now()) {
  const lists=await readDailyLists(db,'openfoot_state','football');
  if(!lists.length)return {...body,winnerAnalyses:[]};
  const tracked=new Map(lists.map(l=>[l.day,l])),days=new Set(listWindow(now));
  const cards=await hydrateFootballList(db,lists.filter(l=>days.has(l.day)).flatMap(l=>l.items),now);
  const active=cards.filter(g=>g.historyStatus==='pending');
  return {...body,
    games:[...(body.games||[]).filter(g=>!tracked.has(listDay(g.fixture.ts))||g.fixture.ts<=tracked.get(listDay(g.fixture.ts)).managedSince),...active.filter(g=>g.history.kind==='recommendation')],
    winnerAnalyses:[],
    dailyMembership:membership(lists),dailyListPolicy:{version:LIST_VERSION,timeZone:'Europe/Lisbon',freezeHour:8}};
}
export async function footballHistoryFeed(db,body,now=Date.now()) {
  const lists=await readDailyLists(db,'openfoot_state','football');
  if(!lists.length)return body;
  const tracked=new Map(lists.map(l=>[l.day,l]));
  const original=body.historyEntries||body.publishedSelections||[];
  const historical=original.filter(g=>!g.fixture||!tracked.has(listDay(g.fixture.ts))||g.fixture.ts<=tracked.get(listDay(g.fixture.ts)).managedSince);
  const cards=await hydrateFootballList(db,lists.flatMap(l=>l.items),now);
  const entries=[...historical,...cards].sort((a,b)=>b.fixture.ts-a.fixture.ts||a.fixture.id-b.fixture.id);
  return {...body,historyEntries:entries,publishedSelections:entries.filter(g=>g.history?.kind!=='analysis'),dailyMembership:membership(lists)};
}

