import {lisbonClock} from './daily-list.mjs';
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
export function selectionEvents(football,tickets,now){
 const items=[],clock=lisbonClock(now);
 for(const list of football){
  if(list.day!==clock.day||clock.hour<8||!list.locked)continue;
  const games=(list.items||[]).filter(i=>!['cancelled','changed'].includes(i.payload?.historyStatus));
  if(!games.length)continue;
  const first=Date.parse(list.day+'T08:00:00Z');
  // Resolve the Lisbon offset from the same calendar day (including DST).
  const offset=lisbonClock(first).hour-8,at=first-offset*3600000;
  const selectionIds=games.map(i=>i.id||String(i.gameId));
  const details=games.map(i=>{const g=i.payload,p=g.winnerAnalysis||g.displayTip||g.winnerTip||g.recommendation,f=g.fixture;return p&&f?(p.market==='H'?f.homeName:f.awayName)+' vence':null;}).filter(Boolean);
  items.push({key:'football-lock:'+list.day,sport:'football',selectionIds,createdAt:at,expiresAt:at+3600000,title:'LuxTips · Futebol',body:('Prognósticos de hoje bloqueados às 08h.\n'+details.join(' · ')).slice(0,400),url:'/'});
  for(const i of games){
   if(!(i.firstListedAt>at&&i.firstListedAt<=now)||i.kickoff<=now)continue;
   const g=i.payload,p=g.winnerAnalysis||g.displayTip||g.winnerTip||g.recommendation,f=g.fixture;
   if(!p||!f)continue;
   const id=i.id||String(i.gameId);
   items.push({key:'football-late:'+list.day+':'+id,sport:'football',selectionIds:[id],createdAt:i.firstListedAt,expiresAt:Math.min(i.firstListedAt+3600000,i.kickoff),title:'LuxTips · Novo prognóstico',body:(f.homeName+' – '+f.awayName+'\n'+(p.market==='H'?f.homeName:f.awayName)+' vence').slice(0,400),url:'/?jogo='+i.gameId});
  }
 }
 for(const t of tickets){
  if(t.status!=='active'||t.created_at>now||t.created_at<=now-3600000)continue;
  items.push({key:'bigodds-published:'+t.id,sport:'bigodds',createdAt:t.created_at,expiresAt:t.created_at+3600000,title:'LuxTips · Big Odds',body:'Existe uma nova Big Odds disponível.',url:'/big-odds'});
 }
 return items;
}
export async function notifyNewSelections(env,now=Date.now(),sender=sendPush){
 if(!env.PWA_VAPID_JWK)return {status:'unconfigured'};
 const db=env.DB,until=now+90000;
 const lock=await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('pwa_push',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(until,now).first();
 if(!lock)return {status:'locked'};
 const stats={at:now,events:0,sent:0,failed:0,expired:0};
 try{
  const rows=await db.prepare("SELECT data FROM openfoot_state WHERE key LIKE 'daily_list:lisbon-0800-v1:football:%'").all();
  const tickets=await db.prepare("SELECT id,created_at,status FROM bigodds_tickets WHERE status='active' AND created_at>?").bind(now-3600000).all();
  const baseline=await read(db,'pwa:scheduled-baseline'),baselineAt=baseline?.at??now;
  const current=selectionEvents(rows.results.map(r=>JSON.parse(r.data)),tickets.results,now);
  for(const e of current){
   if(e.createdAt<baselineAt||e.expiresAt<=now)continue;
   if(e.key.startsWith('football-late:')){
    const dayKey='football-lock:'+e.key.split(':')[1],daily=await read(db,'pwa:event:'+await hash(dayKey));
    if(daily?.selectionIds?.includes(e.selectionIds[0]))continue;
   }
   const id=await hash(e.key),key='pwa:event:'+id;if(await read(db,key))continue;
   await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO NOTHING').bind(key,JSON.stringify({...e,id})).run();stats.events++;
  }
  if(!baseline)await write(db,'pwa:scheduled-baseline',{at:now});
  const subscriptions=(await db.prepare("SELECT key,data FROM openfoot_state WHERE key LIKE 'pwa:sub:%' ORDER BY key").all()).results;
  const events=(await db.prepare("SELECT data FROM openfoot_state WHERE key LIKE 'pwa:event:%'").all()).results.map(r=>JSON.parse(r.data)).filter(e=>e.expiresAt>now&&/^(football-lock:|football-late:|bigodds-published:)/.test(e.key));
  const active=new Set(current.map(e=>e.key)),jwk=JSON.parse(env.PWA_VAPID_JWK);let attempts=0;
  for(const row of subscriptions){
   const sub=JSON.parse(row.data);
   for(const e of events){
    if(!active.has(e.key)||!(e.sport==='bigodds'?sub.preferences.bigodds??sub.preferences.football:sub.preferences.football)||e.createdAt<(sub[e.sport+'Since']||sub.footballSince||sub.createdAt))continue;
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

