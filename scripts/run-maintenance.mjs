import {readFileSync,appendFileSync,mkdirSync} from 'node:fs';
const action=process.argv[2]||'calculate',count=Number(process.argv[3]||1);
if(!['calculate','data','context','status'].includes(action)||!Number.isInteger(count)||count<1||count>200)throw Error('invalid_arguments');
const token=readFileSync('work/operations/token','utf8').trim();
mkdirSync('work/operations',{recursive:true});
for(let i=0;i<count;i++){
 try{
  const response=await fetch('https://luxtips.90carlosmachado.workers.dev/api/admin/recalculate?action='+action,{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(90000)});
  const text=await response.text();let data;
  try{data=JSON.parse(text);}catch{data={status:'invalid_response',http:response.status};}
  const row={step:i+1,action,http:response.status,...data};
  appendFileSync('work/operations/'+action+'.jsonl',JSON.stringify(row)+'\n');
  console.log(JSON.stringify(row));
  if(!response.ok||data.status==='locked'||data.status==='unavailable')break;
  if(data.code?.includes('rate_limit')||data.code==='daily_budget')break;
 }catch(e){console.log(JSON.stringify({step:i+1,status:'request_failed',name:e.name}));break;}
 await new Promise(resolve=>setTimeout(resolve,1300));
}
