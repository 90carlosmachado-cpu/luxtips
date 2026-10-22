import {readFile,readdir,writeFile} from 'node:fs/promises';
const history=[];
for(const n of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+n,'utf8')))history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9]});
const now=Date.now(),known=new Map();
for(const n of await readdir('work/bulk-xg/observations')){const o=JSON.parse(await readFile('work/bulk-xg/observations/'+n,'utf8'));known.set(o.fixtureId,o);}
const current=new Map(),targets=JSON.parse(await readFile('work/bulk-xg/targets.json','utf8'));
for(const f of [...history.filter(f=>f.season===2026),...targets.map(r=>r.fixture)])for(const side of ['home','away'])current.set(f.league+':'+f[side],{league:f.league,id:f[side],name:f[side+'Name']});
const teams=[...current.values()].map(t=>{
 const rows=history.filter(f=>f.league===t.league&&(f.home===t.id||f.away===t.id)&&f.ts>now-3*365*86400000&&f.ts+7200000<now);
 const measured=rows.filter(f=>{const o=known.get(f.id);return o&&o.league===f.league&&o.kickoff===f.ts&&o.result.home===f.hg&&o.result.away===f.ag&&o.observedAt<=now;});
 return {...t,total:rows.length,xg:measured.length,coverage:rows.length?measured.length/rows.length:0,ready:measured.length>=12&&measured.length/rows.length>=.7&&now-Math.max(0,...measured.map(f=>f.ts))<45*86400000};
});
await writeFile('work/bulk-xg/coverage.json',JSON.stringify({at:now,observations:known.size,teams},null,2));
console.log(JSON.stringify({observations:known.size,ready:teams.filter(t=>t.ready).length,teams:teams.length,tooLittleHistory:teams.filter(t=>t.total<12).length,minimumCoverage:Math.min(...teams.filter(t=>t.total>=12).map(t=>t.coverage)),byLeague:[39,140,78,135,61].map(league=>({league,ready:teams.filter(t=>t.league===league&&t.ready).length,teams:teams.filter(t=>t.league===league).length}))}));
