import {telegramBrand} from './telegram-brand.mjs';
import {LIST_VERSION,lisbonClock,readDailyLists} from './daily-list.mjs';
import {hydrateFootballList} from './football-list.mjs';
import {historySummary} from './list-presentation.mjs';
import {esc} from './front-office.mjs';
import {hash,read,selectionEvents,write} from './push.mjs';

const botUrl='https://t.me/LuxTipsFootballBot';
const botButton=JSON.stringify({inline_keyboard:[[{text:'Abrir miniapp Luxtips',url:botUrl}]]});
const hours=new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',hour:'2-digit',minute:'2-digit'});

const tipOf=g=>g.displayTip||g.winnerTip||g.recommendation;

function getPick(item,settled=false) {
  const g=item.payload,f=g.fixture,p=tipOf(g);
  if(!f||!['H','A'].includes(p?.market)||(!settled&&(p.bookmaker!=='Betano'||!Number.isFinite(p.odd)||p.odd<=1)))return null;
  return {
    id:item.id||String(item.gameId),
    match:(f.homeName+' – '+f.awayName).slice(0,100),
    home:{id:f.home,name:String(f.homeName).slice(0,100)},
    away:{id:f.away,name:String(f.awayName).slice(0,100)},
    competition:String(f.competition||'Futebol').slice(0,50),
    selection:((p.market==='H'?f.homeName:f.awayName)+' vence').slice(0,90),
    odd:settled?null:p.odd.toFixed(2).replace('.',','),
    time:hours.format(item.kickoff)
  };
}

function cardTeam(team) {
  const crest=Number.isSafeInteger(team.id)&&team.id>0
    ? `<span class="crest" aria-hidden="true" style="background-image:url('https://media.api-sports.io/football/teams/${team.id}.png')"></span>`
    : '';
  return `<span class="team">${crest}<span>${esc(team.name)}</span></span>`;
}

function card(title,picks,ticket) {
  return `<!doctype html><html lang="pt"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#090e13;color:#f2f6f8;font:27px system-ui,sans-serif}
  main{width:900px;padding:48px 58px;background:radial-gradient(ellipse at top left,#112c37,#090e13 55%)}
  .brand{display:block;width:250px;height:auto}h1{margin:24px 0;font-size:54px;line-height:1.05}
  article{background:#111920;border:2px solid #25313a;border-radius:22px;padding:22px 28px;margin-top:16px}
  small{display:block;color:#aebbc2}h2{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:12px 0 16px;font-size:35px;line-height:1.15}
  .team{display:inline-flex;align-items:center;gap:10px;max-width:100%;overflow-wrap:anywhere}
  .crest{flex:none;width:46px;height:46px;background:center/contain no-repeat}
  footer{display:flex;justify-content:space-between;gap:16px;color:#ceff75;font-weight:750}
  footer strong{color:#fff;white-space:nowrap}.note{margin:24px 0 0;color:#aebbc2;font-size:20px}
  </style><main><header><img class="brand" alt="LuxTips" src="data:image/png;base64,${telegramBrand}"></header><h1>${esc(title)}</h1>${ticket?`<p>Odd ${ticket.won?'final':'total'} ${esc(ticket.odd)} · Betano</p>`:''}
  ${picks.map(p=>`<article><small>${esc(p.competition)} · ${esc(p.time)}</small><h2>${cardTeam(p.home)}<span>–</span>${cardTeam(p.away)}</h2>
  <footer><span>${esc(p.selection)}</span><strong>${esc(p.odd)} · Betano</strong></footer></article>`).join('')}
  <p class="note">${ticket?"Futebol aos 90 minutos":"Futebol 1X2 aos 90 minutos"} · 18+</p></main></html>`;
}

