import fs from 'node:fs';
import {normalize,forecastWindow} from '../src/legacy-worker.mjs';
const config=fs.readFileSync('API KEY.dev.vars','utf8'),key=config.match(/^\s*API_FOOTBALL_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
if(!key)throw Error('missing_local_key');
const root='work/football-refresh';fs.mkdirSync(root,{recursive:true});
const leagues=[94,39,140,78,135,61,88,2,3,848],now=Date.now(),w=forecastWindow(now),season=new Date(now).getUTCFullYear()- (new Date(now).getUTCMonth()<6?1:0);
let last=0,requests=0;const fixtures=new Map(),cache=[];const status={phase:'fixtures',requests:0,fixtures:0,odds:0,injuries:0,errors:[]};
function checkpoint(){status.requests=requests;status.fixtures=fixtures.size;fs.writeFileSync(root+'/status.json',JSON.stringify(status));}
async function api(path,ttl){
 const wait=1100-(Date.now()-last);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));last=Date.now();requests++;
 const response=await fetch('https://v3.football.api-sports.io/'+path,{headers:{'x-apisports-key':key},signal:AbortSignal.timeout(20000)}),data=await response.json(),at=Date.now();
 if(!response.ok||Object.keys(data.errors||{}).length||!Array.isArray(data.response))throw Object.assign(Error('provider_error'),{code:Object.keys(data.errors||{})[0]||'http_'+response.status});
 const row={key:'api:'+path,data:{items:data.response,fetchedAt:at,paging:data.paging},expires:at+ttl};cache.push(row);
 return {items:data.response,paging:data.paging,fetchedAt:at};
}
for(const league of leagues){
 try{const r=await api('fixtures?league='+league+'&season='+season,6*3600000);for(const item of r.items){const f=normalize(item);if(f&&f.league===league)fixtures.set(f.id,{fixture:f,updatedAt:r.fetchedAt});}}
 catch(e){status.errors.push({league,code:e.code||e.name});}
 checkpoint();
}
fs.writeFileSync(root+'/fixtures.json',JSON.stringify([...fixtures.values()]));
const upcoming=[...fixtures.values()].map(x=>x.fixture).filter(f=>f.status==='NS'&&!f.finished&&f.ts>now&&f.ts<w.end).sort((a,b)=>a.ts-b.ts);
fs.writeFileSync(root+'/targets.json',JSON.stringify(upcoming));
status.phase='odds';checkpoint();
for(const f of upcoming){
 try{
  const path='odds?fixture='+f.id,r=await api(path,3*3600000),items=[...r.items],total=r.paging?.total||1;
  if(total>10)throw Object.assign(Error('pagination'),{code:'odds_page_limit'});
  for(let page=2;page<=total;page++)items.push(...(await api(path+'&page='+page,3*3600000)).items);
  const merged=new Map();for(const item of items.filter(x=>x.fixture?.id===f.id)){if(!merged.has(item.update))merged.set(item.update,{...item,bookmakers:[]});merged.get(item.update).bookmakers.push(...item.bookmakers||[]);}
  cache.push({key:'api:odds-complete?fixture='+f.id,data:{items:[...merged.values()].sort((a,b)=>Date.parse(b.update)-Date.parse(a.update)),fetchedAt:r.fetchedAt},expires:r.fetchedAt+3*3600000});status.odds++;
 }catch(e){status.errors.push({fixture:f.id,kind:'odds',code:e.code||e.name});}
 checkpoint();
}
status.phase='context';checkpoint();const sources=[];
for(const f of upcoming){
 for(const kind of ['injuries',...(f.ts-Date.now()<3*3600000?['lineups']:[])])try{
  const r=await api((kind==='lineups'?'fixtures/lineups':'injuries')+'?fixture='+f.id,kind==='lineups'?900000:4*3600000);
  if(Date.now()>=f.ts)continue;
  sources.push({fixtureId:f.id,kind,kickoff:f.ts,observedAt:Date.now(),sourceAt:r.fetchedAt,data:r.items.filter(x=>[f.home,f.away].includes(x.team?.id)&&(kind==='lineups'||x.fixture?.id===f.id))});status.injuries++;
 }catch(e){status.errors.push({fixture:f.id,kind,code:e.code||e.name});}
 checkpoint();
}
fs.writeFileSync(root+'/cache.json',JSON.stringify(cache));fs.writeFileSync(root+'/sources.json',JSON.stringify(sources));status.phase='complete';checkpoint();console.log(JSON.stringify(status));
