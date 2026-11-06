import {sendPush,validEndpoint,publicKey,decode,encode} from './webpush.mjs';
export const read=async(db,key)=>{const r=await db.prepare('SELECT data FROM openfoot_state WHERE key=?').bind(key).first();return r?JSON.parse(r.data):null;};
export const write=(db,key,value)=>db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(value)).run();
export const hash=async value=>encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function pushRoute(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/api/push/config'&&request.method==='GET'){
  const jwk=env.PWA_VAPID_JWK?JSON.parse(env.PWA_VAPID_JWK):null;
  return json({enabled:!!jwk,publicKey:jwk?publicKey(jwk):null});
 }
 if(path!=='/api/push/subscription')return json({error:'Não encontrado'},404);
 if(!['POST','DELETE'].includes(request.method))return json({error:'Método inválido'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Pedido inválido'},403);
 if(!env.PWA_VAPID_JWK)return json({error:'Notificações indisponíveis'},503);
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return json({error:'Pedido inválido'},401);
 const text=await request.text();if(text.length>8192)return json({error:'Pedido demasiado grande'},413);
 let body;try{body=JSON.parse(text);}catch{return json({error:'Pedido inválido'},400);}
 const endpoint=body.subscription?.endpoint||body.endpoint;if(!validEndpoint(endpoint))return json({error:'Serviço de notificações inválido'},400);
 const id=await hash(endpoint),key='pwa:sub:'+id,owner=await hash(token),prior=await read(env.DB,key);
 if(prior&&prior.owner!==owner)return json({error:'Dispositivo não autorizado'},403);
 if(request.method==='DELETE'){if(prior)await env.DB.prepare('DELETE FROM openfoot_state WHERE key=?').bind(key).run();return json({ok:true});}
 const prefs=body.preferences?{...body.preferences,nba:false}:null,keys=body.subscription.keys;
 if(!prefs||typeof prefs.football!=='boolean'||typeof prefs.nba!=='boolean'||(!prefs.football&&!prefs.nba))return json({error:'Escolhe uma modalidade'},400);
 try{if(decode(keys.p256dh).length!==65||decode(keys.auth).length!==16)throw Error();
 await crypto.subtle.importKey('raw',decode(keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);
 }catch{return json({error:'Subscrição inválida'},400);}
 const count=await env.DB.prepare("SELECT count(*) total FROM openfoot_state WHERE key LIKE 'pwa:sub:%'").first();
 if(!prior&&count.total>=500)return json({error:'Limite de dispositivos atingido'},429);
 const now=Date.now();
 await write(env.DB,key,{id,owner,subscription:{endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth}},preferences:prefs,createdAt:prior?.createdAt||now,footballSince:prior?.preferences.football&&prefs.football?prior.footballSince:now,nbaSince:prior?.preferences.nba&&prefs.nba?prior.nbaSince:now,updatedAt:now});
 return json({ok:true});
}
export function selectionEvents(football,nba,now){
 const items=[];
 for(const l of football)for(const item of l.items){
  const g=item.payload,p=g.winnerAnalysis||g.displayTip||g.winnerTip||g.recommendation,f=g.fixture;
  if(item.kickoff<=now||['cancelled','changed'].includes(g.historyStatus)||!p)continue;
  items.push({key:'football:'+item.id,sport:'football',kickoff:item.kickoff,firstListedAt:item.firstListedAt,gameId:item.gameId,title:'LuxTips · Futebol',body:f.homeName+' – '+f.awayName+'\n'+(p.market==='H'?f.homeName:f.awayName)+' vence · Odd '+Number(p.quote?.odd??p.odd).toFixed(2).replace('.',','),url:'/?jogo='+item.gameId});
 }
 for(const p of nba.upcoming||[]){if(p.kickoff<=now||p.outcome)continue;
  items.push({key:'nba:'+p.gameId+':'+p.kickoff+':'+p.winner,sport:'nba',kickoff:p.kickoff,firstListedAt:p.dailyList?.firstListedAt,gameId:p.gameId,title:'LuxTips · NBA',body:p.homeName+' – '+p.awayName+'\n'+(p.winner==='home'?p.homeName:p.awayName)+' vence · Odd '+Number(p.odds).toFixed(2).replace('.',','),url:'/nba?jogo='+p.gameId});
 }
 return items.filter(e=>!e.body.includes('NaN')).map(e=>({...e,body:e.body.slice(0,400)}));
}
export async function notifyNewSelections(env,now=Date.now(),sender=sendPush){
 if(!env.PWA_VAPID_JWK)return {status:'unconfigured'};
 const db=env.DB,until=now+90000;
 const lock=await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('pwa_push',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(until,now).first();
 if(!lock)return {status:'locked'};
 const stats={at:now,events:0,sent:0,failed:0,expired:0};
 try{
  const rows=await db.prepare("SELECT data FROM openfoot_state WHERE key LIKE 'daily_list:lisbon-0800-v1:football:%'").all();
  const nba={upcoming:[]}; // NBA notifications retired with its public tab.
  const baseline=await read(db,'pwa:baseline'),current=selectionEvents(rows.results.map(r=>JSON.parse(r.data)),nba,now);
  for(const e of current){
   const id=await hash(e.key),key='pwa:event:'+id;if(await read(db,key))continue;
   const createdAt=baseline&&Number.isFinite(e.firstListedAt)&&e.firstListedAt>=baseline.at?e.firstListedAt:0;
   await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO NOTHING').bind(key,JSON.stringify({...e,id,createdAt})).run();stats.events++;
  }
  if(!baseline)await write(db,'pwa:baseline',{at:now});
  const subscriptions=(await db.prepare("SELECT key,data FROM openfoot_state WHERE key LIKE 'pwa:sub:%' ORDER BY key").all()).results;
  const events=(await db.prepare("SELECT data FROM openfoot_state WHERE key LIKE 'pwa:event:%'").all()).results.map(r=>JSON.parse(r.data)).filter(e=>e.createdAt>now-3600000&&e.kickoff>now);
  const active=new Set(current.map(e=>e.key)),jwk=JSON.parse(env.PWA_VAPID_JWK);let attempts=0;
  for(const row of subscriptions){
   const sub=JSON.parse(row.data);
   for(const e of events){
    if(!active.has(e.key)||!sub.preferences[e.sport]||e.createdAt<(sub[e.sport+'Since']||sub.createdAt))continue;
    const key='pwa:delivery:'+sub.id+':'+e.id,prior=await read(db,key);
    if(prior?.sent||prior?.nextAt>now||prior?.attempts>=5)continue;
    if(attempts++>=20||Date.now()-now>20000)return {...stats,status:'partial'};
    try{
     const response=await sender(sub.subscription,e,jwk);
     if(response.status===404||response.status===410){await db.prepare('DELETE FROM openfoot_state WHERE key=?').bind(row.key).run();stats.expired++;break;}
     if(!response.ok){
      let reason=null;
      try{const body=await response.json();if(typeof body.reason==='string'&&/^[A-Za-z_]{1,60}$/.test(body.reason))reason=body.reason;}catch{}
      throw Object.assign(Error('provider_failed'),{pushStatus:response.status,pushReason:reason});
     }
     await write(db,key,{sent:true,at:now});stats.sent++;
    }catch(error){await write(db,key,{attempts:(prior?.attempts||0)+1,nextAt:now+Math.min(30,2**(prior?.attempts||0))*60000,stage:error.pushStage||null,category:error.pushCategory||null,httpStatus:error.pushStatus||null,reason:error.pushReason||null,errorName:['TypeError','DataError','OperationError','InvalidAccessError','NotSupportedError','TimeoutError','AbortError'].includes(error.name)?error.name:'send_failed'});stats.failed++;}
   }
  }
  return {...stats,status:'ok'};
 }finally{
  await write(db,'pwa:last_cycle',stats);
  await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='pwa_push' AND until=?").bind(until).run();
 }
}

