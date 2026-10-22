export async function operationsAuthorized(req,db){
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!token||!db)return false;
 const row=await db.prepare("SELECT data FROM openfoot_state WHERE key='operations_access'").first();
 if(!row)return false;
 const access=JSON.parse(row.data);
 if(!Number.isFinite(access.expires)||access.expires<Date.now())return false;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return hash===access.hash;
}
