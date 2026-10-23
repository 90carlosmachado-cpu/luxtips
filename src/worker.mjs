import legacy from './legacy-worker.mjs';
import {winnerResponse} from './context/winners.mjs';
import { runOpenFoot, openFootStatus } from './openfoot/sync.mjs';
import { shadowReport } from './openfoot/report.mjs';
import {predictionEnvironment} from './context/environment.mjs';
import {collectContext} from './context/collect.mjs';
import {refreshContextForecasts} from './context/refresh.mjs';
import {contextReport} from './context/report.mjs';
import {CONTEXT_VERSION} from './context/model.mjs';
import {refreshData} from './context/data-refresh.mjs';
import {operationsAuthorized} from './context/operations.mjs';
import {api} from './legacy-worker.mjs';
import {maintenance} from './context/maintenance.mjs';
const RELEASE='2026-10-23-analysis-price-retention-v10';

async function authorized(req, token) {
  if (!token) return false;
  const encoder = new TextEncoder();
  const digest = s => crypto.subtle.digest('SHA-256', encoder.encode(s));
  const a = new Uint8Array(await digest(req.headers.get('Authorization')?.replace(/^Bearer /, '') || ''));
  const b = new Uint8Array(await digest(token));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function manualImportRunning(env){
 if(env.PREDICTION_CONTEXT_MODE!=='live')return false;
 try{const r=await env.DB.prepare("SELECT data FROM openfoot_state WHERE key='bulk_import'").first();const b=r?JSON.parse(r.data):null;return b?.status==='running'&&Date.now()-b.at<3*3600000;}catch{return false;}
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if(url.pathname==='/api/games'&&env.PREDICTION_CONTEXT_MODE==='live'){
      if(req.method!=='GET')return Response.json({error:'Método não permitido'},{status:405,headers:{Allow:'GET'}});
      try{return Response.json(await winnerResponse(env.DB),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
      catch{return Response.json({error:'Previsões temporariamente indisponíveis.'},{status:503,headers:{'Cache-Control':'no-store'}});}
    }
    if(url.pathname==='/api/admin/recalculate'){
      if(!await authorized(req,env.ADMIN_TOKEN)&&!await operationsAuthorized(req,env.DB))return Response.json({error:'Não autorizado'},{status:401});
      if(req.method!=='POST')return Response.json({error:'Método não permitido'},{status:405});
      const action=url.searchParams.get('action');
      if(!['data','context','calculate','status'].includes(action))return Response.json({error:'Operação inválida'},{status:400});
      let result;
      try{result=await maintenance(env,()=>action==='status'?api(env,'status',0,true):action==='data'?refreshData(env,Date.now(),{force:true}):action==='context'?collectContext(env):refreshContextForecasts(env,Date.now(),{force:true}));}
      catch(e){result={status:'degraded',code:e.code||(/^(browser_transport_|browser_)/.test(e.message)?e.message:'operation_failed')};}
      return Response.json({...result,release:RELEASE,transport:env.FOOTBALL_API_TRANSPORT||'direct'},{headers:{'Cache-Control':'no-store'}});
    }
    if(url.pathname==='/api/validation'&&env.PREDICTION_CONTEXT_MODE==='live'){
      return Response.json({activeModel:CONTEXT_VERSION,prospectiveValidation:'in_progress',comparisonDisplay:false});
    }
    if (url.pathname === '/api/health') {
      const r = await legacy.fetch(req, env, ctx);
      if (r.ok) {
        const body=await r.json();
        const states=await env.DB.prepare("SELECT key,data FROM openfoot_state WHERE key IN ('context_refresh','data_refresh')").all();
        const pipeline=Object.fromEntries(states.results.map(row=>[row.key,JSON.parse(row.data)]));
        const upstream=await env.DB.prepare("SELECT data FROM meta WHERE key='provider:last-response'").first();
        const provider=upstream?JSON.parse(upstream.data):null;
        const calculation=pipeline.context_refresh,source=pipeline.data_refresh;
        const calculationReady=calculation&&(calculation.status==='ok'||calculation.status==='running'&&Date.now()-calculation.lastSuccessAt<300000);
        const sourceReady=source&&(source.status==='ok'||Date.now()-source.lastSuccessAt<3600000);
        const ready=env.PREDICTION_CONTEXT_MODE==='live'?Date.now()-(calculation?.lastSuccessAt||0)<600000&&!!calculationReady&&!!sourceReady&&provider?.valid===true&&Date.now()-provider.at<3600000:body.ready;
        const sync=env.PREDICTION_CONTEXT_MODE==='live'?{at:Math.max(calculation?.lastSuccessAt||0,source?.lastSuccessAt||0),ok:ready,stale:!ready,processed:(calculation?.forecasts||0)+(calculation?.retained||0),contextAvailable:ready}:body.sync;
        return Response.json({ ...body,sync,legacySync:body.sync,ready,release:RELEASE,pipeline,provider,version:env.PREDICTION_CONTEXT_MODE==='live'?CONTEXT_VERSION:body.version,openfoot: { mode: env.OPENFOOT_MODE || 'disabled', xgLeagues: [39,140,78,135,61] },contextModel:{mode:env.PREDICTION_CONTEXT_MODE||'disabled',version:CONTEXT_VERSION} }, { status: r.status, headers: r.headers });
      }
      return r;
    }
    if (url.pathname !== '/api/admin/openfoot') {
      const runtime=predictionEnvironment(env);
      const response=await legacy.fetch(req, url.pathname==='/api/games'&&env.PREDICTION_CONTEXT_MODE==='live'?{...runtime,__contextPauseLegacy:true}:runtime, ctx);
      if(url.pathname==='/api/history'&&env.PREDICTION_CONTEXT_MODE==='live'&&response.ok){
        const body=await response.json();return Response.json({activeModel:CONTEXT_VERSION,publishedSelections:body.publishedSelections||[]},{status:response.status,headers:response.headers});
      }
      return response;
    }
    const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    if (!await authorized(req, env.ADMIN_TOKEN)) return json({ error: 'Não autorizado' }, 401);
    if (req.method !== 'GET') return json({ error: 'Método não permitido' }, 405);
    if (!['shadow','live'].includes(env.OPENFOOT_MODE)) return json({ mode: 'disabled', configured: !!env.OPENFOOT_API_KEY });
    try { return json(url.searchParams.get('context')==='1'?await contextReport(env.DB):url.searchParams.get('report') === '1' ? await shadowReport(env.DB) : { ...await openFootStatus(env.DB), mode: env.OPENFOOT_MODE, publicationChanged: env.OPENFOOT_MODE === 'live' }); }
    catch { return json({ error: 'Estado OpenFoot indisponível; verificar migração.' }, 503); }
  },
  scheduled(event, env, ctx) {
    if(env.PREDICTION_CONTEXT_MODE==='live'){
      ctx.waitUntil(maintenance(env,async()=>{
        await refreshData(env);
        await collectContext(env);
        await refreshContextForecasts(env);
        if([7,37].includes(new Date(event.scheduledTime).getUTCMinutes()))await runOpenFoot(env);
      }));
      return;
    }
    ctx.waitUntil((async () => {
      if (['shadow','live'].includes(env.OPENFOOT_MODE)) {
        try { await runOpenFoot(env); }
        catch { console.error(JSON.stringify({ event: 'openfoot_collection_failed' })); }
      }
      if(!await manualImportRunning(env)){
        const pending = [];
        await legacy.scheduled(event, predictionEnvironment(env), { waitUntil(promise) { pending.push(promise); } });
        await Promise.all(pending);
      }
      if(env.PREDICTION_CONTEXT_MODE==='live'){
        await collectContext(env);
        await refreshContextForecasts(env);
      }
    })());
  },
};
