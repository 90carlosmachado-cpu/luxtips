import {readFile,readdir} from 'node:fs/promises';
import {normalizeMatchDetails} from '../src/openfoot/details.mjs';
const matches=new Map();
for(const n of await readdir('work/bulk-xg/inventory'))for(const m of JSON.parse(await readFile('work/bulk-xg/inventory/'+n,'utf8')))matches.set(m.id,m);
const errors=[];
for(const n of await readdir('work/bulk-xg/raw-events')){
 const e=JSON.parse(await readFile('work/bulk-xg/raw-events/'+n,'utf8')),m=matches.get(e.data.matchId),x=JSON.parse(await readFile('work/bulk-xg/raw-xg/'+n,'utf8'));
 try{normalizeMatchDetails(m,x,e);}catch(error){errors.push({id:n,source:m.id,code:error.code,expected:m.score,eventTypes:[...new Set(e.data.events?.map(e=>e.type))]});}
}
console.log(JSON.stringify({errors:errors.length,counts:Object.fromEntries([...new Set(errors.map(e=>e.code))].map(k=>[k,errors.filter(e=>e.code===k).length])),samples:errors.slice(0,8)},null,2));
