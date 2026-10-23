const DAY=86400000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function calendarFeatures(fixtures,target,team,now){
 const seen=new Map();
 for(const f of fixtures)if(f.id!==target.id&&f.finished&&finite(f.ts)&&f.ts+2*3600000<now&&f.ts<target.ts&&(f.home===team||f.away===team))seen.set(f.id,f);
 const rows=[...seen.values()].sort((a,b)=>b.ts-a.ts),last=rows[0];
 return {restDays:last?(target.ts-last.ts)/DAY:null,matches7:rows.filter(f=>target.ts-f.ts<7*DAY).length,matches14:rows.filter(f=>target.ts-f.ts<14*DAY).length,
  lastFixture:last?.id??null,scope:'available-competitions',completeCalendar:false};
}
export function normalizePlayers(rows,team,league){
 const ids=new Map();
 for(const row of rows||[]){
  if(!Number.isSafeInteger(row.player?.id))continue;
  const stats=(row.statistics||[]).filter(s=>s.team?.id===team&&s.league?.id===league);
  if(stats.length!==1)continue;const s=stats[0],minutes=s.games?.minutes,appearances=s.games?.appearences;
  if(!finite(minutes)||minutes<0||!finite(appearances)||appearances<0)continue;
  const goals=s.goals?.total,assists=s.goals?.assists;
  ids.set(row.player.id,{id:row.player.id,name:row.player.name,position:s.games.position,minutes,appearances,lineups:s.games.lineups??null,
   goals:finite(goals)&&goals>=0?goals:null,assists:finite(assists)&&assists>=0?assists:null,
   conceded:finite(s.goals?.conceded)?s.goals.conceded:null,saves:finite(s.goals?.saves)?s.goals.saves:null,
   rating:typeof s.games.rating==='string'&&Number.isFinite(Number(s.games.rating))?Number(s.games.rating):null});
 }
 return [...ids.values()];
}
export function availabilityFeatures(injuries,lineups,players,fixture,team){
 const known=Array.isArray(injuries),records=new Map(),conflicts=new Set();
 for(const r of injuries||[]){
  if(r.fixture?.id!==fixture.id||r.team?.id!==team||!Number.isSafeInteger(r.player?.id))continue;
  const p=r.player,key=p.id+':'+p.type+':'+p.reason;records.set(key,{id:p.id,name:p.name,status:p.type,reason:p.reason});
 }
 const lineup=(lineups||[]).filter(l=>l.team?.id===team);
 const ids=lineup.length===1?(lineup[0].startXI||[]).map(x=>x.player?.id).filter(Number.isSafeInteger):[];
 const confirmed=ids.length===11&&new Set(ids).size===11;
 const starters=confirmed?new Set(ids):null;
 const unavailable=[...records.values()].filter(p=>p.status==='Missing Fixture');
 for(const p of unavailable)if(starters?.has(p.id))conflicts.add(p.id);
 const absent=[...new Map(unavailable.filter(p=>!conflicts.has(p.id)).map(p=>[p.id,p])).values()];
 const usual=players.filter(p=>p.minutes>=270).sort((a,b)=>b.minutes-a.minutes).slice(0,11);
 const usualIds=new Set(usual.map(p=>p.id)),teamAppearances=Math.max(1,...players.map(p=>p.appearances));
 const out=confirmed?usual.filter(p=>!starters.has(p.id)):players.filter(p=>absent.some(a=>a.id===p.id));
 // Estimate lost goal production from observed scoring rates and usual minutes.
 // Same-position available substitutes supply the replacement rate. Missing
 // player statistics never imply a zero-quality replacement.
 let attackLoss=0,measured=0;
 for(const p of out){
  if(p.position==='Goalkeeper'||p.goals===null||p.minutes<270||p.appearances<3)continue;
  const substitutes=players.filter(q=>q.id!==p.id&&!usualIds.has(q.id)&&q.position===p.position&&q.minutes>=180&&q.goals!==null&&!absent.some(a=>a.id===q.id)&&(!confirmed||starters.has(q.id)));
  if(!substitutes.length)continue;
  const minutes=Math.min(90,p.minutes/teamAppearances);
  const own=p.goals/p.minutes,replacement=substitutes.reduce((s,q)=>s+q.goals,0)/substitutes.reduce((s,q)=>s+q.minutes,0);
  const reliability=p.minutes/(p.minutes+900);
  attackLoss+=Math.max(0,own-replacement)*minutes*reliability;measured++;
 }
 const keepers=players.filter(p=>p.position==='Goalkeeper'&&p.minutes>=270&&p.conceded!==null).sort((a,b)=>b.minutes-a.minutes);
 const usualKeeper=keepers[0],replacementKeeper=keepers.find(p=>p!==usualKeeper&&!absent.some(a=>a.id===p.id)&&(!confirmed||starters.has(p.id)));
 const keeperMissing=usualKeeper&&(confirmed?!starters.has(usualKeeper.id):absent.some(a=>a.id===usualKeeper.id));
 const goalkeeperLoss=keeperMissing&&replacementKeeper?clamp((replacementKeeper.conceded/replacementKeeper.minutes-usualKeeper.conceded/usualKeeper.minutes)*90*Math.min(usualKeeper.minutes,replacementKeeper.minutes)/(Math.min(usualKeeper.minutes,replacementKeeper.minutes)+900),-.15,.15):null;
 return {known,confirmed,formation:confirmed?lineup[0].formation:null,starters:confirmed?ids:null,absent,questionable:[...records.values()].filter(p=>p.status==='Questionable'),
  conflicts:[...conflicts],attackLoss:measured?clamp(attackLoss,0,.3):null,measuredPlayers:measured,
  missingImpactPlayers:absent.filter(p=>!players.some(q=>q.id===p.id)).length,
  goalkeeperLoss,replacementMethod:'same-position observed scoring rate; minutes shrinkage; max 0.30 goals; keeper conceded-rate max +/-0.15'};
}
export function marketReference(quotes,fixture,now){
 const books=new Map(),conflicts=new Set();
 for(const q of quotes||[]){
  if(q.fixtureId!==fixture.id||q.market!=='1X2'||!['H','D','A'].includes(q.selection)||!finite(q.odd)||q.odd<=1||typeof q.bookmaker!=='string'||!q.bookmaker||!finite(q.observedAt)||q.observedAt>now||q.observedAt>=fixture.ts||!finite(q.providerAt)||q.providerAt>q.observedAt||q.providerAt>=fixture.ts||now-q.providerAt>=6*3600000)continue;
  const key=q.bookmaker+':'+q.providerAt;
  if(!books.has(key))books.set(key,{bookmaker:q.bookmaker,at:q.providerAt,observedAt:q.observedAt,odds:{}});
  const b=books.get(key);
  if(b.odds[q.selection]!==undefined&&b.odds[q.selection]!==q.odd)conflicts.add(key);
  b.odds[q.selection]=q.odd;b.observedAt=Math.max(b.observedAt,q.observedAt);
 }
 // One latest complete snapshot per bookmaker, not one vote per cached fetch.
 const latest=new Map();
 for(const [key,b] of books){
  if(conflicts.has(key)||!['H','D','A'].every(k=>finite(b.odds[k])))continue;
  if(!latest.has(b.bookmaker)||b.at>latest.get(b.bookmaker).at)latest.set(b.bookmaker,b);
 }
 const complete=[...latest.values()];
 if(!complete.length)return {status:'unavailable',probabilities:null,books:0};
 const rows=complete.map(b=>{const sum=['H','D','A'].reduce((s,k)=>s+1/b.odds[k],0);return {...b,overround:sum-1,p:Object.fromEntries(['H','D','A'].map(k=>[k,(1/b.odds[k])/sum]))};});
 return {status:'available',books:rows.length,at:Math.min(...rows.map(b=>b.at)),observedAt:Math.max(...rows.map(b=>b.observedAt)),method:'mean-of-bookmaker-proportional-devig',probabilities:Object.fromEntries(['H','D','A'].map(k=>[k,rows.reduce((s,b)=>s+b.p[k],0)/rows.length])),quotes:rows.map(({p,...b})=>b)};
}
export function restAdjustment(history,fixture,now){
 // Learn the rest signal from the available pre-cutoff results. Counts are
 // explicitly partial when fixtures outside the configured competitions lack.
 const rows=history.filter(f=>f.finished&&finite(f.hg)&&finite(f.ag)&&f.ts+7200000<now&&f.ts>now-3*365*DAY).sort((a,b)=>a.ts-b.ts);
 const last=new Map(),buckets=new Map();
 for(const f of rows){
  const h=last.get(f.home),a=last.get(f.away);
  if(h&&a){
   const diff=clamp(Math.round((a-h)/DAY),-3,3),key=f.league+':'+diff;
   if(!buckets.has(key))buckets.set(key,{n:0,h:0,a:0});
   const b=buckets.get(key);b.n++;b.h+=f.hg;b.a+=f.ag;
  }
  last.set(f.home,f.ts);last.set(f.away,f.ts);
 }
 const home=calendarFeatures(history,fixture,fixture.home,now),away=calendarFeatures(history,fixture,fixture.away,now);
 if(home.restDays===null||away.restDays===null)return {home:1,away:1,homeCalendar:home,awayCalendar:away,sample:0};
 const diff=clamp(Math.round(home.restDays-away.restDays),-3,3),b=buckets.get(fixture.league+':'+diff);
 const league=[...buckets.entries()].filter(([k])=>k.startsWith(fixture.league+':')).map(([,v])=>v),n=league.reduce((s,v)=>s+v.n,0);
 if(!b||b.n<30||n<100)return {home:1,away:1,homeCalendar:home,awayCalendar:away,sample:b?.n||0};
 const h=league.reduce((s,v)=>s+v.h,0)/n,a=league.reduce((s,v)=>s+v.a,0)/n;
 const shrink=b.n/(b.n+200);
 return {home:h>0?clamp(1+shrink*(b.h/b.n/h-1),.92,1.08):1,away:a>0?clamp(1+shrink*(b.a/b.n/a-1),.92,1.08):1,
  homeCalendar:home,awayCalendar:away,sample:b.n,method:'empirical rest buckets; 200-match shrinkage; +/-8% cap; observational'};
}
