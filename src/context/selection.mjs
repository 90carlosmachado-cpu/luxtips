import {forecastWindow,marketLabel} from '../legacy-worker.mjs';
import {selectionAssessment} from './model.mjs';

export const MARKET_POLICY='independent-markets-v1';
// Handicap quotes are deliberately excluded: their supplier sign convention
// has not been verified. Each fixture can contribute only one selection.
const MARKETS=['H','A','HX','XA','O05','O15','O25','O35','U15','U25','U35','U45','BY','BN','HO05','AO05','HO15','AO15','HU15','AU15','HU25','AU25'];
const dayOf=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(ts);

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

export async function publishMarketPicks(db,games,now){
 const w=forecastWindow(now);
 const saved=await db.prepare('SELECT day,fixture_id,recovered FROM openfoot_current_picks WHERE day>=? AND day<=?').bind(w.days[0],w.days[2]).all();
 const existing=new Set(saved.results.map(r=>r.fixture_id));
 const candidates=games.filter(g=>!existing.has(g.fixture.id)).flatMap(g=>{
  const tip=marketCandidates(g,now)[0];return tip?[{g,tip,day:dayOf(g.fixture.ts)}]:[];
 }).sort((a,b)=>b.tip.assessment.conservativeProbability-a.tip.assessment.conservativeProbability||b.tip.assessment.expectedReturn-a.tip.assessment.expectedReturn||a.g.fixture.ts-b.g.fixture.ts||a.g.fixture.id-b.g.fixture.id);
 let published=0;
 for(const {g,tip,day} of candidates){
  if(saved.results.filter(r=>r.day===day&&!r.recovered).length>=3)continue;
  const alternative=!['H','A'].includes(tip.market);
  const data={...g,selectionPolicy:MARKET_POLICY,displayTip:{...tip,selectionType:alternative?'market-selection':'winner-tip',priceEligible:true,minimumMarketOdd:1.25,
   expectedValue:tip.probability*tip.odd-1,calibrationStatus:'Avaliação prospetiva em curso',
   reason:'Mercado avaliado diretamente pela probabilidade, dados disponíveis, odd recente e vantagem após divergência entre componentes.',risks:g.prediction.risks||[]}};
  const write=await db.prepare(`INSERT OR IGNORE INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data)
   SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM openfoot_current_picks WHERE day=? AND fixture_id=?)
   AND (SELECT COUNT(*) FROM openfoot_current_picks WHERE day=? AND recovered=0)<3`).bind(day,g.fixture.id,g.fixture.ts,tip.market,alternative?1:0,now,now,JSON.stringify(data),day,g.fixture.id,day).run();
  if(write.meta?.changes){published++;saved.results.push({day,fixture_id:g.fixture.id,recovered:0});}
 }
 return {published,policy:MARKET_POLICY};
}
