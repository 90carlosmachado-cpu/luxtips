import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createOpenFootClient} from '../src/openfoot/client.mjs';
import {XG_COMPETITIONS,seasonLabel} from '../src/openfoot/config.mjs';
import {matchFixture,normalizeXg} from '../src/openfoot/normalize.mjs';
const dir='work/bulk-xg';
const previous=JSON.parse(await readFile(dir+'/status.json','utf8').catch(()=>'{}'));
const previousRequests=previous.requests||0;
const links=JSON.parse(await readFile(dir+'/links-approved.json','utf8').catch(()=>'[]'));
await mkdir(dir+'/observations',{recursive:true});
await mkdir(dir+'/inventory',{recursive:true});
const history=[];
for(const name of await readdir('work/bulk-history')) for(const f of JSON.parse(await readFile('work/bulk-history/'+name,'utf8'))) history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT'});
const line=(await readFile('.dev.vars','utf8')).split(/\r?\n/).find(l=>/^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key=line?.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
if(!key)throw Error('missing_key');
let last=0;
const client=createOpenFootClient({key,maximumRequests:6500,fetcher:async(...args)=>{
 const pause=680-(Date.now()-last);if(pause>0)await new Promise(r=>setTimeout(r,pause));
 last=Date.now();return fetch(...args);
}});
const errors=[],observations=new Map(),queue=[];
const status=async(phase)=>writeFile(dir+'/status.json',JSON.stringify({phase,at:Date.now(),requests:previousRequests+client.requests,queued:queue.length,validated:observations.size,errors:errors.length,leagues:Object.fromEntries(XG_COMPETITIONS.map(c=>[c.league,[...observations.values()].filter(o=>o.league===c.league).length]))}));
for(const name of await readdir('work'))if(/^replay-xg-\d+\.json$/.test(name)){
 const o=JSON.parse(await readFile('work/'+name,'utf8')),f=history.find(f=>f.id===o.fixtureId);
 if(f&&f.ts===o.kickoff&&f.league===o.league&&f.hg===o.result?.home&&f.ag===o.result?.away){
  observations.set(f.id,o);await writeFile(dir+'/observations/'+f.id+'.json',JSON.stringify(o));
 }
}
for(const name of await readdir(dir+'/observations')){const o=JSON.parse(await readFile(dir+'/observations/'+name,'utf8'));observations.set(o.fixtureId,o);}
await status('inventory');
for(const year of [2026,2025,2024,2023])for(const c of XG_COMPETITIONS){
 const local=history.filter(f=>f.league===c.league&&f.season===year);
 if(!local.length)continue;
 const path=dir+'/inventory/'+c.league+'-'+year+'.json';let matches;
 try{matches=JSON.parse(await readFile(path,'utf8'));}catch{
  matches=year===2025?JSON.parse(await readFile('work/inventory/'+c.league+'.json','utf8')):await client.allMatches(c.id,seasonLabel(year));
  await writeFile(path,JSON.stringify(matches));
 }
 for(const m of matches){
  if(m.status!=='finished'||m.period!=='FT')continue;
  const r=matchFixture(m,local,links);
  if(r.status==='matched'&&!observations.has(r.fixture.id))queue.push({m,f:r.fixture});
  else if(r.status!=='matched'&&local.some(f=>Math.abs(f.ts-Date.parse(m.kickoffAt))<86400000))errors.push({sourceId:m.id,league:c.league,status:r.status});
 }
 await status('inventory');
}
const coverage=JSON.parse(await readFile(dir+'/coverage.json','utf8').catch(()=>'{"teams":[]}'));
const needed=coverage.teams.filter(t=>t.total>=12&&!t.ready);
const priority=f=>needed.filter(t=>t.league===f.league&&(t.id===f.home||t.id===f.away)).length;
queue.sort((a,b)=>priority(b.f)-priority(a.f)||b.f.ts-a.f.ts||a.f.league-b.f.league);
await writeFile(dir+'/mapping-errors.json',JSON.stringify(errors));
console.log(JSON.stringify({phase:'download',queued:queue.length,reused:observations.size,requests:client.requests}));
await status('download');
for(let i=0;i<queue.length;i++){
 const {m,f}=queue[i];
 try{
  let payload;
  for(let attempt=0;attempt<3;attempt++){
   try{payload=await client.get('/v1/matches/'+encodeURIComponent(m.id)+'/xg');break;}
   catch(e){if(e.code==='rate_limit'||e.code==='rate_limit_cooldown'){await new Promise(r=>setTimeout(r,Math.min(60000,Math.max(1000,(e.retryAfter||Date.now()+60000)-Date.now()))));continue;}throw e;}
  }
  if(!payload)throw Error('rate_limit_retries_exhausted');
  const o={...normalizeXg(m,payload),fixtureId:f.id,league:f.league,kickoff:f.ts};
  observations.set(f.id,o);await writeFile(dir+'/observations/'+f.id+'.json',JSON.stringify(o));
 }catch(e){errors.push({fixtureId:f.id,league:f.league,code:e.code||'request_failed'});}
 if(i%20===0){await status('download');console.log(JSON.stringify({processed:i+1,remaining:queue.length-i-1,validated:observations.size,requests:client.requests}));}
}
await writeFile(dir+'/errors.json',JSON.stringify(errors));await status('complete');
console.log(JSON.stringify({phase:'complete',validated:observations.size,requests:client.requests,errors:errors.length}));
