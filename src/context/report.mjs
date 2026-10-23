import {CONTEXT_VERSION} from './model.mjs';
import {currentEvaluation} from './evaluation.mjs';
export async function contextReport(db,now=Date.now()){
 const [state,sources,active,evaluation]=await Promise.all([
 db.prepare("SELECT key,data FROM openfoot_state WHERE key IN ('context_collection','context_refresh','bulk_import','publication_decisions','data_refresh') OR key LIKE 'publication_day:%'").all(),
 db.prepare('SELECT kind,COUNT(*) snapshots,MAX(observed_at) latest FROM openfoot_context_sources GROUP BY kind').all(),
 db.prepare("SELECT f.league,COUNT(*) forecasts,SUM(CASE WHEN json_extract(c.data,'$.prediction.xgEnrichment.active')=1 THEN 1 ELSE 0 END) withXg FROM fixtures f JOIN cache c ON c.key='forecast:'||f.id WHERE f.finished=0 AND f.kickoff>? AND json_extract(c.data,'$.prediction.version')=? GROUP BY f.league").bind(now,CONTEXT_VERSION).all(),
 currentEvaluation(db)]);
 return {version:CONTEXT_VERSION,mode:'live',modelComparison:'paired-internal-reference-only',state:Object.fromEntries(state.results.map(r=>[r.key,JSON.parse(r.data)])),sources:sources.results,active:active.results,evaluation,
 limitations:['Effects remain observational; probabilities are not demonstrated hit rates.','Component divergence is not a confidence interval.','ROI is theoretical at recorded prematch prices; no executed bets are recorded.']};
}
