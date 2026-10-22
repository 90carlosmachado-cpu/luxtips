import fs from 'node:fs';
const kind=process.argv[2],offset=Number(process.argv[3]||0),size=Number(process.argv[4]||30);
if(!['fixtures','cache','sources'].includes(kind))throw Error('invalid_kind');
let rows=JSON.parse(fs.readFileSync('work/football-refresh/'+kind+'.json','utf8'));
if(kind==='cache'){
 const names=new Set(['Match Winner','Double Chance','Asian Handicap','Goals Over/Under','Both Teams Score','Total - Home','Total - Away','Home Team Score a Goal','Away Team Score a Goal']);
 rows=rows.filter(r=>r.key.startsWith('api:odds')).map(r=>({...r,data:{...r.data,items:r.data.items.map(f=>({...f,bookmakers:(f.bookmakers||[]).map(b=>({...b,bets:(b.bets||[]).filter(bet=>names.has(bet.name))}))}))}}));
}
const quote=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'";
let sql='';
for(const row of rows.slice(offset,offset+size)){
 if(kind==='fixtures'){const f=row.fixture;sql+='INSERT INTO fixtures(id,league,kickoff,finished,data,updated_at) VALUES('+[f.id,f.league,f.ts,f.finished?1:0,quote(f),row.updatedAt].join(',')+') ON CONFLICT(id) DO UPDATE SET league=excluded.league,kickoff=excluded.kickoff,finished=excluded.finished,data=excluded.data,updated_at=excluded.updated_at WHERE fixtures.updated_at<=excluded.updated_at;';}
 if(kind==='cache')sql+="INSERT INTO cache(key,data,expires) VALUES('"+row.key.replaceAll("'","''")+"',"+quote(row.data)+','+row.expires+") ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires=excluded.expires WHERE COALESCE(json_extract(cache.data,'$.fetchedAt'),0)<=COALESCE(json_extract(excluded.data,'$.fetchedAt'),0);";
 if(kind==='sources')sql+="INSERT OR IGNORE INTO openfoot_context_sources(fixture_id,kind,observed_at,kickoff,source_at,data) VALUES("+[row.fixtureId,"'"+row.kind+"'",row.observedAt,row.kickoff,row.sourceAt,quote(row.data)].join(',')+");";
}
console.log(JSON.stringify({kind,offset,total:rows.length,count:rows.slice(offset,offset+size).length,sql}));
