import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createOpenFootClient} from '../src/openfoot/client.mjs';
import {normalizeMatchDetails} from '../src/openfoot/details.mjs';
import {matchFixture} from '../src/openfoot/normalize.mjs';
const dir='work/bulk-xg',history=[],known=new Map(),matches=new Map(),now=Date.now(),day=86400000;
for(const n of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+n,'utf8')))history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT'});
for(const n of await readdir(dir+'/details')){const d=JSON.parse(await readFile(dir+'/details/'+n,'utf8'));known.set(d.fixtureId,d);}
const links=JSON.parse(await readFile(dir+'/links-approved.json','utf8'));
for(const n of await readdir(dir+'/inventory'))for(const m of JSON.parse(await readFile(dir+'/inventory/'+n,'utf8'))){const r=matchFixture(m,history,links);if(r.status==='matched')matches.set(r.fixture.id,m);}
const weight=f=>Math.exp(-Math.LN2*(now-f.ts)/day/180);
const teams=JSON.parse(await readFile(dir+'/coverage.json','utf8')).teams;
const rows=history.filter(f=>f.ts>now-3*365*day&&f.ts+7200000<now),targets=new Map();
const upcoming=new Set(JSON.parse(await readFile(dir+'/targets.json','utf8')).flatMap(r=>[r.fixture.home,r.fixture.away]));
for(const t of teams){
 const all=rows.filter(f=>f.league===t.league&&(f.home===t.id||f.away===t.id));
 const maximum=all.filter(f=>!known.get(f.id)?.timeline.redCards.length).reduce((s,f)=>s+weight(f),0);
 if(maximum>=13)targets.set(t.id,{...t,target:13,upcoming:upcoming.has(t.id)});
}
const consumed=new Set(known.keys()),errors=[];let saved=0,last=0;
const line=(await readFile('.dev.vars','utf8')).split(/\r?\n/).find(l=>/^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key=line.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
const client=createOpenFootClient({key,maximumRequests:1600,fetcher:async(...args)=>{const wait=680-(Date.now()-last);if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();return fetch(...args);}});
async function payload(path,file){
 try{return JSON.parse(await readFile(file,'utf8'));}catch{}
 let p;for(let i=0;i<3;i++)try{p=await client.get(path);break;}catch(e){if(['rate_limit','rate_limit_cooldown'].includes(e.code)){await new Promise(r=>setTimeout(r,Math.min(60000,Math.max(1000,(e.retryAfter||Date.now()+60000)-Date.now()))));continue;}throw e;}
 if(!p)throw Error('rate_limit_exhausted');const safe={data:p.data,meta:{sources:p.meta?.sources,request_id:p.meta?.request_id,unavailable:p.meta?.unavailable}};await writeFile(file,JSON.stringify(safe));return safe;
}
function deficits(){
 const sums=new Map();
 for(const f of rows){const d=known.get(f.id);if(!d||d.timeline.redCards.length||d.shotProfiles.home.unknownSituationShots||d.shotProfiles.away.unknownSituationShots)continue;for(const id of [f.home,f.away])sums.set(id,(sums.get(id)||0)+weight(f));}
 return [...targets.values()].map(t=>({...t,sample:sums.get(t.id)||0,deficit:Math.max(0,t.target-(sums.get(t.id)||0))}));
}
async function status(phase){
 const d=deficits();await writeFile(dir+'/topup-status.json',JSON.stringify({phase,at:Date.now(),saved,requests:client.requests,errors:errors.length,ready:d.filter(t=>!t.deficit).length,teams:d.length,pending:d.filter(t=>t.deficit>0).map(({name,sample,deficit})=>({name,sample,deficit}))}));
}
await status('download');
for(let i=0;i<800;i++){
 const need=new Map(deficits().filter(t=>t.deficit>0).map(t=>[t.id,t]));
 if(!need.size)break;
 let best=null,bestScore=0;
 for(const f of rows){
  if(consumed.has(f.id)||!matches.has(f.id))continue;
  const score=[f.home,f.away].reduce((s,id)=>{const t=need.get(id);return s+(t?Math.min(t.deficit,weight(f))*(t.upcoming?2:1):0);},0);
  if(score>bestScore||(score===bestScore&&score>0&&f.ts>best.ts)){best=f;bestScore=score;}
 }
 if(!best)break;consumed.add(best.id);const m=matches.get(best.id),f=best;
 try{
  const x=await payload('/v1/matches/'+encodeURIComponent(m.id)+'/xg',dir+'/raw-xg/'+f.id+'.json');
  const e=await payload('/v1/matches/'+encodeURIComponent(m.id)+'/events',dir+'/raw-events/'+f.id+'.json');
  const d={...normalizeMatchDetails(m,x,e),fixtureId:f.id,league:f.league,kickoff:f.ts};
  known.set(f.id,d);await writeFile(dir+'/details/'+f.id+'.json',JSON.stringify(d));saved++;
 }catch(e){errors.push({fixtureId:f.id,code:e.code||'details_unavailable'});if(['run_budget','invalid_key','plan_restricted'].includes(e.code))break;}
 if(i%20===0){await status('download');console.log(JSON.stringify({saved,requests:client.requests,remainingTeams:deficits().filter(t=>t.deficit>0).length}));}
}
await writeFile(dir+'/topup-errors.json',JSON.stringify(errors));await status('complete');
console.log(JSON.stringify({phase:'complete',saved,requests:client.requests,errors:errors.length,remainingTeams:deficits().filter(t=>t.deficit>0).length}));
