export function validProviderPath(path){
 return typeof path==='string'&&path.length<2000&&/^(status|fixtures(?:\/(lineups|statistics|players))?|odds|injuries|leagues|teams|players)(\?|$)/.test(path)&&!path.includes('#');
}

// This is the entire Node process executed in the managed container image.
// The secret is supplied at runtime and never becomes part of an image or URL.
export const RELAY_PROCESS=String.raw`
const http=require('node:http');
const {Readable}=require('node:stream');
const allowed=/^\/(status|fixtures(?:\/(lineups|statistics|players))?|odds|injuries|leagues|teams|players)(\?|$)/;
http.createServer(async(req,res)=>{
 if(req.url==='/__ping'){res.end('ok');return;}
 if(req.method!=='GET'||!allowed.test(req.url)||req.url.length>2000){res.writeHead(400);res.end('{}');return;}
 try{
  const url=new URL(req.url,'https://v3.football.api-sports.io');
  if(url.origin!=='https://v3.football.api-sports.io')throw Error('origin');
  const r=await fetch(url,{headers:{'x-apisports-key':process.env.API_FOOTBALL_KEY,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(Number(r.headers.get('content-length'))>8000000){res.writeHead(502);res.end('{}');return;}
  const headers=Object.fromEntries([...r.headers].filter(([k])=>k==='content-type'||k.includes('ratelimit')||k==='retry-after'));
  res.writeHead(r.status,headers);
  if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
 }catch{res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({errors:{transport:'upstream_unavailable'},response:[]}));}
}).listen(8080,'0.0.0.0');
`;
