// An alternative server-side egress path for the authenticated sports API.
// The API key never enters the public page or a URL. No model data is inferred.
export async function browserApiFetch(env,url){
 const target=new URL(url);
 if(target.origin!=='https://v3.football.api-sports.io'||!env.FOOTBALL_BROWSER)throw Error('browser_transport_unavailable');
 const key='browser_usage:'+new Date().toISOString().slice(0,7),reservation=60000,limit=20*3600000;
 const budget=await env.DB.prepare("INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=json_set(data,'$.ms',json_extract(data,'$.ms')+?) WHERE json_extract(data,'$.ms')+?<=? RETURNING data").bind(key,JSON.stringify({ms:reservation}),reservation,reservation,limit).first();
 if(!budget)throw Error('browser_transport_budget');
 const start=Date.now();
 try{
  const response=await env.FOOTBALL_BROWSER.quickAction('scrape',{url:target.href,elements:[{selector:'pre'}],setExtraHTTPHeaders:{'x-apisports-key':env.API_FOOTBALL_KEY,Accept:'application/json'},setJavaScriptEnabled:false,gotoOptions:{waitUntil:'domcontentloaded',timeout:15000},rejectResourceTypes:['image','stylesheet','font','media','script']});
  if(!response.ok){
   const error=await response.text();
   if(response.status===429||/rate limit exceeded/i.test(error))throw Object.assign(Error('rate_limit_browser_cooldown'),{code:'rate_limit_browser_cooldown'});
   throw Error('browser_transport_http_'+response.status+': '+error.replaceAll(env.API_FOOTBALL_KEY,'[redacted]').slice(0,600));
  }
  const payload=await response.json(),groups=Array.isArray(payload)?payload:payload.result;
  const text=groups?.find(g=>g.selector==='pre')?.results?.[0]?.text;
  if(typeof text!=='string'||text.length>8e6)throw Error('browser_transport_payload');
  const data=JSON.parse(text);
  if(!data||typeof data!=='object'||!('errors' in data))throw Error('browser_transport_schema');
  return Response.json(data,{headers:{'X-Luxtips-Transport':'cloudflare-browser'}});
 }finally{
  const elapsed=Math.min(reservation,Math.max(1000,Date.now()-start));
  await env.DB.prepare("UPDATE openfoot_state SET data=json_set(data,'$.ms',max(0,json_extract(data,'$.ms')-?)) WHERE key=?").bind(reservation-elapsed,key).run();
 }
}
