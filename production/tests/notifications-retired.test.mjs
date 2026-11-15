import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pwaRoute,injectPwa} from '../pwa.mjs';
import {assets} from '../assets.mjs';

test('retired push routes reject every subscription operation without database access',async()=>{
 const env=new Proxy({},{get(){throw Error('retired push must not access bindings');}});
 for(const [path,method] of [['config','GET'],['config','HEAD'],['subscription','POST'],['subscription','DELETE']]){
  const response=await pwaRoute(new Request('https://luxtips.test/api/push/'+path,{method}),env);
  assert.equal(response.status,410);assert.equal(response.headers.get('Cache-Control'),'no-store');
  if(method==='HEAD')assert.equal(await response.text(),'');
  else assert.equal((await response.json()).enabled,false);
 }
});

test('PWA retains installation assets and offline support without notification controls',async()=>{
 const html=injectPwa('<html><head></head><body><header>LuxTips</header></body></html>');
 assert.match(html,/rel="manifest"/);assert.match(html,/src="\/pwa-client.js"/);
 assert.doesNotMatch(html,/pwa-panel|Notificações|pwa-enable|pwa-disable/);
 for(const path of ['/manifest.webmanifest','/sw.js','/icons/icon-192.png','/offline.html']){
  const response=await pwaRoute(new Request('https://luxtips.test'+path));
  assert.equal(response.status,200,path);
 }
});

test('service worker retires device subscriptions and old push caches without push handlers',async()=>{
 const handlers=new Map(),deleted=[];let unsubscribed=0,closed=0,claimed=0,activation;
 const context=vm.createContext({URL,Promise,console,
  self:{addEventListener:(type,handler)=>handlers.set(type,handler),
   registration:{pushManager:{getSubscription:async()=>({unsubscribe:async()=>{unsubscribed++;}})},getNotifications:async()=>[{close(){closed++;}}]},
   clients:{claim:async()=>{claimed++;}},location:{origin:'https://luxtips.test'}},
  caches:{keys:async()=>['luxtips-static-v1','luxtips-static-v2','luxtips-push-seen-v1','unrelated-cache'],delete:async key=>{deleted.push(key);}}
 });
 vm.runInContext(assets['/sw.js'].body,context);
 assert.deepEqual([...handlers.keys()],['install','activate','fetch']);
 handlers.get('activate')({waitUntil(task){activation=task;}});await activation;
 assert.deepEqual(deleted,['luxtips-static-v1','luxtips-push-seen-v1']);
 assert.equal(unsubscribed,1);assert.equal(closed,1);assert.equal(claimed,1);
});

test('client silently cancels old subscriptions and preserves unrelated local preferences',async()=>{
 const stored=new Map([['luxtips-push','old'],['luxtips-push-token','old'],['theme','dark']]);
 let unsubscribed=0,registration;
 const context=vm.createContext({URL,console,location:{href:'https://luxtips.test/'},
  localStorage:{removeItem:key=>stored.delete(key)},
  navigator:{serviceWorker:{register(path,options){assert.equal(path,'/sw.js');assert.equal(options.scope,'/');registration=Promise.resolve({pushManager:{getSubscription:async()=>({unsubscribe:async()=>{unsubscribed++;}})}});return registration;}}}
 });
 vm.runInContext(assets['/pwa-client.js'].body,context);
 await registration;await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual([...stored],[['theme','dark']]);assert.equal(unsubscribed,1);
});
