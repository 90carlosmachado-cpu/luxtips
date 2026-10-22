import {DurableObject} from 'cloudflare:workers';
import worker from './worker.mjs';
import {RELAY_PROCESS,validProviderPath} from './context/relay-process.mjs';

export class FootballRelay extends DurableObject{
 async request(path){
  if(!validProviderPath(path))throw Error('invalid_provider_path');
  const container=this.ctx.container;
  if(!container)throw Error('provider_container_unconfigured');
  if(!container.running)container.start({image:'cloudflare/debian-trixie',instance:'lite',enableInternet:true,entrypoint:['node','-e',RELAY_PROCESS],env:{API_FOOTBALL_KEY:this.env.API_FOOTBALL_KEY}});
  await container.setInactivityTimeout(60000);
  const port=container.getTcpPort(8080);
  let response;
  for(let attempt=0;attempt<40;attempt++){
   try{await port.fetch('http://container/__ping');break;}
   catch{if(attempt===39)throw Error('provider_container_start_timeout');await new Promise(resolve=>setTimeout(resolve,500));}
  }
  response=await port.fetch('http://container/'+path);
  const body=await response.text();
  if(body.length>8000000)throw Error('provider_payload_size');
  return {status:response.status,headers:Object.fromEntries(response.headers),body};
 }
}
export default worker;
