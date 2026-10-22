import {readFileSync,existsSync} from 'node:fs';
let key;
for(const path of ['.dev.vars','API KEY.dev.vars'])if(existsSync(path)){
 const match=readFileSync(path,'utf8').match(/^\s*API_FOOTBALL_KEY\s*=\s*(.+)$/m);
 if(match)key=match[1].trim().replace(/^['"]|['"]$/g,'');
}
if(!key)throw Error('missing_local_api_football_key');
const response=await fetch('https://v3.football.api-sports.io/status',{headers:{'x-apisports-key':key},signal:AbortSignal.timeout(20000)}),data=await response.json();
console.log(JSON.stringify({http:response.status,limits:Object.fromEntries([...response.headers].filter(([name])=>name.includes('ratelimit'))),errorCodes:Object.keys(data.errors||{}),subscription:data.response?.subscription,requests:data.response?.requests}));
