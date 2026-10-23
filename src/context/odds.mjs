import {api} from '../legacy-worker.mjs';
import {MARKETS,POLICY} from './policy.mjs';
const HOUR=3600000;
const MAP={
 'Match Winner':{Home:'H',Draw:'D',Away:'A'},
 'Double Chance':{'Home/Draw':'HX','Draw/Away':'XA','Home/Away':'HA'},
 'Goals Over/Under':{'Over 0.5':'O05','Over 1.5':'O15','Under 1.5':'U15','Over 2.5':'O25','Under 2.5':'U25','Over 3.5':'O35','Under 3.5':'U35','Under 4.5':'U45'},
 'Both Teams Score':{Yes:'BY',No:'BN'},
 'Total - Home':{'Over 0.5':'HO05','Over 1.5':'HO15','Under 1.5':'HU15','Under 2.5':'HU25'},
 'Total - Away':{'Over 0.5':'AO05','Over 1.5':'AO15','Under 1.5':'AU15','Under 2.5':'AU25'},
 'Home Team Score a Goal':{Yes:'HO05'},'Away Team Score a Goal':{Yes:'AO05'}
};
export function extractQuotes(items,fixture,observedAt,verifiedReceipt=false){
 if(!Array.isArray(items)||!Number.isFinite(observedAt)||observedAt>=fixture.ts)return [];
 const out=[];
 for(const f of items){
  const at=Date.parse(f.update);
  if(f.fixture?.id!==fixture.id||!Number.isFinite(at)||at>observedAt||at>=fixture.ts)continue;
  for(const b of f.bookmakers||[])if(typeof b.name==='string'&&b.name)for(const bet of b.bets||[])for(const value of bet.values||[]){
   const code=MAP[bet.name]?.[value.value],odd=Number(value.odd);
   if(code&&Number.isFinite(odd)&&odd>1)out.push({fixtureId:fixture.id,code,source:'API-Football',verifiedReceipt,bookmaker:b.name,market:code,selection:code,providerMarket:bet.name,providerSelection:value.value,odd,at,providerAt:at,observedAt});
  }
 }
 return out;
}
export function selectQuotes(quotes,now){
 const odds={};
 for(const q of quotes){
  if(!q.verifiedReceipt||q.at>now||q.observedAt>now||now-q.at>=POLICY.oddsMaxAge)continue;
  const old=odds[q.code];
  if(!old||q.at>old.at||q.at===old.at&&(q.odd>old.odd||q.odd===old.odd&&q.bookmaker<old.bookmaker))odds[q.code]=q;
 }
 return odds;
}
// Keep full bookmaker triplets separately from executable best prices. Never
// manufacture verified receipts from legacy raw caches.
export function retainedQuotes(quotes,now){
 const unique=new Map();
 for(const q of quotes){
  if(!q.verifiedReceipt||!Number.isFinite(q.at)||!Number.isFinite(q.observedAt)||q.at>q.observedAt||q.observedAt>now||now-q.at>=POLICY.oddsMaxAge)continue;
  if(['H','D','A'].includes(q.code)){
   const key=[q.fixtureId,q.bookmaker,q.code,q.at].join('|'),old=unique.get(key);
   if(!old||q.observedAt<old.observedAt)unique.set(key,q);
  }
 }
 for(const q of Object.values(selectQuotes(quotes,now)))unique.set([q.fixtureId,q.bookmaker,q.code,q.at].join('|'),q);
 return [...unique.values()];
}
export async function cachedOdds(db,f,now){
 const rows=await db.prepare("SELECT key,data FROM cache WHERE key IN (?,?,?) ORDER BY key").bind('api:odds-reviewed?fixture='+f.id,'api:odds-complete?fixture='+f.id,'api:odds?fixture='+f.id).all();
 let quotes=[];
 for(const r of rows.results){
  try{const p=JSON.parse(r.data);if(!Number.isFinite(p.fetchedAt)||p.fetchedAt>now||p.fetchedAt>=f.ts)continue;
   // Re-validate stored identities and clocks, never infer an observation time.
   const raw=Array.isArray(p.items)?extractQuotes(p.items,f,p.fetchedAt):[];
   quotes.push(...(r.key.includes('odds-reviewed')?(p.quotes||[]).filter(q=>q.fixtureId===f.id&&q.source==='API-Football'&&q.market===q.code&&q.selection===q.code&&MAP[q.providerMarket]?.[q.providerSelection]===q.code&&Number.isFinite(q.odd)&&q.odd>1&&Number.isFinite(q.at)&&Number.isFinite(q.observedAt)&&q.at<=q.observedAt&&q.observedAt<=now&&q.observedAt<f.ts):raw));
  }catch{}
 }
 const state=await db.prepare('SELECT data FROM openfoot_state WHERE key=?').bind('odds_collection:'+f.id).first();
 const newest={};for(const q of quotes)if(!newest[q.code]||q.at>newest[q.code].at)newest[q.code]=q;
 const saved=state?JSON.parse(state.data):{status:'incomplete_response',nextAt:now};
 const statuses=Object.fromEntries(MARKETS.map(m=>[m,newest[m]?(now-newest[m].at>=POLICY.oddsMaxAge?'quote_expired':'ready'):
  saved?.status==='temporary_failure'?'temporary_failure':saved?.complete?'market_unavailable':'incomplete_response']));
 return {quotes,odds:selectQuotes(quotes,now),statuses,state:saved};
}
export async function saveQuotes(db,f,quotes){
 const unique=[...new Map(quotes.map(q=>[[q.fixtureId,q.bookmaker,q.providerMarket,q.providerSelection,q.at].join('|'),q])).values()];
 for(let offset=0;offset<unique.length;offset+=10){const batch=unique.slice(offset,offset+10);await db.batch(batch.map(q=>db.prepare('INSERT OR IGNORE INTO openfoot_market_quotes(fixture_id,kickoff,bookmaker,market,selection,odd,provider_at,observed_at) VALUES(?,?,?,?,?,?,?,?)').bind(f.id,f.ts,q.bookmaker,q.providerMarket,q.providerSelection,q.odd,q.at,q.observedAt)));}
}
export async function collectFixtureOdds(env,f,now=Date.now(),request=api){
 const db=env.DB,key='odds_collection:'+f.id,old=await cachedOdds(db,f,now),prior=old.state?.kickoff===f.ts?old.state:{};
 if(f.finished||f.status!=='NS'||f.ts<=now)return {status:'not_prematch',odds:old.odds};
 if(prior.nextAt>now)return {status:prior.status,odds:old.odds,fromCache:true};
 let state={...prior,at:now,kickoff:f.ts};
 try{
  const page=prior.nextPage||1;
  // One page per existing data job. Force bypasses a partial 3h cache, not the
  // provider lease, quota or cooldown. Completed/unavailable responses back off.
  const r=await request(env,'odds?fixture='+f.id+(page>1?'&page='+page:''),3*HOUR,true,true);
  const total=r.paging?.total,current=r.paging?.current;
  const completedAt=Math.max(now,Date.now());
  if(r.refreshFailed||r.stale||!Number.isFinite(r.fetchedAt)||r.fetchedAt>completedAt)throw Error('temporary_failure');
  if(!Number.isInteger(total)||total<1||total>10||current!==page||page>1&&total!==prior.totalPages){state.nextPage=1;state.quotes=[];throw Error('incomplete_response');}
  const observedAt=r.fetchedAt;
  if(observedAt>=f.ts||Date.now()>=f.ts)return {status:'not_prematch',odds:old.odds};
  const incoming=extractQuotes(r.data,f,observedAt,true),quotes=[...(page>1?prior.quotes||[]:[]),...incoming];
  // Preserve bookmaker 1X2 observations as well as executable candidates.
  // Published snapshots still retain their exact selected quote.
  await saveQuotes(db,f,retainedQuotes(incoming,completedAt));
  const odds=selectQuotes(quotes,completedAt),complete=page===total;
  const relevant=['H','A'];
  const missing=relevant.filter(m=>!odds[m]);
  const missingKey=missing.join(','),repeat=complete&&prior.missingKey===missingKey&&(prior.probes||0)>0;
  const expired=quotes.length>0&&!Object.keys(odds).length;
  const status=!complete?'incomplete_response':expired?'quote_expired':missing.length?(repeat?'market_unavailable':'incomplete_response'):'ready';
  const delay=!complete?60000:status==='incomplete_response'||status==='quote_expired'&&!repeat?15*60000:3*HOUR;
  const expiries=Object.values(odds).map(q=>q.at+POLICY.oddsMaxAge).filter(t=>t>completedAt);
  state={at:now,kickoff:f.ts,status,nextPage:complete?1:page+1,totalPages:total,quotes:complete?[]:quotes,missing,missingKey,probes:complete?(repeat?(prior.probes||0)+1:1):prior.probes||0,
   nextAt:Math.min(completedAt+delay,...expiries),complete};
  const merged=retainedQuotes([...old.quotes,...quotes],completedAt);
  await db.prepare('INSERT INTO cache(key,data,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires').bind('api:odds-reviewed?fixture='+f.id,JSON.stringify({fetchedAt:completedAt,quotes:merged}),completedAt+3*HOUR).run();
  return {status,odds:selectQuotes(merged,completedAt),records:incoming.length};
 }catch(e){
  const reason=e.message==='incomplete_response'?'incomplete_response':'temporary_failure';
  state={...state,status:reason,nextAt:now+(reason==='incomplete_response'?15*60000:5*60000),code:/^(rate_limit|daily_budget)/.test(e.code||'')?e.code:'source_unavailable'};
  return {status:reason,odds:old.odds,code:state.code};
 }finally{await db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').bind(key,JSON.stringify(state)).run();}
}
