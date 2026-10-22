import {readFile,readdir} from 'node:fs/promises';
import {fit2,predict2,forecastWindow} from '../src/legacy-worker.mjs';
import {enrichPrediction} from '../src/openfoot/live.mjs';
import {detailedPrediction,historyWithoutKnownRedCards} from '../src/context/details-model.mjs';
const dir='work/bulk-xg',history=[],details=[],xg=[];
for(const n of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+n,'utf8')))history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT'});
for(const n of await readdir(dir+'/details'))details.push(JSON.parse(await readFile(dir+'/details/'+n,'utf8')));
for(const n of await readdir(dir+'/observations'))xg.push(JSON.parse(await readFile(dir+'/observations/'+n,'utf8')));
const targets=JSON.parse(await readFile(dir+'/targets.json','utf8')).map(r=>r.fixture),now=Date.now(),clean=historyWithoutKnownRedCards(history,details,now),out=[];
for(const f of targets.filter(f=>f.ts>now&&f.ts<forecastWindow(now).end)){
 const h=clean.filter(h=>h.league===f.league),base=predict2(fit2(h,now),f);
 const p=detailedPrediction(history,details,f,enrichPrediction(h,xg.filter(o=>o.league===f.league),f,base,now),now);
 out.push({league:f.league,home:f.homeName,away:f.awayName,xg:p.xgEnrichment?.active,detail:p.matchDetailsEnrichment});
}
console.log(JSON.stringify({targets:out.length,withXg:out.filter(o=>o.xg).length,withDetails:out.filter(o=>o.detail.active).length,forecasts:out},null,2));
