// RFC 8291 aes128gcm encryption and RFC 8292 VAPID, Web Crypto only.
export const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const utf=s=>new TextEncoder().encode(s);
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;};
export async function hkdf(ikm,salt,info,length){const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,length*8));}
export function validEndpoint(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!u.hash&&value.length<2048&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.notify.windows.com'));}catch{return false;}}
export function publicKey(jwk){return encode(join(new Uint8Array([4]),decode(jwk.x),decode(jwk.y)));}
export async function vapid(jwk,endpoint,now=Date.now()){
 const data=encode(utf(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+encode(utf(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+12*3600,sub:'https://luxtips.90carlosmachado.workers.dev/'})));
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf(data));
 return 'vapid t='+data+'.'+encode(sig)+', k='+publicKey(jwk);
}
export async function encryptPush(subscription,payload){
 const ua=decode(subscription.keys.p256dh),auth=decode(subscription.keys.auth);
 if(ua.length!==65||auth.length!==16)throw Error('Invalid subscription keys');
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const as=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
 const peer=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256);
 const ikm=await hkdf(shared,auth,join(utf('WebPush: info\0'),ua,as),32),salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await hkdf(ikm,salt,utf('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(ikm,salt,utf('Content-Encoding: nonce\0'),12);
 const bytes=utf(JSON.stringify(payload));if(bytes.length>3000)throw Error('Push payload too large');
 const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,join(bytes,new Uint8Array([2]))));
 return join(salt,new Uint8Array([0,0,16,0,65]),as,ciphertext);
}
export async function sendPush(subscription,payload,jwk,fetcher=(url,options)=>globalThis.fetch(url,options)){
 if(!validEndpoint(subscription.endpoint))throw Error('Invalid push service');
 let stage='vapid';
 try {
  const authorization=await vapid(jwk,subscription.endpoint);stage='encrypt';
  const body=await encryptPush(subscription,payload);stage='fetch';
  return await fetcher(subscription.endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:authorization,'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',TTL:'3600',Urgency:'high',Topic:payload.id.slice(0,32)},body});
 }catch(error){error.pushStage=stage;error.pushCategory=/Illegal invocation/i.test(error.message)?'illegal_invocation':/Cannot read properties/i.test(error.message)?'invalid_input':/fetch|network|connect/i.test(error.message)?'network_failure':'runtime_error';throw error;}
}
