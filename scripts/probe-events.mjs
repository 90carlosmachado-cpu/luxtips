import {readFile,writeFile} from 'node:fs/promises';
import {createOpenFootClient} from '../src/openfoot/client.mjs';
const line=(await readFile('.dev.vars','utf8')).split(/\r?\n/).find(l=>/^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key=line.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');
const sample=JSON.parse(await readFile('tests/fixtures/openfoot-39.json','utf8'));
const r=await createOpenFootClient({key,maximumRequests:1}).get('/v1/matches/'+encodeURIComponent(sample.match.id)+'/events');
const safe={data:r.data,meta:{sources:r.meta?.sources}};
await writeFile('work/bulk-xg/events-probe.json',JSON.stringify(safe));
console.log(JSON.stringify(safe));
