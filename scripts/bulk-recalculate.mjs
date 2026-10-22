import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {enrichPrediction} from '../src/openfoot/live.mjs';
// Use the deployed implementation verbatim; additional exports are local only.
const dir='work/bulk-xg';
const original=await readFile('src/legacy-worker.mjs','utf8');
await writeFile(dir+'/legacy-eval.mjs',original);
const {fit2,predict2,competitionEvidence,winnerTip,applyPricing,publishDailyPicks,forecastWindow}=await import('../'+dir+'/legacy-eval.mjs');
const history=[];
for(const n of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+n,'utf8')))history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9],finished:true,status:'FT'});
const observations=[];
const uploaded=new Set((await readFile(dir+'/uploaded.txt','utf8')).split(/\s+/));
for(const n of await readdir(dir+'/observations'))if(uploaded.has(n.replace('.json','')))observations.push(JSON.parse(await readFile(dir+'/observations/'+n,'utf8')));
const targets=[];
for(const n of await readdir(dir))if(/^targets-\d+\.json$/.test(n))targets.push(...JSON.parse(await readFile(dir+'/'+n,'utf8')));
const now=Date.now(),window=forecastWindow(now),games=[],coverage=[];
const sqlQuote=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const literal=(sql,params)=>{let i=0;const value=sql.replace(/\?/g,()=>sqlQuote(params[i++]));if(i!==params.length)throw Error('parameter_mismatch');return value;};
const writes=[];
const eligibleHistory=history.filter(f=>f.ts>now-3*365*86400000&&f.ts+7200000<now);
for(const row of targets){
 const f=row.fixture;if(f.ts<=now||f.ts>=window.end||f.status!=='NS')continue;
 const h=eligibleHistory.filter(h=>h.league===f.league);
 const baseline=competitionEvidence(predict2(fit2(h,now),f),f.league);
 const p=enrichPrediction(h,observations.filter(o=>o.league===f.league),f,baseline,now);
 const ids=[f.home,f.away];
 for(const id of ids)if(!coverage.some(c=>c.league===f.league&&c.id===id)){
  const rows=h.filter(x=>x.home===id||x.away===id),measured=rows.filter(x=>observations.some(o=>o.fixtureId===x.id&&o.kickoff===x.ts&&o.result.home===x.hg&&o.result.away===x.ag&&o.observedAt<=now));
  coverage.push({league:f.league,id,name:id===f.home?f.homeName:f.awayName,total:rows.length,xg:measured.length,coverage:measured.length/rows.length});
 }
 if(!p.xgEnrichment?.active)continue;
 let g=applyPricing({...row,prediction:p,recommendation:null,updatedAt:now,phase:'preliminary',
  winnerTip:winnerTip(p,null,row.odds,{now,sourceUpdatedAt:row.sourceUpdatedAt,stale:row.stale})},now);
 const data=JSON.stringify(g),version=p.version+'@'+f.ts+':bulk:'+now;
 writes.push(literal('INSERT OR IGNORE INTO forecasts(fixture_id,version,phase,created_at,kickoff,data) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM fixtures WHERE id=? AND kickoff=? AND finished=0) AND ?<?',[f.id,version,'preliminary',now,f.ts,data,f.id,f.ts,now,f.ts]));
 writes.push(literal("INSERT INTO cache(key,data,expires) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM fixtures WHERE id=? AND kickoff=? AND finished=0) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires WHERE COALESCE(json_extract(cache.data,'$.updatedAt'),0)<=?",['forecast:'+f.id,data,f.ts+86400000,f.id,f.ts,now]));
 games.push(g);
}
// Execute the unchanged publication policy against a small snapshot. Production
// reruns every INSERT guard, so concurrent publications remain protected.
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE openfoot_current_picks(day TEXT,fixture_id INTEGER,recovered INTEGER,alternative INTEGER);CREATE TABLE openfoot_current_alternatives(day TEXT);CREATE TABLE openfoot_pick_revisions(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER DEFAULT 0,data TEXT);CREATE TABLE openfoot_alternative_revisions(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);CREATE TABLE cache(key TEXT);CREATE TRIGGER mirror_pick AFTER INSERT ON openfoot_pick_revisions BEGIN INSERT INTO openfoot_current_picks VALUES(new.day,new.fixture_id,new.recovered,new.alternative);END;CREATE TRIGGER mirror_alt AFTER INSERT ON openfoot_alternative_revisions BEGIN INSERT INTO openfoot_current_alternatives VALUES(new.day);END;');
const [picks,alternatives]=JSON.parse(await readFile(dir+'/publications.json','utf8'));
for(const r of picks)db.prepare('INSERT INTO openfoot_current_picks VALUES(?,?,?,?)').run(r.day,r.fixture_id,r.recovered,r.alternative);
for(const r of alternatives)db.prepare('INSERT INTO openfoot_current_alternatives VALUES(?)').run(r.day);
const shim={prepare(query){let params=[];return{bind(...p){params=p;return this;},async all(){return{results:db.prepare(query).all(...params)};},async first(){return db.prepare(query).get(...params)||null;},async run(){const r=db.prepare(query).run(...params);if(r.changes)writes.push(literal(query,params));return{meta:{changes:Number(r.changes)}};}};}};
if(process.argv.includes('--publish'))await publishDailyPicks(shim,games,now);
// Only invalidate the disposable response cache; immutable history is retained.
writes.push("DELETE FROM cache WHERE key='public:games:v1'");
await mkdir(dir+'/recalculated',{recursive:true});
await writeFile(dir+'/recalculated/'+now+'.json',JSON.stringify({at:now,coverage,games:games.map(g=>({id:g.fixture.id,league:g.fixture.league,home:g.fixture.homeName,away:g.fixture.awayName,xg:g.prediction.xgEnrichment,winner:g.winnerTip})),published:db.prepare('SELECT day,fixture_id,market,alternative FROM openfoot_pick_revisions').all(),writes}));
console.log(JSON.stringify({at:now,observations:observations.length,ready:games.length,targets:targets.filter(r=>r.fixture.ts>now&&r.fixture.ts<window.end).length,published:db.prepare('SELECT COUNT(*) n FROM openfoot_pick_revisions').get().n,writeCount:writes.length,coverageReady:coverage.filter(c=>c.coverage>=.7&&c.xg>=12).length,teams:coverage.length}));
