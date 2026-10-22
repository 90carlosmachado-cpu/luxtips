import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function testDatabase() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE fixtures(id INTEGER PRIMARY KEY,league INTEGER,kickoff INTEGER,finished INTEGER,data TEXT); CREATE TABLE cache(key TEXT PRIMARY KEY,data TEXT,expires INTEGER);');
  sql.exec(readFileSync(new URL('../migrations/0001_openfoot_shadow.sql', import.meta.url), 'utf8'));
  function prepare(query) {
    let params = [];
    return { query, bind(...values) { params = values; return this; },
      async first() { return sql.prepare(query).get(...params) || null; },
      async all() { return { results: sql.prepare(query).all(...params) }; },
      async run() { const r = sql.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
    };
  }
  return { sql, prepare, async batch(statements) {
    sql.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; }
    catch (e) { sql.exec('ROLLBACK'); throw e; }
  } };
}
