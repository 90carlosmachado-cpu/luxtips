import {forecastWindow,publicGames} from '../legacy-worker.mjs';
import {POLICY,quoteStatus,assessMarket,lisbonDay} from './policy.mjs';
import {CONTEXT_VERSION} from './model.mjs';

export const WINNER_ANALYSIS_VERSION='winner-analysis-v3';
const winner=p=>p.H>=p.A?'H':'A';
const distribution=p=>p&&['H','D','A'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)&&Math.abs(p.H+p.D+p.A-1)<1e-6;
export function winnerAnalysis(g,now){
 const f=g.fixture,p=g.prediction;
 if(!f||!Number.isFinite(f.ts)||!p||p.version!==CONTEXT_VERSION||f.finished||f.status!=='NS'||f.ts<=now||!distribution(p.probabilities)||!Number.isFinite(p.sample)||p.sample<POLICY.minimumSample||!Number.isFinite(p.cutoff)||p.cutoff>now||p.cutoff>=f.ts||!Number.isFinite(g.sourceUpdatedAt)||g.sourceUpdatedAt>now||now-g.sourceUpdatedAt>24*3600000)return null;
 const ref=p.contextAdjustment?.market;
 const marketValid=ref?.status==='available'&&ref.books>0&&distribution(ref.probabilities)&&Number.isFinite(ref.at)&&Number.isFinite(ref.observedAt)&&ref.at<=ref.observedAt&&ref.observedAt<=p.cutoff&&ref.observedAt<f.ts&&ref.at<=now&&now-ref.at<POLICY.oddsMaxAge;
 const modelSide=winner(p.probabilities),marketSide=marketValid?winner(ref.probabilities):null;
 const side=p.probabilities[modelSide]>=.6?modelSide:null;
 if(!side)return null;
 const current=g.odds?.[side],fallback=g.lastKnownOdds?.[side];
 const usable=q=>q&&q.fixtureId===f.id&&typeof q.bookmaker==='string'&&q.bookmaker&&['ready','quote_expired'].includes(quoteStatus(q,side,now,f.ts));
 const q=usable(current)?current:usable(fallback)?fallback:null;
 // Absence or expiry of a price is not absence of a football prediction.
 // A known subminimum current price still respects the user's minimum odd.
 if(current&&current.fixtureId===f.id&&current.source==='API-Football'&&current.verifiedReceipt&&Number.isFinite(current.odd)&&current.odd<POLICY.minimumOdd)return null;
 const priceState=q?(q===current?quoteStatus(q,side,now,f.ts):'awaiting_recalculation'):'awaiting_quote';
 const probability=p.probabilities[side];
 // Football analysis is independent of price value; recommendations still use assessMarket.
 const assessment=assessMarket(g,side,now),priceReady=priceState==='ready';
 const eligible=priceReady&&assessment.eligible;
 return {version:WINNER_ANALYSIS_VERSION,market:side,label:(side==='H'?f.homeName:f.awayName)+' vence',
  basis:probability>=.6?'model':'market-reference',modelProbability:probability,
  marketProbability:marketValid?ref.probabilities[side]:null,referenceBooks:marketValid?ref.books:0,
  referenceAt:marketValid?ref.at:null,referenceStatus:marketValid?'available':'unavailable',
  disagreement:marketSide!==null&&modelSide!==marketSide,
  quote:q?{odd:q.odd,bookmaker:q.bookmaker,at:q.at,observedAt:q.observedAt}:null,quoteStatus:priceState,
  value:{eligible,reason:priceReady?assessment.reason:priceState,expectedReturn:priceReady?(assessment.expectedReturn??null):null,
   rawExpectedReturn:priceReady?probability*q.odd-1:null,reserve:assessment.modelDisagreement??null,
   minimumOdd:Number.isFinite(assessment.modelDisagreement)&&probability>assessment.modelDisagreement?1.03/(probability-assessment.modelDisagreement):null},
  mostLikelyScore:p.luxg?.topScores?.[0]??null,
  modelVersion:p.version,cutoff:p.cutoff,sample:p.sample,
  status:eligible?'value-candidate':'analysis-only',
  note:eligible?'Candidata a recomendação; publicação depende dos lugares disponíveis.':'Vitória provável; não é uma recomendação de aposta.'};
}
export async function winnerResponse(db,now=Date.now()){
 const window=forecastWindow(now);
 const rows=await db.prepare("SELECT f.data fixture_data,c.data FROM fixtures f LEFT JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff").bind(now,window.end).all();
 const pool=publicGames(rows.results.filter(r=>r.data),now).games;
 // Historical receipts are presentation-only. They never enter assessMarket,
 // publication or mutable forecast caches. Preserve the original clocks.
 const last=new Map();
 if(pool.length){
  const history=await db.prepare(`SELECT q.fixture_id,q.kickoff,q.bookmaker,q.selection,q.odd,q.provider_at,q.observed_at
   FROM openfoot_market_quotes q JOIN fixtures f ON f.id=q.fixture_id AND f.kickoff=q.kickoff
   WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? AND q.market='Match Winner' AND q.selection IN ('Home','Away')
   AND q.provider_at<=q.observed_at AND q.observed_at<=? AND q.observed_at<q.kickoff
   ORDER BY q.provider_at DESC,q.odd DESC,q.bookmaker`).bind(now,window.end,now).all();
  for(const r of history.results){const side=r.selection==='Home'?'H':'A',key=r.fixture_id+':'+side;if(last.has(key)||!Number.isFinite(r.odd)||r.odd<POLICY.minimumOdd)continue;
   last.set(key,{fixtureId:r.fixture_id,bookmaker:r.bookmaker,market:side,selection:side,odd:r.odd,at:r.provider_at,observedAt:r.observed_at,source:'API-Football',verifiedReceipt:true});}
 }
 const winnerAnalyses=pool.flatMap(g=>{const a=winnerAnalysis({...g,lastKnownOdds:{H:last.get(g.fixture.id+':H'),A:last.get(g.fixture.id+':A')}},now);return a?[{fixture:g.fixture,winnerAnalysis:a}]:[];});
 winnerAnalyses.sort((a,b)=>b.winnerAnalysis.modelProbability-a.winnerAnalysis.modelProbability||a.fixture.ts-b.fixture.ts||a.fixture.id-b.fixture.id);
 const saved=await db.prepare("SELECT p.day,p.fixture_id,p.published_at,p.data,f.data current_fixture FROM openfoot_current_picks p LEFT JOIN fixtures f ON f.id=p.fixture_id WHERE p.day>=? AND p.day<=? AND p.market IN ('H','A') ORDER BY p.day,p.published_at,p.fixture_id").bind(window.days[0],window.days[2]).all();
 const games=saved.results.flatMap(row=>{try{const g=JSON.parse(row.data),tip=g.displayTip||g.winnerTip;if(!['H','A'].includes(tip?.market)||lisbonDay(g.fixture.ts)!==row.day)return [];const current=row.current_fixture?JSON.parse(row.current_fixture):null;
   const result=current?.finished&&Number.isInteger(current.hg)&&Number.isInteger(current.ag)?{home:current.hg,away:current.ag,hit:Number(tip.market==='H'?current.hg>current.ag:current.ag>current.hg)}:g.result;
   return [{...g,currentFixture:current??g.currentFixture,result,published:{at:row.published_at,alternative:false}}];}catch{return [];}});
 const states=await db.prepare('SELECT key,data FROM openfoot_state WHERE key IN (?,?,?)').bind(...window.days.map(d=>'publication_day:'+d)).all();
 const byDay=Object.fromEntries(states.results.map(r=>[r.key.slice('publication_day:'.length),JSON.parse(r.data)]));
 const days=Object.fromEntries(window.days.map(day=>{const state=byDay[day],fresh=state&&now-state.at<600000;return [day,{updating:!fresh||state.status==='waiting',partial:fresh&&state.status==='partial_available'}];}));
 const competitionNames=new Map([[94,'Primeira Liga'],[39,'Premier League'],[140,'La Liga'],[78,'Bundesliga'],[135,'Serie A'],[61,'Ligue 1'],[88,'Eredivisie'],[2,'Liga dos Campeões'],[3,'Liga Europa'],[848,'Liga Conferência']]);
 return {games,winnerAnalyses,window,competitions:[...competitionNames].map(([id,name])=>({id,name})),analysis:{days},
  selectionPolicy:{selectionVersion:'winner-1x2-v1',markets:['H','A'],minimumOdd:POLICY.minimumOdd,minimumWinnerProbability:.6,minimumExpectedReturn:POLICY.minimumExpectedReturn,maxGamesPerDay:POLICY.maxGamesPerDay},
  diagnostics:{collected:rows.results.length,calculated:pool.length,visibleAnalyses:winnerAnalyses.length,publishedWinners:games.length},
  updatedAt:now,activeModel:CONTEXT_VERSION};
}
