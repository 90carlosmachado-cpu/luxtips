import { competitionFor, seasonLabel, REVIEWED_TEAM_LINKS } from './config.mjs';
import { OpenFootError } from './client.mjs';

export function teamName(name) {
  return typeof name === 'string' ? name.normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
}
const goal = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20;

// Contract verified with five paid /xg responses, one per competition (2026-10-22).
// /context.analytics.expectedGoals is deliberately NOT accepted here: it is derived.
export function normalizeXg(match, payload, observedAt = Date.now()) {
  const d = payload?.data;
  const kickoff = Date.parse(match?.kickoffAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(kickoff) || kickoff + 2 * 3_600_000 >= observedAt ||
      match.status !== 'finished' || match.period !== 'FT' || !Number.isInteger(match.score?.home) ||
      !Number.isInteger(match.score?.away) || match.score.home < 0 || match.score.away < 0) {
    throw new OpenFootError('unfinished_or_invalid_match');
  }
  if (!d || d.matchId !== match.id || !goal(d.homeXG) || !goal(d.awayXG) ||
      !teamName(d.homeTeam) || teamName(d.homeTeam) !== teamName(match.homeTeam?.name) ||
      !teamName(d.awayTeam) || teamName(d.awayTeam) !== teamName(match.awayTeam?.name) ||
      !Array.isArray(d.shots) || d.shots.length > 300) throw new OpenFootError('invalid_xg_contract');
  const sums = { home: 0, away: 0 }, counts = { home: 0, away: 0 }, ids = new Set();
  const profiles=Object.fromEntries(['home','away'].map(side=>[side,{nonPenaltyXg:0,penaltyXg:0,openPlayXg:0,setPieceXg:0,penaltyGoals:0,onTarget:0,unknownSituationShots:0}]));
  for (const shot of d.shots) {
    const side = teamName(shot.team) === teamName(d.homeTeam) ? 'home'
      : teamName(shot.team) === teamName(d.awayTeam) ? 'away' : null;
    if (!side || !Number.isFinite(shot.xG) || shot.xG < 0 || shot.xG > 1 ||
        !Number.isInteger(shot.minute) || shot.minute < 0 || shot.minute > 130 ||
        typeof shot.id !== 'string' || !shot.id || ids.has(shot.id)) {
      throw new OpenFootError('invalid_shot_data');
    }
    ids.add(shot.id); sums[side] += shot.xG; counts[side]++;
    const p=profiles[side];
    if(shot.situation==='Penalty'){p.penaltyXg+=shot.xG;if(shot.result==='Goal')p.penaltyGoals++;}
    else if(['OpenPlay','FromCorner','SetPiece','DirectFreekick','FastBreak'].includes(shot.situation)){
      p.nonPenaltyXg+=shot.xG;if(['OpenPlay','FastBreak'].includes(shot.situation))p.openPlayXg+=shot.xG;else p.setPieceXg+=shot.xG;
    }else p.unknownSituationShots++;
    if(['Goal','SavedShot'].includes(shot.result))p.onTarget++;
  }
  // Team totals are rounded to 2 decimals; shot values have 4 decimals.
  for (const side of ['home', 'away']) {
    if (Math.abs(sums[side] - d[`${side}XG`]) > 0.02 + counts[side] * 0.0001) {
      throw new OpenFootError('xg_shot_total_mismatch');
    }
  }
  const sources = payload.meta?.sources;
  if (!Array.isArray(sources) || !sources.length || !sources.some(s => s.name === 'FotMob')) {
    throw new OpenFootError('missing_xg_provenance');
  }
  return {
    sourceId: match.id, competitionId: match.competitionId, season: match.season,
    kickoff, observedAt, homeXg: d.homeXG, awayXg: d.awayXG,
    result: { home: match.score.home, away: match.score.away },
    homeShots: counts.home, awayShots: counts.away,shotProfiles:profiles,
    sources: sources.map(({ name, license, url }) => ({ name, license, url })),
    requestId: typeof payload.meta?.request_id === 'string' ? payload.meta.request_id : null,
  };
}

export function matchFixture(match, fixtures, links = []) {
  const ts = Date.parse(match?.kickoffAt);
  if (!Number.isFinite(ts) || !match.homeTeam?.id || !match.awayTeam?.id ||
      match.homeTeam.id === match.awayTeam.id || !teamName(match.homeTeam.name) || !teamName(match.awayTeam.name)) {
    return { status: 'invalid_match' };
  }
  const linkedId = (sourceId, league) => {
    const custom = links.filter(l => l.sourceId === sourceId && l.league === league);
    return custom.length ? custom : REVIEWED_TEAM_LINKS.filter(l => l.sourceId === sourceId && l.league === league);
  };
  const possible = fixtures.filter(f => {
    const c = competitionFor(f.league);
    if (!c || c.id !== match.competitionId || !Number.isInteger(f.season) || seasonLabel(f.season) !== match.season) return false;
    const sameTime = match.kickoffTimeKnown === true ? Math.abs(f.ts - ts) <= 15 * 60_000
      : new Date(f.ts).toISOString().slice(0, 10) === new Date(ts).toISOString().slice(0, 10);
    if (!sameTime) return false;
    const home = linkedId(match.homeTeam.id, f.league), away = linkedId(match.awayTeam.id, f.league);
    if (home.length > 1 || away.length > 1) return false;
    return (home.length ? home[0].teamId === f.home : teamName(f.homeName) === teamName(match.homeTeam.name)) &&
      (away.length ? away[0].teamId === f.away : teamName(f.awayName) === teamName(match.awayTeam.name));
  });
  if (possible.length !== 1) return { status: possible.length ? 'ambiguous' : 'unmatched' };
  const f = possible[0];
  if (!f.finished || f.status !== 'FT' || match.status !== 'finished' || match.period !== 'FT' ||
      !Number.isInteger(f.hg) || !Number.isInteger(f.ag) || f.hg !== match.score?.home || f.ag !== match.score?.away) {
    return { status: 'result_mismatch', fixtureId: f.id };
  }
  return { status: 'matched', fixture: f };
}
