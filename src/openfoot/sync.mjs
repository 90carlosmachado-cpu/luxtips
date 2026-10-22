import { createOpenFootClient, OpenFootError } from './client.mjs';
import { XG_COMPETITIONS, seasonLabel } from './config.mjs';
import { matchFixture, normalizeXg } from './normalize.mjs';
import { saveShadowForecasts } from './shadow.mjs';
import {normalizeMatchDetails} from './details.mjs';

const HOUR = 3_600_000;
const setState = (db, key, value) => db.prepare('INSERT INTO openfoot_state(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
  .bind(key, JSON.stringify(value)).run();

export async function runOpenFoot(env, now = Date.now()) {
  if (!['shadow', 'live'].includes(env.OPENFOOT_MODE)) return { status: 'disabled' };
  if (!env.OPENFOOT_API_KEY) return { status: 'missing_key' };
  const db = env.DB;
  const recent = await db.prepare("SELECT data FROM openfoot_state WHERE key='last_sync'").first();
  if (recent && now - JSON.parse(recent.data).at < 5 * 60_000) return { status: 'throttled' };
  const token = now + 10 * 60_000;
  const lock = await db.prepare("INSERT INTO openfoot_locks(key,until) VALUES('sync',?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<? RETURNING until")
    .bind(token, now).first();
  if (!lock) return { status: 'locked' };
  const configuredBudget = Number(env.OPENFOOT_DAILY_BUDGET);
  const dailyBudget = Number.isInteger(configuredBudget) && configuredBudget > 0 ? Math.min(1000, configuredBudget) : 500;
  const client = createOpenFootClient({ key: env.OPENFOOT_API_KEY, maximumRequests: 20, reserve: async at => {
    const cooldown = await db.prepare("SELECT data FROM openfoot_state WHERE key='cooldown'").first();
    if (cooldown && JSON.parse(cooldown.data).until > at) throw new OpenFootError('rate_limit_cooldown');
    const day = new Date(at).toISOString().slice(0, 10);
    return !!await db.prepare('INSERT INTO openfoot_quota(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 WHERE n<? RETURNING n')
      .bind(day, dailyBudget).first();
  } });
  const summary = { status: 'ok', at: now, discovered: 0, imported: 0, unresolved: 0 };
  try {
    const state = await db.prepare("SELECT data FROM openfoot_state WHERE key='round'").first();
    const round = state ? JSON.parse(state.data).next : 0;
    const c = XG_COMPETITIONS[Number.isInteger(round) ? round % XG_COMPETITIONS.length : 0];
    // An unavailable league must not prevent the other four from being visited.
    await setState(db, 'round', { next: (Number.isInteger(round) ? round + 1 : 1) % XG_COMPETITIONS.length });
    // The source of season numbers remains the existing API-Football data.
    const seasons = await db.prepare("SELECT DISTINCT json_extract(data,'$.season') season FROM fixtures WHERE league=? ORDER BY season DESC LIMIT 3").bind(c.league).all();
    const plans = await Promise.all(seasons.results.map(async row => {
      const season = seasonLabel(row.season);
      const sync = await db.prepare('SELECT * FROM openfoot_sync WHERE competition_id=? AND season=?').bind(c.id, season).first();
      return { season, sync, current: row.season === seasons.results[0].season };
    }));
    // Finish the initial archive before refreshing it: otherwise a long current
    // season can repeatedly occupy every refresh window and starve older seasons.
    const plan = plans.find(p => !p.sync?.complete) || plans.find(p => p.current && now - p.sync.updated_at >= 6 * HOUR);
    if (plan) {
      const { season, sync } = plan;
      const page = await client.matchesPage(c.id, season, sync?.complete ? null : sync?.cursor || null);
      const statements = [];
      const ids = new Set();
      for (const m of page.data) {
        const kickoff = Date.parse(m.kickoffAt);
        if (!Number.isFinite(kickoff) || typeof m.id !== 'string' || ids.has(m.id)) throw new OpenFootError('invalid_match_page');
        ids.add(m.id);
        statements.push(db.prepare(`INSERT INTO openfoot_matches(source_id,competition_id,season,kickoff,data,fetched_at,status)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at,kickoff=excluded.kickoff,
          status=CASE WHEN openfoot_matches.status='waiting' AND excluded.status='pending' THEN 'pending' ELSE openfoot_matches.status END
          WHERE openfoot_matches.competition_id=excluded.competition_id AND openfoot_matches.season=excluded.season`)
          .bind(m.id, c.id, season, kickoff, JSON.stringify(m), now, m.status === 'finished' && m.period === 'FT' ? 'pending' : 'waiting'));
      }
      const next = page.meta.pagination.next_cursor;
      if (next === null && Number.isInteger(page.meta.total_count)) {
        const existing = await db.prepare('SELECT source_id FROM openfoot_matches WHERE competition_id=? AND season=?').bind(c.id, season).all();
        const combined = new Set([...existing.results.map(x => x.source_id), ...ids]);
        if (combined.size !== page.meta.total_count) throw new OpenFootError('incomplete_history');
      }
      statements.push(db.prepare('INSERT INTO openfoot_sync(competition_id,season,cursor,complete,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(competition_id,season) DO UPDATE SET cursor=excluded.cursor,complete=excluded.complete,updated_at=excluded.updated_at')
        .bind(c.id, season, next, next === null ? 1 : 0, now));
      // Data and checkpoint commit together: a failed page never advances the cursor.
      await db.batch(statements);
      summary.discovered += page.data.length;
      // One resumable page per tick; leave capacity for xG requests.
    }
    const pending = await db.prepare("SELECT * FROM openfoot_matches WHERE status IN ('pending','retry','unmatched','result_mismatch') AND retry_at<=? AND kickoff<? ORDER BY attempted_at IS NOT NULL,kickoff DESC LIMIT 15")
      .bind(now, now - 2 * HOUR).all();
    for (const row of pending.results) {
      const m = JSON.parse(row.data), comp = XG_COMPETITIONS.find(x => x.id === m.competitionId);
      if (!comp) continue;
      const fixtures = await db.prepare('SELECT data FROM fixtures WHERE league=? AND kickoff>=? AND kickoff<=?').bind(comp.league, row.kickoff - 24 * HOUR, row.kickoff + 24 * HOUR).all();
      const links = await db.prepare('SELECT source_id sourceId,team_id teamId,league FROM openfoot_team_links WHERE league=?').bind(comp.league).all();
      const matched = matchFixture(m, fixtures.results.map(r => JSON.parse(r.data)), links.results);
      if (matched.status !== 'matched') {
        await db.prepare('UPDATE openfoot_matches SET status=?,attempted_at=?,retry_at=? WHERE source_id=?')
          .bind(matched.status, now, now + 24 * HOUR, m.id).run();
        summary.unresolved++; continue;
      }
      try {
        const existing=await db.prepare('SELECT fixture_id FROM openfoot_xg WHERE source_id=?').bind(m.id).first();
        const detailed=env.PREDICTION_CONTEXT_MODE==='live';
        const savedDetails=detailed?await db.prepare('SELECT 1 FROM openfoot_match_details WHERE fixture_id=? AND kickoff=? LIMIT 1').bind(matched.fixture.id,matched.fixture.ts).first():null;
        if(existing?.fixture_id===matched.fixture.id&&(!detailed||savedDetails)){
          await db.prepare("UPDATE openfoot_matches SET status='imported',attempted_at=? WHERE source_id=?").bind(now,m.id).run();
          summary.reused=(summary.reused||0)+1;continue;
        }
        const payload = await client.get(`/v1/matches/${encodeURIComponent(m.id)}/xg`);
        const o = { ...normalizeXg(m, payload, now), fixtureId: matched.fixture.id, league: comp.league, kickoff: matched.fixture.ts };
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO openfoot_xg(source_id,fixture_id,league,kickoff,observed_at,home_xg,away_xg,data) VALUES(?,?,?,?,?,?,?,?)')
            .bind(o.sourceId, o.fixtureId, o.league, o.kickoff, o.observedAt, o.homeXg, o.awayXg, JSON.stringify(o)),
          db.prepare("UPDATE openfoot_matches SET status=?,attempted_at=?,retry_at=? WHERE source_id=? AND EXISTS(SELECT 1 FROM openfoot_xg WHERE source_id=? AND fixture_id=?)")
            .bind(detailed?'retry':'imported',now,detailed?now+300000:0,o.sourceId,o.sourceId,o.fixtureId),
        ]);
        if(detailed){
          const events=await client.get(`/v1/matches/${encodeURIComponent(m.id)}/events`);
          const data={...normalizeMatchDetails(m,payload,events,Date.now()),fixtureId:o.fixtureId,league:o.league,kickoff:o.kickoff};
          await db.batch([
            db.prepare('INSERT OR IGNORE INTO openfoot_match_details(source_id,fixture_id,league,kickoff,observed_at,data) VALUES(?,?,?,?,?,?)').bind(data.sourceId,data.fixtureId,data.league,data.kickoff,data.observedAt,JSON.stringify(data)),
            db.prepare("UPDATE openfoot_matches SET status='imported',retry_at=0 WHERE source_id=?").bind(o.sourceId),
          ]);
          summary.detailsImported=(summary.detailsImported||0)+1;
        }
        const saved = await db.prepare('SELECT fixture_id FROM openfoot_xg WHERE source_id=?').bind(o.sourceId).first();
        if (saved?.fixture_id !== o.fixtureId) throw new OpenFootError('identity_conflict');
        summary.imported++;
      } catch (e) {
        if (['run_budget','daily_budget','rate_limit','rate_limit_cooldown','invalid_key','plan_restricted'].includes(e.code)) throw e;
        await db.prepare("UPDATE openfoot_matches SET status='retry',attempted_at=?,retry_at=?,attempts=attempts+1 WHERE source_id=?")
          .bind(now, now + (e.code === 'not_available' ? 7 * 24 : 24) * HOUR, m.id).run();
        await setState(db, 'last_import_error', { at: now, sourceId: m.id, code: e.code || 'import_failed' });
      }
    }
  } catch (e) {
    summary.status = 'degraded'; summary.code = e.code || 'sync_failed';
    if (e.retryAfter) await setState(db, 'cooldown', { until: e.retryAfter });
  } finally {
    // Forecast from already stored observations even when today's API budget
    // has been exhausted. No additional upstream call is needed for this step.
    try { summary.forecasts = env.OPENFOOT_MODE==='shadow'?await saveShadowForecasts(db, now):{saved:0,disabledInLive:true}; }
    catch { summary.forecastError = 'shadow_forecast_failed'; }
    summary.requests = client.requests;
    await setState(db, 'last_sync', summary);
    // Never release a lock taken over by another invocation after expiry.
    await db.prepare("UPDATE openfoot_locks SET until=0 WHERE key='sync' AND until=?").bind(token).run();
  }
  return summary;
}

export async function openFootStatus(db) {
  const [state, coverage, imports, forecasts] = await Promise.all([
    db.prepare('SELECT key,data FROM openfoot_state').all(),
    db.prepare('SELECT league,COUNT(*) matches,MIN(observed_at) firstObservedAt,MAX(observed_at) lastObservedAt FROM openfoot_xg GROUP BY league').all(),
    db.prepare('SELECT status,COUNT(*) matches FROM openfoot_matches GROUP BY status').all(),
    db.prepare('SELECT COUNT(*) count FROM openfoot_shadow').first(),
  ]);
  return { mode: 'shadow', publicationChanged: false, state: Object.fromEntries(state.results.map(r => [r.key, JSON.parse(r.data)])),
    coverage: coverage.results, imports: imports.results, forecasts: forecasts.count };
}
