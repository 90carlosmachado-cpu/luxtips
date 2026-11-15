import {assets} from './assets.mjs';
export const manifest={id:'/',name:'LuxTips',short_name:'LuxTips',lang:'pt-PT',description:'Prognósticos de Futebol e Bigodes',start_url:'/?source=pwa',scope:'/',display:'standalone',background_color:'#101820',theme_color:'#101820',icons:[{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any maskable'},{src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}],shortcuts:[{name:'Futebol',url:'/'},{name:'Bigodes',url:'/big-odds'}]};
export async function pwaRoute(request){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/push/'))return new Response(request.method==='HEAD'?null:JSON.stringify({enabled:false,error:'As notificações do site foram descontinuadas.'}),{status:410,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(!['GET','HEAD'].includes(request.method))return null;
 if(path==='/manifest.webmanifest')return new Response(request.method==='HEAD'?null:JSON.stringify(manifest),{headers:{'Content-Type':'application/manifest+json','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 const asset=assets[path];if(!asset)return null;
 const headers={'Content-Type':asset.type,'X-Content-Type-Options':'nosniff','Cache-Control':path==='/sw.js'?'no-cache':path.startsWith('/icons/')?'public,max-age=86400':'no-cache'};
 if(path==='/sw.js')headers['Service-Worker-Allowed']='/';
 return new Response(request.method==='HEAD'?null:asset.base64?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body,{headers});
}
export function injectPwa(html){
 const cleaned=html.replace(/<link\b[^>]*rel=["'](?:shortcut icon|icon|apple-touch-icon|manifest)["'][^>]*>/gi,'');
 const head='<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png"><link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><script defer src="/pwa-client.js"></script>';
 return cleaned.replace('</head>',head+'</head>');
}

