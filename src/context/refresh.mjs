import {cachedOdds,extractQuotes} from './odds.mjs';
import {evaluationRecord} from './evaluation.mjs';
import {competitionEvidence,winnerTip,applyPricing,forecastWindow,publicGames} from '../legacy-worker.mjs';
import {liveEnvironment} from '../openfoot/live.mjs';
import {contextSources} from './collect.mjs';
import {contextPrediction,selectionAssessment,CONTEXT_VERSION} from './model.mjs';
import {detailedPrediction,historyWithoutKnownRedCards} from './details-model.mjs';
import {publishMarketPicks,WINNER_MARKETS} from './selection.mjs';
import {fitLiveStrength,predictLiveStrength} from '../openfoot/strength.mjs';
import {informationWindow,informationCaptureNeeded,prepareInformationComparison} from './information-comparison.mjs';
const DAY=86400000;
export function bookmakerQuotes(payload,fixture,observedAt){
 return extractQuotes(Array.isArray(payload)?payload:payload?.items,fixture,observedAt).filter(q=>['H','D','A'].includes(q.code)).map(q=>({...q,market:'1X2',selection:q.code}));
}

export async function refreshContextForecasts(env,now=Date.now(),options={}){
 if(env.PREDICTION_CONTEXT_MODE!=='live')return {status:'disabled'};
 const db=env.DB;
 const old=await db.prepare("SELECT data FROM openfoot_state WHERE key='context_refresh'").first();
 if(!options.force&&old&&now-JSON.parse(old.data).at<30000)return {status:'throttled'};
 const token=now+120000;
 if(!await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('context_refresh',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(token,now).first())return {status:'locked'};
 const prior=old?JSON.parse(old.data):{};
 const summary={at:now,status:'ok',forecasts:0,retained:0,withXg:0,withContext:0,eligible:0,publicationHeld:false,failures:[],lastSuccessAt:prior.lastSuccessAt||(prior.status==='ok'?prior.at:null)};
 await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind('context_refresh',JSON.stringify({...summary,status:'running',next:old?JSON.parse(old.data).next||0:0})).run();
 try{
  const leagues=String(env.LEAGUES||'94,39,140,78,135,61,88,2,3,848').split(',').map(Number).filter(Number.isSafeInteger);
  const w=forecastWindow(now);
  const rows=await db.prepare("SELECT f.data fixture_data,f.updated_at,c.data FROM fixtures f LEFT JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff").bind(now,w.end).all();
  const environment=liveEnvironment(env),states=new Map(),games=[];
  const previous=old?JSON.parse(old.data):{},start=rows.results.length?(previous.next||0)%rows.results.length:0;
  const selected=[...rows.results.slice(start),...rows.results.slice(0,start)].slice(0,5);
  summary.next=rows.results.length?(start+selected.length)%rows.results.length:0;
  const selectedLeagues=[...new Set(selected.map(r=>JSON.parse(r.fixture_data).league))];
  const european=selectedLeagues.some(league=>[2,3,848].includes(league));
  const filter=european||!selectedLeagues.length?'':' AND league IN ('+selectedLeagues.map(()=>'?').join(',')+')';
  const hrows=await db.prepare('SELECT data,updated_at FROM fixtures WHERE finished=1 AND kickoff>? AND kickoff<?'+filter+' ORDER BY kickoff').bind(now-3*365*DAY,now-7200000,...(european?[]:selectedLeagues)).all();
  const knownHistory=hrows.results.filter(r=>Number.isFinite(r.updated_at)&&r.updated_at<=now);
  const history=knownHistory.map(r=>JSON.parse(r.data)).filter(f=>leagues.includes(f.league));
  const drows=await db.prepare('SELECT data FROM openfoot_match_details WHERE observed_at<=? AND kickoff<?'+filter+' ORDER BY observed_at DESC').bind(now,now,...(european?[]:selectedLeagues)).all();
  const details=drows.results.map(r=>JSON.parse(r.data)),cleanHistory=historyWithoutKnownRedCards(history,details,now);
  for(const row of selected){
   const f=JSON.parse(row.fixture_data);if(f.status!=='NS'||!leagues.includes(f.league))continue;
   try{
   const european=[2,3,848].includes(f.league),h=european?cleanHistory:cleanHistory.filter(r=>r.league===f.league);
   if(!states.has(f.league))states.set(f.league,fitLiveStrength(h,now,f.league));
   let original=row.data?JSON.parse(row.data):{};
   if(original.fixture&&(original.fixture.id!==f.id||original.fixture.league!==f.league||original.fixture.home!==f.home||original.fixture.away!==f.away)){
    summary.failures.push({fixtureId:f.id,league:f.league,reason:'fixture_identity_changed'});continue;
   }
   // A reschedule invalidates only the disposable forecast cache. Otherwise
   // this fixture would be skipped forever, retaining its old model/xG state.
   // Sources are read again for the new kickoff; published ledgers stay intact.
   if(original.fixture&&original.fixture.ts!==f.ts)original={};
   let p=competitionEvidence(predictLiveStrength(states.get(f.league),f),f.league);
   if(typeof environment.__openfootEnrich==='function')p=await environment.__openfootEnrich(h,f,p,now);
   p=detailedPrediction(history,details,f,p,now);
   const sources=await contextSources(db,f,now);
   const prices=await cachedOdds(db,f,now);
   const quotes=prices.quotes.filter(q=>q.verifiedReceipt&&['H','D','A'].includes(q.code)).map(q=>({...q,market:'1X2',selection:q.code}));
   p=contextPrediction(history,f,p,sources,quotes,now);
   const sourceUpdatedAt=Math.max(Number.isFinite(original.sourceUpdatedAt)?original.sourceUpdatedAt:0,row.updated_at||0);
   const sourceStale=!sourceUpdatedAt||now-sourceUpdatedAt>2*3600000;
   const odds=prices.odds;
   const usedIds=new Set(h.map(f=>f.id));
   const input=JSON.stringify({fixture:f,sourceUpdatedAt,history:knownHistory.filter(r=>usedIds.has(JSON.parse(r.data).id)),xg:p.xgEnrichment?.inputDigest,details:details.filter(d=>d.league===f.league),sources,odds,marketReference:p.contextAdjustment.market,oddsCollection:prices.state?.status,bucket:Math.floor(now/1800000)});
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
   const signature=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(original.prediction?.version===p.version&&original.prediction?.contextAdjustment?.inputSignature===signature&&!informationCaptureNeeded(env,original,f,now)){
    games.push(original);summary.retained++;if(original.prediction.xgEnrichment?.active)summary.withXg++;if(original.prediction.contextAdjustment?.active)summary.withContext++;continue;
   }
   p.contextAdjustment.inputSignature=signature;
   let g=applyPricing({...original,fixture:f,prediction:p,recommendation:null,odds,oddsStatus:prices.statuses,updatedAt:now,sourceUpdatedAt,selectionContract:'selection-inputs-v2',
    stale:sourceStale,oddsCollection:prices.state?{status:prices.state.status,nextAt:prices.state.nextAt,missing:prices.state.missing}:null,phase:'preliminary',winnerTip:winnerTip(p,null,odds,{now,sourceUpdatedAt,stale:sourceStale})},now);
   g.context={...original.context,injuriesStale:true,lineupsStale:true};
   if(sources.injuries){
    const seen=new Set();
    g.context.injuries=sources.injuries.data.filter(r=>{const key=[r.team?.id,r.player?.id,r.player?.type,r.player?.reason].join(':');if(seen.has(key))return false;seen.add(key);return r.fixture?.id===f.id&&[f.home,f.away].includes(r.team?.id);}).map(r=>({team:r.team.name,player:r.player.name,type:r.player.type,reason:r.player.reason}));
    g.context.injuriesStale=now-sources.injuries.sourceAt>4*3600000;
   }
   if(sources.lineups){
    g.context.lineups=sources.lineups.data.map(r=>({team:r.team?.name,formation:r.formation,players:(r.startXI||[]).map(x=>x.player?.name)}));
    g.context.lineupsStale=now-sources.lineups.sourceAt>3600000;
   }
   delete g.displayTip;delete g.published;delete g.result;
   const assessment=selectionAssessment(g,now);
   g.selectionAssessment=assessment;
   if(g.winnerTip)g.winnerTip={...g.winnerTip,priceEligible:g.winnerTip.priceEligible&&assessment.eligible,valueStatus:assessment.eligible?'Valor esperado positivo após reserva para divergência do modelo.':'Sem vantagem suficiente após margem e incerteza do modelo.'};
   // Persist source clocks and the actual pre-match prediction together.
   const recordedAt=Date.now();if(recordedAt>=f.ts)continue;
   g.evaluation=evaluationRecord(g,h,knownHistory.filter(r=>usedIds.has(JSON.parse(r.data).id)),sources,details,recordedAt,signature);
   if(informationWindow(env,f,recordedAt)){
    g.evaluation.informationComparison=await prepareInformationComparison(env,g,h,knownHistory.filter(r=>usedIds.has(JSON.parse(r.data).id)),recordedAt);
    if(Date.now()>=f.ts)continue;
   }
   const data=JSON.stringify(g),version=p.version+'@'+f.ts+':'+recordedAt;
   await db.batch([
    db.prepare('INSERT OR IGNORE INTO openfoot_context_forecasts(fixture_id,kickoff,created_at,version,data) VALUES(?,?,?,?,?)').bind(f.id,f.ts,recordedAt,p.version,data),
    db.prepare('INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) VALUES(?,?,?,?,?,?)').bind(f.id,version,'preliminary',recordedAt,f.ts,data),
    db.prepare("INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires WHERE COALESCE(json_extract(cache.data,'$.updatedAt'),0)<=?").bind('forecast:'+f.id,data,f.ts+DAY,now),
   ]);
   summary.forecasts++;if(p.xgEnrichment?.active)summary.withXg++;if(p.contextAdjustment?.active)summary.withContext++;
   if(assessment.eligible)summary.eligible++;
   games.push(g);
   }catch{summary.failures.push({fixtureId:f.id,league:f.league,reason:'fixture_calculation_failed'});}
  }
  const poolRows=await db.prepare("SELECT c.data,f.data fixture_data FROM fixtures f LEFT JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? ORDER BY f.kickoff").bind(now,w.end).all();
  const rowsForLeagues=poolRows.results.filter(r=>leagues.includes(JSON.parse(r.fixture_data).league));
  const pool=publicGames(rowsForLeagues.filter(r=>r.data),now).games.filter(g=>g.prediction?.version===CONTEXT_VERSION);
  summary.publication=await publishMarketPicks(db,pool,Date.now(),{rows:rowsForLeagues,markets:WINNER_MARKETS});
  const days=Object.values(summary.publication.days||{});
  summary.publicationHeld=days.length>0&&days.every(d=>d.status==='waiting');
  await db.prepare("DELETE FROM cache WHERE key='public:games:v1'").run();
 }catch(e){summary.status='unavailable';summary.error='context_refresh_failed';console.error(JSON.stringify({event:'context_refresh_failed',code:summary.error}));}
 finally{
  if(summary.status==='ok')summary.lastSuccessAt=Date.now();
  await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind('context_refresh',JSON.stringify(summary)).run();
  await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='context_refresh' AND until=?").bind(token).run();
 }
 return summary;
}
