// Offline identity review from both providers' actual 2025/26 fixture archives.
// Produces a proposal, never edits the reviewed registry automatically.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { XG_COMPETITIONS } from '../src/openfoot/config.mjs';
const { local, external } = JSON.parse(await readFile('tests/fixtures/cross-provider-2025.json', 'utf8'));
const links = [], report = [];
for (const c of XG_COMPETITIONS) {
  const matches = external.filter(m => m.competitionId === c.id);
  const candidates = new Map();
  for (const m of matches) {
    const rows = local.filter(f => f.league === c.league && f.season === 2025 && f.ts === Date.parse(m.kickoffAt) && f.hg === m.score.home && f.ag === m.score.away);
    if (rows.length !== 1) continue;
    const f = rows[0];
    for (const side of ['home','away']) {
      const source = m[`${side}Team`], id = f[side];
      if (!candidates.has(source.id)) candidates.set(source.id,{ source, teams:new Map() });
      const entry = candidates.get(source.id);
      if (!entry.teams.has(id)) entry.teams.set(id,{ teamId:id, name:f[`${side}Name`], fixtures:[] });
      entry.teams.get(id).fixtures.push({ sourceId:m.id, fixtureId:f.id });
    }
  }
  const accepted = [];
  for (const [sourceId,entry] of candidates) {
    // Require repeated agreement and NO competing ID. No name similarity used.
    if (entry.teams.size !== 1) continue;
    const team = [...entry.teams.values()][0];
    if (team.fixtures.length < 3) continue;
    accepted.push({ league:c.league,sourceId,teamId:team.teamId,sourceName:entry.source.name,localName:team.name,
      evidence:{ season:'2025/26', matchingFixtures:team.fixtures.length, samples:team.fixtures.slice(0,3) } });
  }
  if (new Set(accepted.map(x=>x.teamId)).size !== accepted.length) throw new Error('non_bijective_links');
  const ids = new Map(accepted.map(x=>[x.sourceId,x.teamId]));
  let fullyMatched = 0, conflicts = 0;
  for (const m of matches) {
    const h = ids.get(m.homeTeam.id), a = ids.get(m.awayTeam.id);
    if (!h || !a) continue;
    const rows = local.filter(f => f.league === c.league && f.ts === Date.parse(m.kickoffAt) && f.home === h && f.away === a);
    if (rows.length === 1 && rows[0].hg === m.score.home && rows[0].ag === m.score.away) fullyMatched++;
    else conflicts++;
  }
  links.push(...accepted);
  report.push({ league:c.league,teams:accepted.length,fixtures:matches.length,fullyMatched,conflicts });
}
await mkdir('work', { recursive: true });
await writeFile('work/team-links-proposal.json', JSON.stringify(links,null,2));
console.log(JSON.stringify(report,null,2));
