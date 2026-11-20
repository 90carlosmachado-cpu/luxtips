import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const migration=name=>readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8');
const update=migration('0012_bigodds_flexible_limits.sql');
const tables=['bigodds_tickets','bigodds_legs','bigodds_ticket_legs'];
function atomic(db,sql){
 db.exec('BEGIN');
 try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
function seed(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 db.exec(migration('0010_bigodds.sql')+migration('0011_bigodds_withdrawn_reuse.sql'));
 for(let i=0;i<9;i++)db.prepare('INSERT INTO bigodds_tickets VALUES(?,?,?,?,?,?,?,?)').run('old-'+i,1000+i,'historical-v'+i,i<5?'lost':'void',2000+i,8+i/10,'Betano',JSON.stringify({id:'old-'+i,original:true,legs:[],odd:8+i/10}));
 for(let i=0;i<22;i++)db.prepare('INSERT INTO bigodds_legs VALUES(?,?,?,?,?,?,?)').run(i+1,'old-'+i%9,3000+i,JSON.stringify({fixtureId:i+1,original:'legacy '+i}),i%2?'won':'lost',4000+i,JSON.stringify({home:i%3,away:1}));
 for(let i=0;i<44;i++)db.prepare('INSERT INTO bigodds_ticket_legs VALUES(?,?,?,?,?,?,?)').run(100+i,'old-'+i%9,5000+i,JSON.stringify({fixtureId:100+i,original:'ticket '+i}),i%2?'void':'lost',6000+i,JSON.stringify({status:'archived',id:i}));
 return db;
}
const rows=db=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()]));
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name LIKE 'bigodds_%' ORDER BY type,name").all();

test('flexible-limit migration preserves every historical row, relationship and immutable protection',()=>{
 const db=seed(),before=rows(db),objects=schema(db).filter(o=>o.type!=='table');
 atomic(db,update);
 assert.deepEqual(rows(db),before);assert.deepEqual(schema(db).filter(o=>o.type!=='table'),objects);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bigodds_all_legs').get().n,66);
 assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(r=>r.integrity_check),['ok']);
 for(const table of tables){
  const snapshot=table==='bigodds_tickets'?'data':'snapshot';
  assert.throws(()=>db.exec(`UPDATE ${table} SET ${snapshot}='{}'`),/immutable/);
  assert.throws(()=>db.exec(`DELETE FROM ${table}`),/immutable/);
 }
 for(const table of tables.slice(1)){
  assert.equal(db.prepare('PRAGMA foreign_key_list('+table+')').get().table,'bigodds_tickets');
  assert.throws(()=>db.prepare('INSERT INTO '+table+'(fixture_id,ticket_id,kickoff,snapshot) VALUES(999,\'missing\',1,\'{}\')').run(),/FOREIGN KEY/);
 }
 // Settlement columns remain mutable; the new minimum is enforced in storage.
 db.exec("UPDATE bigodds_tickets SET status='active',closed_at=NULL WHERE id='old-0'");
 assert.throws(()=>db.exec("UPDATE bigodds_tickets SET status='active' WHERE id='old-1'"),/UNIQUE/);
 const insert=db.prepare("INSERT INTO bigodds_tickets VALUES(?,1,'v6','won',2,?,'Betano','{}')");
 insert.run('new-two',2);insert.run('new-large',1000000);
 assert.throws(()=>insert.run('below-minimum',1.999),/CHECK/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('migration failure after dropping the old tables rolls back all data and protections',()=>{
 const db=seed(),before=rows(db),objects=schema(db);
 const broken=update.replace('ALTER TABLE bigodds_tickets_next RENAME TO bigodds_tickets;',"INSERT INTO deliberately_missing_table VALUES(1);\nALTER TABLE bigodds_tickets_next RENAME TO bigodds_tickets;");
 assert.throws(()=>atomic(db,broken),/deliberately_missing_table/);
 assert.deepEqual(rows(db),before);assert.deepEqual(schema(db),objects);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.throws(()=>db.exec('DELETE FROM bigodds_tickets'),/immutable/);
});

test('unexpected referencing tables abort the migration without losing snapshots',()=>{
 const db=seed();db.exec("CREATE TABLE external_reference(ticket TEXT REFERENCES bigodds_tickets(id));INSERT INTO external_reference VALUES('old-0')");
 const before=rows(db),objects=schema(db);
 assert.throws(()=>atomic(db,update),/FOREIGN KEY/);
 assert.deepEqual(rows(db),before);assert.deepEqual(schema(db),objects);
 assert.equal(db.prepare('SELECT ticket FROM external_reference').get().ticket,'old-0');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
