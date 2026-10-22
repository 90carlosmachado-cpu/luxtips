import {REVIEWED_TEAM_LINKS as BASE_TEAM_LINKS} from './team-links.mjs';
import {HISTORICAL_TEAM_LINKS} from './team-links-history.mjs';
export const REVIEWED_TEAM_LINKS=Object.freeze([...BASE_TEAM_LINKS,...HISTORICAL_TEAM_LINKS]);
// IDs confirmed against GET /v1/competitions on 2026-10-22.
export const XG_COMPETITIONS = Object.freeze([
  { league: 39, id: 'comp_premier_league_eng', name: 'Premier League' },
  { league: 140, id: 'comp_laliga_es', name: 'La Liga' },
  { league: 78, id: 'comp_bundesliga_de', name: 'Bundesliga' },
  { league: 135, id: 'comp_serie_a_it', name: 'Serie A' },
  { league: 61, id: 'comp_ligue_1_fr', name: 'Ligue 1' },
]);
export const ALL_LEAGUES = '94,39,140,78,135,61,88,2,3,848';
export function competitionFor(league) {
  return XG_COMPETITIONS.find(c => c.league === league) || null;
}
export function seasonLabel(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new RangeError('invalid_season');
  return `${year}/${String(year + 1).slice(-2)}`;
}
