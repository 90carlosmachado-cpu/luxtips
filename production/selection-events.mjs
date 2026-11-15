// Shared publication events and state helpers used by Telegram.
import {lisbonClock} from './daily-list.mjs';
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export const read=async(db,key)=>{const r=await db.prepare('SELECT data FROM openfoot_state WHERE key=?').bind(key).first();return r?JSON.parse(r.data):null;};
export const write=(db,key,value)=>db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(value)).run();
export const hash=async value=>encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
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
  items.push({key:'bigodds-published:'+t.id,sport:'bigodds',createdAt:t.created_at,expiresAt:t.created_at+3600000,title:'LuxTips · Bigodes',body:'Existe uma nova múltipla BIGODES disponível.',url:'/big-odds'});
 }
 return items;
}
