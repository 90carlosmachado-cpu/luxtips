import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
function database() {
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE published_picks(day TEXT,fixture_id INTEGER,kickoff INTEGER,market TEXT,alternative INTEGER,published_at INTEGER,recorded_at INTEGER,recovered INTEGER,data TEXT,PRIMARY KEY(day,fixture_id));
 CREATE TABLE published_alternatives(day TEXT PRIMARY KEY,fixture_id INTEGER,kickoff INTEGER,market TEXT,published_at INTEGER,recorded_at INTEGER,data TEXT);
 CREATE TRIGGER immutable_published_picks_delete BEFORE DELETE ON published_picks BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
 db.exec(readFileSync(new URL('../migrations/0002_publication_archive.sql',import.meta.url),'utf8'));
 return db;
}
test('archive hides only requested rows, preserves original ledger and allows a fresh cycle for the same game',()=>{
 const db=database();
 try {
  db.exec("INSERT INTO published_picks VALUES('2026-10-24',1,10000,'H',0,1000,1000,0,'old'); INSERT INTO published_picks VALUES('2026-10-18',2,5000,'A',0,1000,1000,0,'past');");
  db.exec("INSERT INTO openfoot_publication_archives VALUES('2026-10-24',1,2000,'user request');");
  assert.equal(db.prepare('SELECT COUNT(*) n FROM published_picks').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM openfoot_current_picks').get().n,1);
  assert.throws(()=>db.exec('DELETE FROM published_picks WHERE fixture_id=1'),/immutable/);
  db.exec("INSERT INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data) VALUES('2026-10-24',1,10000,'H',0,3000,3000,'new');");
  assert.equal(db.prepare('SELECT data FROM openfoot_current_picks WHERE fixture_id=1').get().data,'new');
  db.exec("INSERT INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data) VALUES('2026-10-24',1,10000,'H',0,4000,4000,'duplicate');");
  assert.equal(db.prepare('SELECT COUNT(*) n FROM openfoot_current_picks').get().n,2);
  db.exec("INSERT INTO openfoot_publication_archives VALUES('2026-10-24',1,5000,'second reset'); INSERT INTO openfoot_pick_revisions(day,fixture_id,kickoff,market,alternative,published_at,recorded_at,data) VALUES('2026-10-24',1,10000,'A',0,6000,6000,'third');");
  assert.equal(db.prepare('SELECT data FROM openfoot_current_picks WHERE fixture_id=1').get().data,'third');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM openfoot_pick_revisions').get().n,2);
 }finally{db.close();}
});
