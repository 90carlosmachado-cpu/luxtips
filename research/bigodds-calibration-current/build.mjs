import {readFileSync,writeFileSync} from 'node:fs';
import {xgMarketModel} from '../../production/bigodds-model.mjs';
const R=JSON.parse(readFileSync(new URL('../../production/tests/xg-replay-data.json',import.meta.url)));
const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}),hour=t=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',hour:'2-digit',hourCycle:'h23'}).format(t));
const groups=new Map();for(const f of R.history){const day=fmt.format(f.kickoff);if(day<'2024-01-01')continue;const utc=Date.parse(day+'T08:00:00Z'),cut=Math.min(utc-(hour(utc)-8)*3600000,f.kickoff-60000);if(!groups.has(cut))groups.set(cut,[]);groups.get(cut).push(f);}
const out=[];for(const[cut,fs]of groups){const predict=xgMarketModel(R.history,cut,R.details);for(const f of fs){const m=predict(f),p=m.probabilities;out.push({id:f.id,day:fmt.format(f.kickoff),cut,league:f.league,xg:m.xgUsed,sample:[m.homeSample,m.awaySample],p:[p['1'],p['1X']-p['1'],p['2']],y:f.hg>f.ag?0:f.hg===f.ag?1:2});}}
writeFileSync(new URL('./predictions.json',import.meta.url),JSON.stringify(out));console.log(JSON.stringify({games:out.length,xg:out.filter(r=>r.xg).length,days:groups.size}));