function resultCard(title,pick,result) {
  return `<!doctype html><html lang="pt"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#090e13;color:#f2f6f8;font:27px system-ui,sans-serif;text-align:center}
  main{width:900px;padding:34px 45px;background:#111920;border:2px solid #293641;border-radius:25px}
  .brand{width:220px;height:auto}h1{margin:18px 0 24px;font-size:38px;color:${result.hit?'#ceff75':'#ff938a'};text-transform:uppercase}
  article{display:grid;grid-template-columns:1fr 180px 1fr;gap:12px;align-items:center;background:#0b1118;border:2px solid #293641;border-radius:22px;padding:25px 16px}
  .team{display:flex;flex-direction:column;align-items:center;gap:12px;overflow-wrap:anywhere;font-weight:700}
  .crest{width:105px;height:105px;background:center/contain no-repeat}
  strong{display:block;font-size:74px}small{color:#aebbc2;font-size:18px}footer{margin-top:24px}
  </style><main><img class="brand" alt="LuxTips" src="data:image/png;base64,${telegramBrand}"><h1>${esc(title)}</h1>
  <article>${cardTeam(pick.home)}<div><strong>${result.home}–${result.away}</strong><small>FINAL · 90 MIN</small></div>${cardTeam(pick.away)}</article>
  <footer>${esc(pick.selection)} · 1X2</footer></main></html>`;
}

async function loadPublishedHistory(db,now) {
  const [lists,legacy]=await Promise.all([
    readDailyLists(db,'openfoot_state','football'),
    db.prepare(`SELECT p.data,r.hg,r.ag FROM (
      SELECT fixture_id,kickoff,data FROM openfoot_current_picks
      UNION ALL SELECT fixture_id,kickoff,data FROM openfoot_current_alternatives
    ) p JOIN fixtures f ON f.id=p.fixture_id AND f.kickoff=p.kickoff
      JOIN results r ON r.fixture_id=p.fixture_id WHERE f.finished=1`).all()
  ]);
  const managedSince=new Map(lists.map(list=>[list.day,list.managedSince]));
  const historical=legacy.results.flatMap(row=>{
    const g=JSON.parse(row.data);
    const kickoff=g.fixture?.ts;
    if(!Number.isFinite(kickoff)||kickoff>(managedSince.get(lisbonClock(kickoff).day)??Infinity))return [];
    return [{...g,result:{home:row.hg,away:row.ag}}];
  });
  const items=lists.flatMap(list=>list.items).filter(item=>item.kind==='recommendation'&&item.kickoff<now);
  return [...historical,...await hydrateFootballList(db,items,now)];
}

async function resultEvents(db,prefix,now,loadHistory) {
  const rows=await db.prepare(`SELECT DISTINCT ids.value AS id FROM openfoot_state s
    JOIN json_each(s.data,'$.selectionIds') ids
    JOIN results r ON r.fixture_id=CAST(ids.value AS INTEGER)
    LEFT JOIN openfoot_state delivery ON delivery.key=(?1||'football-result:')||ids.value
    WHERE substr(s.key,1,length(?1))=?1
      AND (substr(s.key,length(?1)+1,14) IN ('football-lock:','football-late:')
        OR substr(s.key,length(?1)+1,16)='football-repost:')
      AND json_extract(s.data,'$.status')='sent'
      AND r.settled_at>=?2
      AND (delivery.key IS NULL OR (json_extract(delivery.data,'$.status')='retry' AND json_extract(delivery.data,'$.nextAt')<=?3))`)
    .bind(prefix,now-86400000,now).all();
  if(!rows.results.length)return [];
  const wanted=new Set(rows.results.map(row=>row.id));
  const settled=new Map();
  for(const g of await loadPublishedHistory(db,now)){
    const f=g.fixture,p=tipOf(g),result=g.result;
    if(!f||g.history?.kind==='analysis'||(g.historyStatus??'settled')!=='settled'||!['H','D','A'].includes(p?.market)||
      !Number.isSafeInteger(result?.home)||!Number.isSafeInteger(result?.away)||result.home<0||result.away<0)continue;
    const id=[f.id,f.ts,p.market].join(':');
    const outcome=result.home===result.away?'D':result.home>result.away?'H':'A';
    settled.set(id,{id,g,result:{...result,hit:p.market===outcome}});
  }
  const performance=historySummary(await loadHistory());
  return [...settled.values()].filter(entry=>wanted.has(entry.id)).map(({id,g,result})=>({
    key:'football-result:'+id,sport:'football',createdAt:now,expiresAt:now+60000,selectionIds:[id],
    pick:getPick({payload:g,id,kickoff:g.fixture.ts},true),result:{...result,performance}
  })).filter(event=>event.pick);
}

