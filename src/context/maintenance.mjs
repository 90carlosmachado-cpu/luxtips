// Own the complete maintenance sequence, including callers from older isolates.
// The expiring lease recovers automatically if the platform interrupts a job.
export async function maintenance(env,run){
 const now=Date.now(),token=now+240000,db=env.DB;
 if(!await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('maintenance',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until").bind(token,now).first())return {status:'locked'};
 try{return await run();}
 finally{await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='maintenance' AND until=?").bind(token).run();}
}
