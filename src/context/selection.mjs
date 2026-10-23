import {forecastWindow,marketLabel,publicGames} from '../legacy-worker.mjs';
import {selectionAssessment,CONTEXT_VERSION} from './model.mjs';
import {MARKETS,lisbonDay as dayOf} from './policy.mjs';
import {dayReadiness} from './readiness.mjs';

export const MARKET_POLICY='independent-markets-v1';
// Handicap quotes are deliberately excluded: their supplier sign convention
// has not been verified. Each fixture can contribute only one selection.


export function marketCandidates(g,now){
 const p=g.prediction,f=g.fixture;
 if(!p||!f||f.finished||f.status!=='NS'||f.ts<=now||f.ts>=forecastWindow(now).end||!Number.isFinite(p.sample)||p.sample<12||
   !Number.isFinite(g.sourceUpdatedAt)||g.sourceUpdatedAt>now||now-g.sourceUpdatedAt>24*3600000)return [];
 return MARKETS.flatMap(market=>{
  const probability=p.probabilities?.[market],minimum=['H','A'].includes(market)?.6:.7;
  if(!Number.isFinite(probability)||probability<minimum||probability>1)return [];
  const assessment=selectionAssessment({...g,displayTip:{market,probability}},now);
  if(!assessment.eligible)return [];
  const q=g.odds[market];
  return [{market,probability,assessment,label:marketLabel(market,f),odd:q.odd,bookmaker:q.bookmaker,oddsAt:q.at}];
 }).sort((a,b)=>b.assessment.conservativeProbability-a.assessment.conservativeProbability||b.assessment.expectedReturn-a.assessment.expectedReturn||a.market.localeCompare(b.market));
}

export async function publishMarketPicks(db,games,now,options={}){
 const token=now+120000;
 if(!await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('publication',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(token,now).first())return {published:0,status:'locked'};
 try{return await publishAvailable(db,games,now,options);}finally{await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='publication' AND until=?").bind(token).run();}
}
async function publishAvailable(db,games,now,options){
 const w=forecastWindow(now);
 const rows=options.rows||(await db.prepare("SELECT f.data fixture_data,c.data FROM fixtures f LEFT JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff").bind(now,w.end).all()).results;
 const readiness=await dayReadiness(db,rows,now,w.days);
 // All entry points rank the same stored day pool, not a caller's partial batch.
 if(rows.length)games=publicGames(rows.filter(r=>r.data),now).games.filter(g=>g.prediction?.version===CONTEXT_VERSION&&g.selectionContract==='selection-inputs-v2');
 const saved=await db.prepare('SELECT day,fixture_id,recovered FROM openfoot_current_picks WHERE day>=? AND day<=? UNION ALL SELECT day,fixture_id,0 recovered FROM openfoot_current_alternatives WHERE day>=? AND day<=?').bind(w.days[0],w.days[2],w.days[0],w.days[2]).all();
 const decisions=games.map(g=>({fixtureId:g.fixture.id,day:dayOf(g.fixture.ts),reason:readiness[dayOf(g.fixture.ts)]?.status==='waiting'?'waiting_for_day_pool':'assessed',markets:Object.fromEntries(MARKETS.map(m=>[m,selectionAssessment({...g,displayTip:{market:m}},now).reason]))}));
 const existing=new Set(saved.results.map(r=>r.fixture_id));
 const candidates=games.filter(g=>!existing.has(g.fixture.id)&&readiness[dayOf(g.fixture.ts)]?.status!=='waiting').flatMap(g=>{
  const tip=marketCandidates(g,now)[0];return tip?[{g,tip,day:dayOf(g.fixture.ts)}]:[];
 }).sort((a,b)=>b.tip.assessment.conservativeProbability-a.tip.assessment.conservativeProbability||b.tip.assessment.expectedReturn-a.tip.assessment.expectedReturn||a.g.fixture.ts-b.g.fixture.ts||a.g.fixture.id-b.g.fixture.id);
 let published=0;
 for(const {g,tip,day} of candidates){
  if(saved.results.filter(r=>r.day===day).length>=3)continue;
  const publishedAt=Math.max(now,Date.now());
  const currentAssessment=selectionAssessment({...g,displayTip:{market:tip.market}},publishedAt);
  if(!currentAssessment.eligible){const decision=decisions.find(d=>d.fixtureId===g.fixture.id);if(decision)decision.reason=currentAssessment.reason;continue;}
  const alternative=!['H','A'].includes(tip.market);
  const data={...g,selectionPolicy:MARKET_POLICY,displayTip:{...tip,selectionType:alternative?'market-selection':'winner-tip',priceEligible:true,minimumMarketOdd:1.25,
   expectedValue:tip.probability*tip.odd-1,calibrationStatus:'Avaliação prospetiva em curso',
   reason:'Mercado avaliado diretamente pela probabilidade, dados disponíveis, odd recente e vantagem após divergência entre componentes.',risks:g.prediction.risks||[]}};
  const write=await db.prepare(`INSERT OR IGNORE INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data)
   SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM openfoot_current_picks WHERE fixture_id=?)
   AND NOT EXISTS(SELECT 1 FROM openfoot_current_alternatives WHERE fixture_id=?)
   AND (SELECT COUNT(*) FROM openfoot_current_picks WHERE day=?)+(SELECT COUNT(*) FROM openfoot_current_alternatives WHERE day=?)<3
   AND (julianday('now')-2440587.5)*86400000<?
   AND NOT EXISTS(SELECT 1 FROM fixtures f WHERE f.id=? AND (f.finished=1 OR f.kickoff<>? OR json_extract(f.data,'$.home')<>? OR json_extract(f.data,'$.away')<>? OR json_extract(f.data,'$.status')<>'NS'))`).bind(day,g.fixture.id,g.fixture.ts,tip.market,alternative?1:0,publishedAt,publishedAt,JSON.stringify(data),g.fixture.id,g.fixture.id,day,day,g.fixture.ts,g.fixture.id,g.fixture.ts,g.fixture.home,g.fixture.away).run();
  if(write.meta?.changes){published++;saved.results.push({day,fixture_id:g.fixture.id,recovered:0});}
  else{const decision=decisions.find(d=>d.fixtureId===g.fixture.id);if(decision)decision.reason='publication_conditions_changed';}
 }
 for(const d of decisions)if(existing.has(d.fixtureId))d.reason='already_published';else if(saved.results.some(r=>r.fixture_id===d.fixtureId))d.reason='published';else if(d.reason==='assessed')d.reason=saved.results.filter(r=>r.day===d.day).length>=3?'daily_capacity_reached':'no_eligible_market';
 await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind('publication_decisions',JSON.stringify({at:now,decisions})).run();
 return {published,policy:MARKET_POLICY,days:readiness};
}
