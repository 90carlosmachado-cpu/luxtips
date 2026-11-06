import {BIGODDS_POLICY,goalModel,xgMarketModel,selectTicket,marketHit,MARKET_LABELS} from './bigodds-model.mjs';
const DAY=86400000;
export const lisbonDay=ts=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(ts);
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function validFixture(f){return Number.isInteger(f.id)&&Number.isInteger(f.home)&&Number.isInteger(f.away)&&f.home!==f.away&&Number.isFinite(f.ts);}
export function quoteMarket(m,s){
 if(m==='Match Winner')return {Home:'1',Draw:'D',Away:'2'}[s]||null;
 if(m==='Double Chance')return {'Home/Draw':'1X','Draw/Away':'X2'}[s]||null;
 if(m==='Both Teams Score')return {Yes:'BY',No:'BN'}[s]||null;
 if(m==='Goals Over/Under'){const match=s.match(/^(Over|Under) (1\.5|2\.5|3\.5)$/);return match?(match[1]==='Over'?'O':'U')+match[2].replace('.',''):null;}
 // Combo odds are never synthesized for publication. Add a provider mapping
 // only after the exact identity/selection contract has been verified.
 return null;
}
export function candidatesFromQuotes(fixtures,quotes,predict,now){
 const fs=new Map(fixtures.map(f=>[f.id,f])),groups=new Map();
 for(const q of quotes){
  const f=fs.get(q.fixture_id),code=quoteMarket(q.market,q.selection);
  if(!f||!code||q.kickoff!==f.ts||!Number.isFinite(q.odd)||q.odd<=1||!q.bookmaker||
     !(q.provider_at<=q.observed_at&&q.observed_at<=now&&q.provider_at>now-BIGODDS_POLICY.quoteMaxAge&&q.observed_at<f.ts))continue;
  const key=JSON.stringify([f.id,q.bookmaker]);if(!groups.has(key))groups.set(key,new Map());
  const group=groups.get(key),old=group.get(code);
  if(!old||q.provider_at>old.provider_at||q.provider_at===old.provider_at&&q.observed_at>old.observed_at)group.set(code,q);
 }
 const predictions=new Map(),out=[];
 for(const [key,group] of groups){
  const [id,bookmaker]=JSON.parse(key),f=fs.get(id);
  if(!predictions.has(id))predictions.set(id,predict(f));const model=predictions.get(id);
  for(const [market,q] of group){
   if(market==='D')continue;
   if(['1','2','1X','X2'].includes(market)){
    const trio=['1','D','2'].map(k=>group.get(k));
    if(trio.some(v=>!v)||new Set(trio.map(v=>v.provider_at)).size!==1)continue;
   }
   // The historical candidate required a complete paired totals/BTTS market.
   let marketProbability=null,referenceAt=q.provider_at;
   const trio=['1','D','2'].map(k=>group.get(k));
   if(['1','2','1X','X2'].includes(market)&&trio.every(Boolean)){const inv=trio.map(v=>1/v.odd),sum=inv.reduce((a,b)=>a+b,0),fair=inv.map(v=>v/sum);marketProbability=market==='1'?fair[0]:market==='2'?fair[2]:market==='1X'?fair[0]+fair[1]:fair[1]+fair[2];referenceAt=trio[0].provider_at;}
   const partner={O15:'U15',U15:'O15',O25:'U25',U25:'O25',O35:'U35',U35:'O35',BY:'BN',BN:'BY'}[market];
   if(partner&&group.get(partner)?.provider_at!==q.provider_at)continue;
   if(partner)marketProbability=(1/q.odd)/(1/q.odd+1/group.get(partner).odd);
   const modelProbability=model.probabilities[market];
   if(!Number.isFinite(marketProbability)||!Number.isFinite(modelProbability))continue;
   const decisionProbability=.5*modelProbability+.5*marketProbability;
   out.push({fixtureId:f.id,kickoff:f.ts,home:f.home,away:f.away,league:f.league,competition:f.competition,homeName:f.homeName,awayName:f.awayName,
    market,label:MARKET_LABELS[market],odd:q.odd,bookmaker,quoteAt:q.provider_at,observedAt:q.observed_at,source:'API-Football',estimated:false,
    probabilities:{...model.probabilities,[market]:decisionProbability},modelProbabilities:model.probabilities,modelProbability,marketProbability,referenceAt,selectionVersion:'bigodds-xg-market-v1',model:{...model,probabilities:undefined,cutoff:now}});
  }
 }
 return out;
}
export async function settleBigOdds(db,now=Date.now()){
 const pending=await db.prepare(`SELECT l.fixture_id,l.kickoff,l.snapshot,f.data fixture,r.hg,r.ag,r.settled_at FROM bigodds_legs l
 LEFT JOIN fixtures f ON f.id=l.fixture_id LEFT JOIN results r ON r.fixture_id=l.fixture_id WHERE l.status='pending'`).all();
 const updates=[];
 for(const row of pending.results){
  let f,s;try{f=JSON.parse(row.fixture);s=JSON.parse(row.snapshot);}catch{continue;}
  if(!f||f.id!==s.fixtureId||f.ts!==s.kickoff||f.home!==s.home||f.away!==s.away)continue;
  let status=null,result=null;
  if(['CANC','AWD','WO'].includes(f.status)){status='void';result={status:f.status};}
  else if(f.finished===true&&['FT','AET','PEN'].includes(f.status)&&Number.isInteger(row.hg)&&Number.isInteger(row.ag)&&row.hg>=0&&row.ag>=0&&row.settled_at<=now){
   // Markets are for regular time. AET/PEN scores cannot settle a 90-min bet.
   if(f.status!=='FT')continue;
   if(f.hg!==row.hg||f.ag!==row.ag)continue;
   status=marketHit(s.market,row.hg,row.ag)?'won':'lost';result={home:row.hg,away:row.ag,status:'FT',sourceSettledAt:row.settled_at};
  }
  if(status)updates.push(db.prepare("UPDATE bigodds_legs SET status=?,settled_at=?,result=? WHERE fixture_id=? AND status='pending'").bind(status,now,JSON.stringify(result),s.fixtureId));
 }
 if(updates.length)await db.batch(updates);
 // Losing closes immediately; unfinished legs continue settling in the ledger.
 await db.prepare(`UPDATE bigodds_tickets SET status=CASE WHEN EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.ticket_id=bigodds_tickets.id AND l.status='lost') THEN 'lost'
 WHEN NOT EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.ticket_id=bigodds_tickets.id AND l.status<>'void') THEN 'void' ELSE 'won' END,closed_at=?
 WHERE status='active' AND EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.ticket_id=bigodds_tickets.id)
 AND (EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.ticket_id=bigodds_tickets.id AND l.status='lost')
 OR NOT EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.ticket_id=bigodds_tickets.id AND l.status='pending'))`).bind(now).run();
 return {settled:updates.length};
}
export async function publishBigOdds(db,ticket,now=Date.now()){
 if(!ticket)return {status:'no_eligible_ticket'};
 if(ticket.legs.length<5||ticket.legs.length>12||ticket.odd<8||ticket.odd>15+1e-9)throw Error('invalid_bigodds_ticket');
 const odds=ticket.legs.reduce((p,l)=>p*l.odd,1);
 if(Math.abs(odds-ticket.odd)>1e-8||new Set(ticket.legs.map(l=>l.fixtureId)).size!==ticket.legs.length)throw Error('invalid_bigodds_legs');
 if(ticket.legs.some(l=>!BIGODDS_POLICY.markets.includes(l.market)||l.bookmaker!==ticket.bookmaker||l.estimated||l.odd<1.2||l.probability<.5||!(l.quoteAt>now-21600000&&l.quoteAt<=l.observedAt&&l.observedAt<=now&&l.kickoff>now+60000)))return {status:'inputs_expired'};
 const id=crypto.randomUUID(),data={id,createdAt:now,policy:BIGODDS_POLICY,bookmaker:ticket.bookmaker,odd:ticket.odd,legs:ticket.legs};
 const matches=ticket.legs.map(()=>'(f.id=? AND f.kickoff=? AND json_extract(f.data,\'$.home\')=? AND json_extract(f.data,\'$.away\')=?)').join(' OR ');
 const args=ticket.legs.flatMap(l=>[l.fixtureId,l.kickoff,l.home,l.away]);
 const insert=db.prepare(`INSERT INTO bigodds_tickets(id,created_at,policy,status,odd,bookmaker,data)
 SELECT ?,?,?,'active',?,?,? WHERE NOT EXISTS(SELECT 1 FROM bigodds_tickets WHERE status='active')
 AND (SELECT COUNT(*) FROM fixtures f WHERE (${matches}) AND f.finished=0 AND f.kickoff>?
 AND json_extract(f.data,'$.status')='NS' AND NOT EXISTS(SELECT 1 FROM results r WHERE r.fixture_id=f.id)
 AND NOT EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.fixture_id=f.id))=?`).bind(id,now,BIGODDS_POLICY.id,ticket.odd,ticket.bookmaker,JSON.stringify(data),...args,now+60000,ticket.legs.length);
 const statements=[insert,...ticket.legs.map(l=>db.prepare(`INSERT INTO bigodds_legs(fixture_id,ticket_id,kickoff,snapshot)
 SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM bigodds_tickets WHERE id=?)`).bind(l.fixtureId,id,l.kickoff,JSON.stringify(l),id))];
 const result=await db.batch(statements);
 return result[0].meta.changes?{status:'published',id,legs:ticket.legs.length,odd:ticket.odd}:{status:'blocked_or_inputs_changed'};
}
// Private operational command: only an authenticated D1 administrator can
// enqueue this key. No public request can bypass the 08h policy.
export async function archiveActiveBigOdds(db,now,requestId){
 const row=await db.prepare("SELECT id FROM bigodds_tickets WHERE status='active'").first();
 if(!row)return null;
 const result={status:'replaced',reason:'Substituído por nova versão a pedido do utilizador',requestId};
 await db.batch([
  db.prepare("UPDATE bigodds_legs SET status='void',settled_at=?,result=? WHERE ticket_id=? AND status='pending' AND EXISTS(SELECT 1 FROM bigodds_tickets WHERE id=? AND status='active')").bind(now,JSON.stringify(result),row.id,row.id),
  db.prepare("INSERT INTO openfoot_state(key,data) SELECT ?,? WHERE EXISTS(SELECT 1 FROM bigodds_tickets WHERE id=? AND status='active') ON CONFLICT(key) DO NOTHING").bind('bigodds:archive:'+row.id,JSON.stringify(result),row.id),
  db.prepare("UPDATE bigodds_tickets SET status='void',closed_at=? WHERE id=? AND status='active'").bind(now,row.id)
 ]);
 return row.id;
}
export function dailySlot(now,scheduledAt=now){
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(scheduledAt);
 if(clock!=='08:00'||now<scheduledAt||now>=scheduledAt-scheduledAt%60000+60000)return null;
 return {day:lisbonDay(scheduledAt),at:scheduledAt-scheduledAt%60000};
}
export async function syncBigOdds(env,now=Date.now(),clock=Date.now,scheduledAt=now){
 const db=env.DB,slot=dailySlot(now,scheduledAt);
 const command=await db.prepare("DELETE FROM openfoot_state WHERE key='bigodds:manual_rebuild' RETURNING data").first();
 if(command){
  let request;try{request=JSON.parse(command.data);}catch{}
  if(request?.policy===BIGODDS_POLICY.id&&Number.isFinite(request.expires)&&request.expires>now&&request.requestedAt<=now){
   await settleBigOdds(db,now);
   const archived=await archiveActiveBigOdds(db,now,request.id);
   let result;try{result=await generateBigOdds(env,now,clock);}catch(e){result={status:'manual_rebuild_failed',code:e.code||'generation_failed'};}
   await db.prepare("INSERT INTO openfoot_state(key,data) VALUES('bigodds:manual_result',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").bind(JSON.stringify({at:clock(),requestId:request.id,archived,...result})).run();
   return {manual:true,...result};
  }
 }
 // Capture the state at the scheduled boundary BEFORE refreshing settlements.
 const activeAtBoundary=slot?await db.prepare("SELECT id FROM bigodds_tickets WHERE created_at<=? AND (closed_at IS NULL OR closed_at>=?) LIMIT 1").bind(slot.at,slot.at).first():null;
 await settleBigOdds(db,now);
 if(!slot)return {status:'outside_daily_window'};
 const key='bigodds:daily0800:'+slot.day;
 const claim=await db.prepare("INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO NOTHING").bind(key,JSON.stringify({at:now,scheduledAt:slot.at,status:activeAtBoundary?'skipped_active':'attempted',ticketId:activeAtBoundary?.id??null})).run();
 if(!claim.meta.changes)return {status:'daily_slot_consumed'};
 if(activeAtBoundary)return {status:'skipped_active',ticketId:activeAtBoundary.id};
 if(await db.prepare("SELECT id FROM bigodds_tickets WHERE status='active'").first())return {status:'active_ticket'};
 return generateBigOdds(env,now,clock,slot);
}
export async function generateBigOdds(env,now,clock=Date.now,slot=null){
 const db=env.DB;
 const leagues=String(env.LEAGUES||'94,39,140,78,135,61,88,2,3,848').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>0);
 if(!leagues.length)return {status:'no_leagues'};
 const end=Date.parse(lisbonDay(Date.parse(lisbonDay(now)+'T12:00:00Z')+BIGODDS_POLICY.days*DAY)+'T00:00:00Z');
 // Query a superset at DST boundaries, then enforce the exact Lisbon dates.
 const rows=await db.prepare(`SELECT data FROM fixtures f WHERE f.finished=0 AND f.kickoff>? AND f.kickoff<? AND f.league IN (${leagues.map(()=>'?').join(',')})
 AND NOT EXISTS(SELECT 1 FROM bigodds_legs l WHERE l.fixture_id=f.id) AND NOT EXISTS(SELECT 1 FROM results r WHERE r.fixture_id=f.id)
 ORDER BY f.kickoff,f.id`).bind(now+60000,end+3600000,...leagues).all();
 const day=lisbonDay(now),days=Array.from({length:BIGODDS_POLICY.days},(_,i)=>lisbonDay(Date.parse(day+'T12:00:00Z')+i*DAY));
 const fixtures=rows.results.flatMap(r=>{try{const f=JSON.parse(r.data);return validFixture(f)&&f.status==='NS'&&days.includes(lisbonDay(f.ts))?[f]:[];}catch{return [];}});
 if(!fixtures.length)return {status:'no_upcoming_fixtures'};
 const history=[];let after=0;
 for(;;){
  const chunk=await db.prepare(`SELECT f.id,f.league,f.kickoff,json_extract(f.data,'$.home') home,json_extract(f.data,'$.away') away,json_extract(f.data,'$.hg') hg,json_extract(f.data,'$.ag') ag,COALESCE(r.settled_at,f.updated_at) settled_at
   FROM fixtures f LEFT JOIN results r ON r.fixture_id=f.id WHERE f.finished=1 AND f.id>? AND f.kickoff>=1672531200000 AND f.kickoff+7200000<=? AND COALESCE(r.settled_at,f.updated_at)<=?
   AND json_extract(f.data,'$.status')='FT' AND (r.fixture_id IS NULL OR (json_extract(f.data,'$.hg')=r.hg AND json_extract(f.data,'$.ag')=r.ag))
   AND f.league IN (${leagues.map(()=>'?').join(',')}) ORDER BY f.id LIMIT 4000`).bind(after,now,now,...leagues).all();
  history.push(...chunk.results);if(chunk.results.length<4000)break;after=chunk.results.at(-1).id;
 }
 const quotes=[];
 for(let start=0;start<fixtures.length;start+=50){
  const ids=fixtures.slice(start,start+50).map(f=>f.id);
  const q=await db.prepare(`SELECT fixture_id,kickoff,bookmaker,market,selection,odd,provider_at,observed_at FROM openfoot_market_quotes
   WHERE fixture_id IN (${ids.map(()=>'?').join(',')}) AND provider_at>? AND observed_at<=?`).bind(...ids,now-21600000,now).all();quotes.push(...q.results);
 }
 const detailRows=await db.prepare("SELECT fixture_id,league,kickoff,observed_at,json_extract(data,'$.fixtureId') data_id,json_extract(data,'$.league') data_league,json_extract(data,'$.kickoff') data_kickoff,json_extract(data,'$.observedAt') data_observed,json_extract(data,'$.homeXg') home_xg,json_extract(data,'$.awayXg') away_xg,json_extract(data,'$.result.home') hg,json_extract(data,'$.result.away') ag FROM openfoot_match_details WHERE observed_at<=? AND kickoff+7200000<=? ORDER BY fixture_id,observed_at").bind(now,now).all();
 const details=detailRows.results.map(r=>({...r,data:{fixtureId:r.data_id,league:r.data_league,kickoff:r.data_kickoff,observedAt:r.data_observed,homeXg:r.home_xg,awayXg:r.away_xg,result:{home:r.hg,away:r.ag}}}));
 const ticket=selectTicket(candidatesFromQuotes(fixtures,quotes,xgMarketModel(history,now,details),now));
 const publishedAt=clock();
 if(slot&&!dailySlot(publishedAt,slot.at))return {status:'daily_window_expired'};
 const result=await publishBigOdds(db,ticket,publishedAt);
 if(slot)await db.prepare("UPDATE openfoot_state SET data=? WHERE key=?").bind(JSON.stringify({at:publishedAt,scheduledAt:slot.at,...result}),'bigodds:daily0800:'+slot.day).run();
 return result;
}
export async function bigOddsFeed(db,cursor=null){
 if(cursor!==null&&(!/^\d{10,16}$/.test(cursor)||!Number.isSafeInteger(Number(cursor))))throw Error('invalid_cursor');
 const rows=await db.prepare(`SELECT * FROM bigodds_tickets WHERE created_at<? ORDER BY created_at DESC LIMIT 51`).bind(cursor?Number(cursor):Number.MAX_SAFE_INTEGER).all();
 const archives=await db.prepare("SELECT key,data FROM openfoot_state WHERE key LIKE 'bigodds:archive:%'").all(),archiveMap=new Map(archives.results.map(r=>[r.key.slice('bigodds:archive:'.length),JSON.parse(r.data)]));
 const page=rows.results.slice(0,50),activeRow=await db.prepare("SELECT * FROM bigodds_tickets WHERE status='active'").first();
 const assemble=async r=>{
  const original=JSON.parse(r.data),legs=await db.prepare('SELECT fixture_id,status,settled_at,result FROM bigodds_legs WHERE ticket_id=?').bind(r.id).all();
  const outcomes=new Map(legs.results.map(l=>[l.fixture_id,l]));
  return {...original,status:r.status,archived:archiveMap.has(r.id),archiveReason:archiveMap.get(r.id)?.reason??null,closedAt:r.closed_at,legs:original.legs.map(l=>{const o=outcomes.get(l.fixtureId);return {...l,status:o?.status||'pending',settledAt:o?.settled_at??null,result:o?.result?JSON.parse(o.result):null};})};
 };
 const history=[];for(const r of page)history.push(await assemble(r));
 const summary=await db.prepare(`SELECT COUNT(*) tickets,SUM(status='won') won,SUM(status='lost') lost,SUM(status='void') void,SUM(status='active') active FROM bigodds_tickets`).first();
 return {at:Date.now(),policy:BIGODDS_POLICY,current:activeRow?history.find(t=>t.id===activeRow.id)||await assemble(activeRow):null,history,summary,nextCursor:rows.results.length>50?String(page.at(-1).created_at):null};
}
export async function bigOddsResponse(req,env){
 if(!['GET','HEAD'].includes(req.method))return new Response('Método não permitido',{status:405,headers:{Allow:'GET, HEAD'}});
 try{
  const cursor=new URL(req.url).searchParams.get('cursor');
  if(cursor!==null&&!/^\d{10,16}$/.test(cursor))return json({error:'Cursor inválido.'},400);
  const response=json(await bigOddsFeed(env.DB,cursor));return req.method==='HEAD'?new Response(null,{headers:response.headers}):response;
 }catch{return json({error:'Big Odds temporariamente indisponível.'},503);}
}
