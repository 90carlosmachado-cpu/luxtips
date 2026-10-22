import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createOpenFootClient } from '../src/openfoot/client.mjs';
import { XG_COMPETITIONS } from '../src/openfoot/config.mjs';
const text = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const line = text.split(/\r?\n/).find(l => /^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
if (!key) throw new Error('missing_key');
const client = createOpenFootClient({ key, maximumRequests: 30 });
const directory = new URL('../work/inventory/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = [];
for (const c of XG_COMPETITIONS) {
  try {
    const matches = await client.allMatches(c.id, '2025/26');
    await writeFile(new URL(`${c.league}.json`, directory), JSON.stringify(matches));
    const result = { league: c.league, season: '2025/26', matches: matches.length,
      finished: matches.filter(m => m.status === 'finished').length, complete: true };
    report.push(result); console.log(JSON.stringify(result));
  } catch (e) { report.push({ league: c.league, code: e.code || 'verification_failed' }); process.exitCode = 1; }
}
await writeFile(new URL('verification.json', directory), JSON.stringify({ checkedAt: new Date().toISOString(), requests: client.requests, competitions: report }, null, 2));