async function createPhoto(env,title,picks,result,ticket) {
  const response=await env.FOOTBALL_BROWSER.quickAction('screenshot',{
    html:result?resultCard(title,picks[0],result):card(title,picks,ticket),viewport:{width:900,height:490},
    screenshotOptions:{type:'png',fullPage:true},gotoOptions:{timeout:10000},
    setJavaScriptEnabled:false
  });
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('telegram_render_failed');
  const png=await response.blob();
  if(!png.size||png.size>10_000_000)throw Error('telegram_render_failed');
  return png;
}

function resultCaption(title,pick,result) {
  const {performance}=result;
  const stats=performance.total?`\n📊 Acerto histórico · ${performance.rate.toFixed(1).replace('.',',')}% (${performance.correct} em ${performance.total})`:'';
  return `${result.hit?'✅':'❌'} ${title}\n\n⚽ ${pick.home.name} ${result.home}–${result.away} ${pick.away.name}\n🎯 ${pick.selection} · 1X2${stats}${result.hit?'\n\n🔥 Se acompanhaste este prognóstico, deixa uma reação!':''}`;
}

export async function notifyTelegram(env,now=Date.now(),send=fetch,loadHistory) {
  const token=env.TELEGRAM_BOT_TOKEN,channel=env.TELEGRAM_CHANNEL_ID;
  if(!token||!channel||!env.FOOTBALL_BROWSER)return {status:'unconfigured'};
  const db=env.DB,prefix='telegram:'+await hash(channel)+':',lock=prefix+'lock',until=now+120000;
  if(!await db.prepare('INSERT INTO openfoot_locks(key,until) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until').bind(lock,until,now).first())return {status:'locked'};
  let sent=0;
  try {
    const baseline=await read(db,prefix+'baseline');
    if(!baseline){
      await write(db,prefix+'baseline',{at:now});
      return {status:'initialized',sent};
    }
    const day=lisbonClock(now).day;
    const list=await read(db,'daily_list:'+LIST_VERSION+':football:'+day);
    const items=(list?.items||[]).filter(i=>i.kind==='recommendation'&&i.payload?.published&&i.kickoff>now);
    const valid=await hydrateFootballList(db,items,now);
    const current=new Map(valid.filter(g=>g.historyStatus==='pending').map(g=>[g.fixture.id,g]));
    const accepted=items.filter(i=>current.has(i.gameId)).map(i=>({...i,payload:current.get(i.gameId)})).filter(item=>getPick(item));
    const tickets=(await db.prepare("SELECT id,created_at,status,data FROM bigodds_tickets WHERE status='active' AND created_at>?").bind(now-3600000).all()).results;
    const ticketsByEvent=new Map(tickets.map(ticket=>['bigodds-published:'+ticket.id,ticket]));
    const events=selectionEvents(list?[{...list,items:accepted}]:[],tickets,now);
    const winners=await db.prepare(`SELECT t.id,t.data,t.closed_at,
      (SELECT json_group_array(l.fixture_id) FROM bigodds_all_legs l WHERE l.ticket_id=t.id AND l.status='won') AS winners
      FROM bigodds_tickets t WHERE t.status='won' AND t.closed_at>? AND t.closed_at<=?
      AND NOT EXISTS(SELECT 1 FROM bigodds_all_legs l WHERE l.ticket_id=t.id AND l.status IN ('pending','lost'))
      AND EXISTS(SELECT 1 FROM bigodds_all_legs l WHERE l.ticket_id=t.id AND l.status='won')
      AND NOT EXISTS(SELECT 1 FROM openfoot_state s WHERE s.key=?||t.id
        AND (json_extract(s.data,'$.status')<>'retry' OR json_extract(s.data,'$.nextAt')>?))`)
      .bind(now-86400000,now,prefix+'bigodds-won:',now).all();
    for(const winner of winners.results){
      const key='bigodds-won:'+winner.id;
      ticketsByEvent.set(key,winner);
      events.push({key,sport:'bigodds',createdAt:winner.closed_at,expiresAt:winner.closed_at+86400000});
    }
    try {events.push(...await resultEvents(db,prefix,now,loadHistory));}
    catch {console.error(JSON.stringify({event:'telegram_results_unavailable'}));}
    const picks=new Map(accepted.map(item=>{const pick=getPick(item);return [pick.id,pick];}));
    const morningKey=prefix+'football-lock:'+day;
    for(const event of events){
      if(event.createdAt<=baseline.at||event.expiresAt<=now)continue;
      const football=event.sport==='football';
      const key=prefix+(football?event.key:event.key.replace('bigodds-published:','bigodds-card:'));
      const previous=await read(db,key);
      if(previous&&(previous.status!=='retry'||previous.nextAt>now))continue;
      const late=event.key.startsWith('football-late:');
      if(late&&(await read(db,morningKey))?.selectionIds?.includes(event.selectionIds[0]))continue;
      const {result,pick}=event;
      const storedTicket=ticketsByEvent.get(event.key);
      const ticket=storedTicket?JSON.parse(storedTicket.data):null;
      const wonIds=storedTicket?.winners?new Set(JSON.parse(storedTicket.winners)):null;
      const wonLegs=wonIds?ticket.legs.filter(leg=>wonIds.has(leg.fixtureId)):[];
      if(wonIds&&!wonLegs.length)continue;
      const finalOdd=wonIds?wonLegs.reduce((odd,leg)=>odd*leg.odd,1):ticket?.odd;
      const ticketOdd=ticket?finalOdd.toFixed(2).replace('.',','):null;
      const voidCount=wonIds?ticket.legs.length-wonLegs.length:0;
      const selected=ticket?ticket.legs.map(leg=>({
        home:{id:leg.home,name:leg.homeName},
        away:{id:leg.away,name:leg.awayName},
        match:leg.homeName+' – '+leg.awayName,
        competition:leg.competition||'Futebol',
        time:lisbonClock(leg.kickoff).day.slice(5).split('-').reverse().join('/')+' · '+hours.format(leg.kickoff),
        selection:wonIds&&!wonIds.has(leg.fixtureId)?leg.label+' · Anulada':leg.label,
        odd:leg.odd.toFixed(2).replace('.',',')
      })):result?[pick]:(event.selectionIds||[]).map(id=>picks.get(id)).filter(Boolean);
      const title=ticket?(wonIds?'Big Odds ganho':'Big Odds'):result?(result.hit?'Prognóstico certo':'Prognóstico falhado'):late?'Novo prognóstico':'Prognósticos do dia';
      if(!selected.length)continue;
      const text=result
        ? resultCaption(title,pick,result)
        : football
        ? `⚽ LuxTips · ${title}\n\n${selected.map(p=>`🏟️ ${p.match} · ${p.time}\n🎯 ${p.selection} · 1X2\n📊 Odd ${p.odd} · Betano`).join('\n\n')}`
        : wonIds
        ? `✅ LuxTips · Big Odds ganho\n\n📊 Odd final ${ticketOdd} · Betano\n⚽ ${wonLegs.length} ${wonLegs.length===1?'seleção certa':'seleções certas'}${voidCount?' · '+voidCount+(voidCount===1?' anulada':' anuladas'):''}`
        : `🔥 LuxTips · Big Odds\n\n📊 Odd total ${ticketOdd} · Betano\n⚽ ${selected.length} seleções`;
      const form=new FormData();
      form.set('chat_id',channel);
      form.set('reply_markup',botButton);
      form.set('caption',text.slice(0,1024));
      form.set('photo',await createPhoto(env,title,selected,result,ticket?{odd:ticketOdd,won:!!wonIds}:null),'luxtips.png');
      // Record the attempt before sending. An ambiguous timeout must not cause a duplicate.
      const state={status:'sending',selectionIds:event.selectionIds,at:now};
      await write(db,key,state);
      let response,receipt;
      try {
        response=await send(`https://api.telegram.org/bot${token}/sendPhoto`,{
          method:'POST',body:form,signal:AbortSignal.timeout(10000)
        });
        receipt=await response.json();
      } catch {
        await write(db,key,{...state,status:'unknown'});
        continue;
      }
      if(response.ok&&receipt.ok&&Number.isInteger(receipt.result?.message_id)){
        await write(db,key,{...state,status:'sent',messageId:receipt.result.message_id});
        sent++;
      }else if(response.status===429){
        const delay=Math.max(1,Number(receipt.parameters?.retry_after)||60);
        await write(db,key,{...state,status:'retry',nextAt:now+delay*1000});
        break;
      }else{
        await write(db,key,{...state,status:'rejected',httpStatus:response.status});
      }
    }
    return {status:'ok',sent};
  }finally{
    await db.prepare('UPDATE openfoot_locks SET until=0 WHERE key=? AND until=?').bind(lock,until).run();
  }
}
