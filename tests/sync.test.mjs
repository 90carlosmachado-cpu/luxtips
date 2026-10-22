import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testDatabase } from './sqlite.mjs';
import { runOpenFoot } from '../src/openfoot/sync.mjs';
const sample = JSON.parse(readFileSync(new URL('./fixtures/openfoot-39.json', import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/api-football-matched.json', import.meta.url)));
const now = Date.now();

test('resumable ingestion imports real xG once and leaves operational tables unchanged', async () => {
  const db = testDatabase();
  const f = fixtures.find(f => f.league === 39);
  db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?)').run(f.id, f.league, f.ts, 1, JSON.stringify(f));
  const before = db.sql.prepare('SELECT * FROM fixtures').all();
  const originalFetch = globalThis.fetch;
  let xgCalls = 0;
  globalThis.fetch = async url => {
    if (url.includes('/xg')) { xgCalls++; return Response.json(sample.xg); }
    return Response.json({ data: [sample.match], meta: { total_count: 1, pagination: { limit: 100, next_cursor: null } } });
  };
  try {
    const env = { DB: db, OPENFOOT_MODE: 'shadow', OPENFOOT_API_KEY: 'test-only' };
    assert.equal((await runOpenFoot(env, now)).imported, 1);
    assert.equal(db.sql.prepare('SELECT home_xg FROM openfoot_xg').get().home_xg, 2.21);
    assert.equal(db.sql.prepare('SELECT status FROM openfoot_matches').get().status, 'imported');
    db.sql.prepare("UPDATE openfoot_state SET data='{" + '"next":0' + "}' WHERE key='round'").run();
    await runOpenFoot(env, now + 30 * 60_000);
    assert.equal(xgCalls, 1);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_xg').get().n, 1);
    assert.deepEqual(db.sql.prepare('SELECT * FROM fixtures').all(), before);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM cache').get().n, 0);
  } finally { globalThis.fetch = originalFetch; db.sql.close(); }
});

test('invalid pages never advance checkpoints; disabled mode performs no database access', async () => {
  assert.deepEqual(await runOpenFoot({ OPENFOOT_MODE: 'disabled', DB: null }), { status: 'disabled' });
  const db = testDatabase(), f = fixtures.find(f => f.league === 39);
  db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?)').run(f.id, f.league, f.ts, 1, JSON.stringify(f));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [sample.match], meta: { total_count: 3, pagination: { limit: 100, next_cursor: null } } });
  try {
    const r = await runOpenFoot({ DB: db, OPENFOOT_MODE: 'shadow', OPENFOOT_API_KEY: 'test-only' }, now);
    assert.equal(r.code, 'incomplete_history');
    assert.equal(JSON.parse(db.sql.prepare("SELECT data FROM openfoot_state WHERE key='round'").get().data).next, 1);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_sync').get().n, 0);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM openfoot_matches').get().n, 0);
  } finally { globalThis.fetch = originalFetch; db.sql.close(); }
});

test('unfinished archive takes precedence over refreshing the current season', async () => {
  const db = testDatabase(), f = fixtures.find(f => f.league === 39);
  db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?)').run(f.id,f.league,f.ts,1,JSON.stringify(f));
  const past = { ...f, id: 999, season: 2024, ts: f.ts - 365 * 86400000 };
  db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?)').run(past.id,past.league,past.ts,1,JSON.stringify(past));
  db.sql.prepare("INSERT INTO openfoot_sync VALUES('comp_premier_league_eng','2025/26',NULL,1,?)").run(now - 8 * 3600000);
  const originalFetch = globalThis.fetch;
  let season;
  globalThis.fetch = async url => {
    season = new URL(url).searchParams.get('season');
    return Response.json({ data: [], meta: { total_count: 0, pagination: { limit: 100, next_cursor: null } } });
  };
  try {
    await runOpenFoot({ DB: db, OPENFOOT_MODE: 'shadow', OPENFOOT_API_KEY: 'test-only' }, now);
    assert.equal(season, '2024/25');
  } finally { globalThis.fetch = originalFetch; db.sql.close(); }
});
