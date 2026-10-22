// A paid end-to-end smoke test. SQLite in memory only; no production writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { testDatabase } from '../tests/sqlite.mjs';
import { runOpenFoot } from '../src/openfoot/sync.mjs';
const config = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const line = config.split(/\r?\n/).find(l => /^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
if (!key) throw new Error('missing_key');
const db = testDatabase(), now = Date.now();
try {
  const fixtures = JSON.parse(await readFile(new URL('../tests/fixtures/api-football-matched.json', import.meta.url), 'utf8'));
  for (const f of fixtures) db.sql.prepare('INSERT INTO fixtures VALUES(?,?,?,?,?)').run(f.id,f.league,f.ts,1,JSON.stringify(f));
  for (const league of [39,140,78,135,61]) {
    const { match } = JSON.parse(await readFile(new URL(`../tests/fixtures/openfoot-${league}.json`, import.meta.url), 'utf8'));
    db.sql.prepare('INSERT INTO openfoot_matches(source_id,competition_id,season,kickoff,data,fetched_at) VALUES(?,?,?,?,?,?)')
      .run(match.id,match.competitionId,match.season,Date.parse(match.kickoffAt),JSON.stringify(match),now);
    db.sql.prepare('INSERT INTO openfoot_sync VALUES(?,?,NULL,1,?)').run(match.competitionId,match.season,now);
  }
  const before = JSON.stringify(db.sql.prepare('SELECT * FROM fixtures ORDER BY id').all());
  const env = { DB: db, OPENFOOT_MODE: 'shadow', OPENFOOT_API_KEY: key };
  const first = await runOpenFoot(env, now);
  const second = await runOpenFoot(env, now + 6 * 60_000);
  const observations = db.sql.prepare('SELECT league,home_xg,away_xg FROM openfoot_xg ORDER BY league').all();
  if (observations.length !== 5 || second.requests !== 0 || before !== JSON.stringify(db.sql.prepare('SELECT * FROM fixtures ORDER BY id').all())) throw new Error('pilot_validation_failed');
  const report = { at: new Date(now).toISOString(), first, second, observations, operationalFixturesPreserved: true, productionWrites: 0 };
  await mkdir(new URL('../work/', import.meta.url), { recursive: true });
  await writeFile(new URL('../work/pilot.json', import.meta.url), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { db.sql.close(); }
