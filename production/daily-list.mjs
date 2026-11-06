export const LIST_VERSION='lisbon-0800-v1';
const PREFIX='daily_list:'+LIST_VERSION+':';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
export function lisbonClock(at) {
  const p=Object.fromEntries(formatter.formatToParts(at).map(x=>[x.type,x.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour)};
}
export const listDay=at=>lisbonClock(at).day;
export function listWindow(at) {
  const noon=Date.parse(listDay(at)+'T12:00:00Z');
  return [0,1,2].map(i=>new Date(noon+i*86400000).toISOString().slice(0,10));
}
export function dayLocked(day,at) {
  const c=lisbonClock(at);
  return c.day>day || c.day===day && c.hour>=8;
}
export function reconcileDay(previous,day,candidates,now,withdrawnIds=[]) {
  if(previous && previous.asOf>now)return previous;
  const locked=dayLocked(day,now), prior=new Map((previous?.items||[]).map(x=>[x.id,x]));
  const incoming=new Map();
  for(const c of candidates) {
    if(typeof c.id!=='string'||!Number.isFinite(c.kickoff)||listDay(c.kickoff)!==day||c.kickoff<=now)continue;
    if(incoming.has(c.id))throw Error('duplicate_daily_candidate');
    incoming.set(c.id,c);
  }
  const items=[];
  for(const old of prior.values()) {
    if(withdrawnIds.includes(old.id)&&!locked&&!old.lockedAt)continue;
    // Never erase a started game's selection based on its subsequent result.
    if(locked || old.kickoff<=now || old.lockedAt) {
      items.push({...old,lockedAt:old.lockedAt||now});incoming.delete(old.id);
    }
  }
  const occupied=new Set(items.map(x=>`${x.gameId}:${x.kickoff}`));
  for(const c of incoming.values()) {
    if(occupied.has(`${c.gameId}:${c.kickoff}`))continue;
    const old=prior.get(c.id);
    items.push({...c,firstListedAt:old?.firstListedAt||now,lastEligibleAt:now,lockedAt:locked?now:null});
    occupied.add(`${c.gameId}:${c.kickoff}`);
  }
  return {version:LIST_VERSION,day,managedSince:previous?.managedSince||now,asOf:now,locked,items:items.sort((a,b)=>a.kickoff-b.kickoff||a.id.localeCompare(b.id))};
}
function tableName(table) {
  if(!['state','openfoot_state'].includes(table))throw Error('invalid_daily_state_table');
  return table;
}
export async function readDailyLists(db,table,sport) {
  table=tableName(table);
  const rows=await db.prepare(`SELECT key,data FROM ${table} WHERE key LIKE ? ORDER BY key`).bind(PREFIX+sport+':%').all();
  return rows.results.map(r=>JSON.parse(r.data));
}
export async function syncDailyLists(db,table,sport,candidates,now,withdrawnIds=[]) {
  table=tableName(table);
  const days=listWindow(now),result=[];
  for(const day of days) {
    const key=PREFIX+sport+':'+day;
    let stored=false;
    for(let attempt=0;attempt<8;attempt++) {
      const old=await db.prepare(`SELECT data FROM ${table} WHERE key=?`).bind(key).first();
      const previous=old?JSON.parse(old.data):null;
      if(previous?.asOf>now){result.push(previous);stored=true;break;}
      const next=reconcileDay(previous,day,candidates,now,withdrawnIds),data=JSON.stringify(next);
      const write=old
        ? await db.prepare(`UPDATE ${table} SET data=? WHERE key=? AND data=? RETURNING key`).bind(data,key,old.data).first()
        : await db.prepare(`INSERT INTO ${table}(key,data) VALUES(?,?) ON CONFLICT(key) DO NOTHING RETURNING key`).bind(key,data).first();
      if(write){result.push(next);stored=true;break;}
    }
    if(!stored)throw Error('daily_list_write_conflict');
  }
  return result;
}
export function membership(lists) {
  return Object.fromEntries(lists.map(l=>[l.day,l.items.map(i=>i.id)]));
}
export function snapshotPayload(item) {
  return {...item.payload,dailyList:{version:LIST_VERSION,day:listDay(item.kickoff),locked:!!item.lockedAt,firstListedAt:item.firstListedAt,lockedAt:item.lockedAt}};
}
