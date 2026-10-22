import {readFile,readdir,appendFile} from 'node:fs/promises';
const dir='work/bulk-xg';
if(process.argv[2]==='--ack'){
 const ids=process.argv[3].split(',');if(ids.some(id=>!/^\d+$/.test(id)))throw Error('invalid_id');
 await appendFile(dir+'/uploaded.txt',ids.join('\n')+'\n');
}else{
 const uploaded=new Set((await readFile(dir+'/uploaded.txt','utf8').catch(()=>'' )).split(/\s+/));
 const names=(await readdir(dir+'/observations')).filter(n=>!uploaded.has(n.replace('.json',''))).slice(0,75);
 const rows=[];for(const n of names)rows.push(JSON.parse(await readFile(dir+'/observations/'+n,'utf8')));
 console.log(JSON.stringify(rows));
}
