import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createOpenFootClient} from '../src/openfoot/client.mjs';
import {normalizeMatchDetails} from '../src/openfoot/details.mjs';
import {matchFixture} from '../src/openfoot/normalize.mjs';
const dir='work/bulk-xg';
for(const n of ['details','raw-xg','raw-events'])await mkdir(dir+'/'+n,{recursive:true});
const history=[];
for(const n of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+n,'utf8')))history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT'});
const {teams}=JSON.parse(await readFile(dir+'/coverage.json','utf8')),needed=new Set();
for(const t of teams)for(const f of history.filter(f=>f.league===t.league&&(f.home===t.id||f.away===t.id)).sort((a,b)=>b.ts-a.ts).slice(0,20))needed.add(f.id);
const links=JSON.parse(await readFile(dir+'/links-approved.json','utf8')),jobs=[];
for(const n of await readdir(dir+'/inventory'))for(const m of JSON.parse(await readFile(dir+'/inventory/'+n,'utf8'))){
 const r=matchFixture(m,history,links);if(r.status==='matched'&&needed.has(r.fixture.id))jobs.push({m,f:r.fixture});
}
jobs.sort((a,b)=>b.f.ts-a.f.ts);
const line=(await readFile('.dev.vars','utf8')).split(/\r?\n/).find(l=>/^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key=line.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
let last=0;
const client=createOpenFootClient({key,maximumRequests:2600,fetcher:async(...args)=>{const wait=680-(Date.now()-last);if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();return fetch(...args);}});
async function payload(path,file){
 try{return JSON.parse(await readFile(file,'utf8'));}catch{}
 let p;
 for(let i=0;i<3;i++)try{p=await client.get(path);break;}catch(e){
  if(e.code==='rate_limit'||e.code==='rate_limit_cooldown'){await new Promise(r=>setTimeout(r,Math.min(60000,Math.max(1000,(e.retryAfter||Date.now()+60000)-Date.now()))));continue;}throw e;
 }
 if(!p)throw Error('rate_limit_retries_exhausted');
 const safe={data:p.data,meta:{sources:p.meta?.sources,request_id:p.meta?.request_id,unavailable:p.meta?.unavailable}};
 await writeFile(file,JSON.stringify(safe));return safe;
}
const errors=[];let saved=0,processed=0;
async function status(phase){await writeFile(dir+'/details-status.json',JSON.stringify({phase,at:Date.now(),jobs:jobs.length,processed,saved,requests:client.requests,errors:errors.length}));}
await status('download');
console.log(JSON.stringify({phase:'download',jobs:jobs.length}));
for(const {m,f} of jobs){
 processed++;
 try{
  try{await readFile(dir+'/details/'+f.id+'.json');saved++;continue;}catch{}
  const xg=await payload('/v1/matches/'+encodeURIComponent(m.id)+'/xg',dir+'/raw-xg/'+f.id+'.json');
  const events=await payload('/v1/matches/'+encodeURIComponent(m.id)+'/events',dir+'/raw-events/'+f.id+'.json');
  const o={...normalizeMatchDetails(m,xg,events),fixtureId:f.id,league:f.league,kickoff:f.ts};
  await writeFile(dir+'/details/'+f.id+'.json',JSON.stringify(o));saved++;
 }catch(e){errors.push({fixtureId:f.id,league:f.league,code:e.code||'details_unavailable'});}
 if(processed%20===0){await status('download');console.log(JSON.stringify({processed,saved,requests:client.requests,errors:errors.length}));}
}
await writeFile(dir+'/details-errors.json',JSON.stringify(errors));await status('complete');
console.log(JSON.stringify({phase:'complete',processed,saved,requests:client.requests,errors:errors.length}));
