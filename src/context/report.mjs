import {CONTEXT_VERSION} from './model.mjs';
export async function contextReport(db,now=Date.now()){
 const [state,sources,active,settled]=await Promise.all([
  db.prepare("SELECT key,data FROM openfoot_state WHERE key IN ('context_collection','context_refresh','bulk_import')").all(),
  db.prepare('SELECT kind,COUNT(*) snapshots,MAX(observed_at) latest FROM openfoot_context_sources GROUP BY kind').all(),
  db.prepare("SELECT f.league,COUNT(*) forecasts,SUM(CASE WHEN json_extract(c.data,'$.prediction.xgEnrichment.active')=1 THEN 1 ELSE 0 END) withXg,SUM(CASE WHEN json_extract(c.data,'$.prediction.matchDetailsEnrichment.active')=1 THEN 1 ELSE 0 END) withContext FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND json_extract(c.data,'$.prediction.version')=? GROUP BY f.league").bind(now,CONTEXT_VERSION).all(),
  db.prepare("SELECT p.data,r.hg,r.ag FROM openfoot_context_forecasts p JOIN results r ON r.fixture_id=p.fixture_id JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff WHERE f.finished=1 AND p.version=? AND p.created_at=(SELECT MAX(p2.created_at) FROM openfoot_context_forecasts p2 WHERE p2.fixture_id=p.fixture_id AND p2.kickoff=p.kickoff AND p2.version=p.version) ORDER BY p.created_at DESC LIMIT 2000").bind(CONTEXT_VERSION).all(),
 ]);
 const stats={n:0,brier:null,logLoss:null,byLeague:{}},sums={brier:0,logLoss:0};
 for(const r of settled.results){
  const g=JSON.parse(r.data),p=g.prediction?.probabilities,outcome=r.hg>r.ag?'H':r.hg===r.ag?'D':'A';
  if(!p||!['H','D','A'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)||Math.abs(p.H+p.D+p.A-1)>1e-6)continue;
  const brier=['H','D','A'].reduce((s,k)=>s+(p[k]-(outcome===k?1:0))**2,0),logLoss=-Math.log(Math.max(1e-15,p[outcome]));
  stats.n++;sums.brier+=brier;sums.logLoss+=logLoss;
  const k=g.fixture.league;stats.byLeague[k]??={n:0,brier:0,logLoss:0};
  stats.byLeague[k].n++;stats.byLeague[k].brier+=brier;stats.byLeague[k].logLoss+=logLoss;
 }
 if(stats.n){stats.brier=sums.brier/stats.n;stats.logLoss=sums.logLoss/stats.n;}
 for(const l of Object.values(stats.byLeague)){l.brier/=l.n;l.logLoss/=l.n;}
 return {version:CONTEXT_VERSION,mode:'live',modelComparison:false,state:Object.fromEntries(state.results.map(r=>[r.key,JSON.parse(r.data)])),sources:sources.results,active:active.results,evaluation:stats,
  limitations:['Contextual effects are experimental and observational.','Unavailable inputs are explicit; no full tactical, weather or player-minutes model is claimed.','Recorded odds are observed prices; first/last observed are not verified opening/closing prices.']};
}
