import {browserApiFetch} from './browser-fetch.mjs';
// A single database lease coordinates every API-Football caller across isolates.
export async function providerFetch(env,url,options){
 const db=env.DB,now=Date.now(),token=now+120000;
 const acquired=await db.prepare("INSERT INTO locks(key,until) VALUES('api-flight',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(token,now).first();
 if(!acquired)throw Object.assign(Error('rate_limit_busy'),{code:'rate_limit_busy'});
 try{
  const cooldown=await db.prepare("SELECT until FROM locks WHERE key='api-cooldown'").first();
  if(cooldown?.until>Date.now())throw Object.assign(Error('rate_limit_cooldown'),{code:'rate_limit_cooldown'});
  const next=await db.prepare("SELECT until FROM locks WHERE key='api-next'").first();
  const wait=Math.max(0,(next?.until||0)-Date.now());
  if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
  const started=Date.now();
  const spacing=env.FOOTBALL_API_TRANSPORT==='browser'?31000:1200;
  await db.prepare("INSERT INTO locks(key,until) VALUES('api-next',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until").bind(started+spacing).run();
  let response;
  if(env.FOOTBALL_API_TRANSPORT==='container'){
   const target=new URL(url);
   if(target.origin!=='https://v3.football.api-sports.io')throw Error('invalid_provider_origin');
   const result=await env.FOOTBALL_RELAY.getByName('api-football').request(target.pathname.slice(1)+target.search);
   response=new Response(result.body,{status:result.status,headers:result.headers});
  }else response=env.FOOTBALL_API_TRANSPORT==='browser'?await browserApiFetch(env,url):await fetch(url,options);
  const limits=Object.fromEntries([...response.headers].filter(([key])=>key.includes('ratelimit')||key==='retry-after'));
  const payload=await response.clone().json().catch(()=>null),valid=response.ok&&payload!==null&&Object.keys(payload.errors||{}).length===0;
  await db.prepare('INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind('provider:last-response',JSON.stringify({at:Date.now(),path:new URL(url).pathname+new URL(url).search,http:response.status,limits,valid,transport:env.FOOTBALL_API_TRANSPORT||'direct'})).run();
  return response;
 }catch(error){
  if(error.code==='rate_limit_browser_cooldown')await db.prepare("INSERT INTO locks(key,until) VALUES('api-next',?) ON CONFLICT(key) DO UPDATE SET until=max(until,excluded.until)").bind(Date.now()+20000).run();
  const detail=String(error.message).replaceAll(env.API_FOOTBALL_KEY||'__missing_key__','[redacted]').slice(0,240);
  await db.prepare('INSERT INTO meta(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind('provider:transport-error',JSON.stringify({at:Date.now(),name:error.name,detail,transport:env.FOOTBALL_API_TRANSPORT||'direct'})).run();
  throw error;
 }finally{
  await db.prepare("UPDATE locks SET until=0 WHERE key='api-flight' AND until=?").bind(token).run();
 }
}
