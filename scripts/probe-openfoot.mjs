import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createOpenFootClient } from '../src/openfoot/client.mjs';
import { XG_COMPETITIONS } from '../src/openfoot/config.mjs';

let key = process.env.OPENFOOT_API_KEY;
if (!key) {
  try {
    const text = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
    const line = text.split(/\r?\n/).find(l => /^\s*OPENFOOT_API_KEY\s*=/.test(l));
    key = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  } catch { /* Handled without printing file contents below. */ }
}
if (!key) { console.error('Falta OPENFOOT_API_KEY no ambiente ou em .dev.vars (ignorado pelo Git).'); process.exit(2); }
const client = createOpenFootClient({ key, maximumRequests: 20 });
const directory = new URL('../work/probe/', import.meta.url);
await mkdir(directory, { recursive: true });
try {
  const quota = await client.get('/v1/account/quota');
  console.log(JSON.stringify({ check: 'subscription', plan: quota.data?.plan, remaining: quota.data?.remaining }));
  const coverage = await client.get('/v1/competitions');
  for (const c of XG_COMPETITIONS) {
    const info = coverage.data.find(x => x.id === c.id);
    if (!info) throw new Error('missing_competition');
    const season = info.availableSeasons.includes('2025/26') ? '2025/26' : info.currentSeason;
    const q = new URLSearchParams({ competition: c.id, season, limit: '100' });
    const p = await client.get(`/v1/matches?${q}`);
    if (p.meta?.preview_limit != null || p.meta?.scope?.partial || p.meta?.unavailable?.length) throw new Error('incomplete_history');
    const match = p.data.find(x => x.status === 'finished' && x.period === 'FT');
    if (!match) throw new Error('no_finished_match');
    const xg = await client.get(`/v1/matches/${encodeURIComponent(match.id)}/xg`);
    // Samples contain football data and attribution only; explicitly redact the credential.
    const sample = JSON.stringify({ competition: info, match, xg }, null, 2).replaceAll(key, '[redacted]');
    await writeFile(new URL(`${c.league}.json`, directory), sample);
    console.log(JSON.stringify({ league: c.league, status: 'sample_saved', matchId: match.id, xgFields: Object.keys(xg.data || {}) }));
  }
} catch (e) {
  console.error(JSON.stringify({ check: 'failed', code: e.code || 'probe_failed', status: e.status || 0 }));
  process.exitCode = 1;
}
