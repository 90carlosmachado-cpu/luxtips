-- Snapshot apenas da estrutura D1 em 2026-11-06. Sem dados nem segredos.
-- Referência para recuperação; não executar como migração sobre uma base existente.
CREATE TABLE bigodds_legs (
 fixture_id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES bigodds_tickets(id),
 kickoff INTEGER NOT NULL, snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','void')),
 settled_at INTEGER, result TEXT
);

CREATE TABLE bigodds_ticket_legs (
 fixture_id INTEGER NOT NULL,ticket_id TEXT NOT NULL REFERENCES bigodds_tickets(id),
 kickoff INTEGER NOT NULL,snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','void')),
 settled_at INTEGER,result TEXT,
 PRIMARY KEY(ticket_id,fixture_id)
);

CREATE TABLE bigodds_tickets (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, policy TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','won','lost','void')),
 closed_at INTEGER, odd REAL NOT NULL CHECK(odd>=8 AND odd<=15.000000001),
 bookmaker TEXT NOT NULL, data TEXT NOT NULL
);

CREATE TABLE cache(key TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);

CREATE TABLE daily_markets (
  day TEXT PRIMARY KEY,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  market TEXT NOT NULL CHECK(market IN ('HX','XA','O15','U15','O25','U25','O35','U35','BY','BN','HO05','AO05','HO15','AO15','O05','U45','HU15','AU15','HU25','AU25','HAP15','AAP15')),
  policy_version TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at<kickoff),
  data TEXT NOT NULL
);

CREATE TABLE "daily_markets_v1_archive" (
  day TEXT PRIMARY KEY,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  market TEXT NOT NULL CHECK(market IN ('HX','XA')),
  policy_version TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at<kickoff),
  data TEXT NOT NULL
);

CREATE TABLE fixtures(id INTEGER PRIMARY KEY, league INTEGER NOT NULL, kickoff INTEGER NOT NULL, finished INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE forecasts(id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER NOT NULL, version TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('preliminary','final')), created_at INTEGER NOT NULL, kickoff INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(fixture_id,phase,version), CHECK(created_at<kickoff));

CREATE TABLE locks(key TEXT PRIMARY KEY,until INTEGER NOT NULL);

CREATE TABLE maintenance_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind='refresh-odds'), requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, result TEXT);

CREATE TABLE meta(key TEXT PRIMARY KEY,data TEXT NOT NULL);

CREATE TABLE openfoot_alternative_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT NOT NULL,fixture_id INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,market TEXT NOT NULL CHECK(market NOT IN ('H','A','D')),
 published_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,data TEXT NOT NULL,
 CHECK(published_at<kickoff)
);

CREATE TABLE openfoot_context_forecasts (
 fixture_id INTEGER NOT NULL,kickoff INTEGER NOT NULL,created_at INTEGER NOT NULL,
 version TEXT NOT NULL,data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,kickoff,created_at),CHECK(created_at<kickoff)
);

CREATE TABLE openfoot_context_quota(day TEXT PRIMARY KEY,n INTEGER NOT NULL);

CREATE TABLE openfoot_context_sources (
 fixture_id INTEGER NOT NULL, kind TEXT NOT NULL, observed_at INTEGER NOT NULL,
 kickoff INTEGER NOT NULL, source_at INTEGER, data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,kind,observed_at), CHECK(observed_at<kickoff)
);

CREATE TABLE openfoot_coverage_audit(
 league INTEGER NOT NULL,fixture_id INTEGER NOT NULL,kind TEXT NOT NULL,
 observed_at INTEGER NOT NULL,data TEXT NOT NULL,
 PRIMARY KEY(league,fixture_id,kind,observed_at)
);

CREATE TABLE openfoot_locks (key TEXT PRIMARY KEY,until INTEGER NOT NULL);

CREATE TABLE openfoot_market_quotes (
 fixture_id INTEGER NOT NULL,kickoff INTEGER NOT NULL,bookmaker TEXT NOT NULL,
 market TEXT NOT NULL,selection TEXT NOT NULL,odd REAL NOT NULL,
 provider_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,
 PRIMARY KEY(fixture_id,bookmaker,market,selection,provider_at),
 CHECK(odd>1 AND observed_at<kickoff AND provider_at<=observed_at)
);

CREATE TABLE openfoot_match_details(
 source_id TEXT NOT NULL,fixture_id INTEGER NOT NULL,league INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,observed_at INTEGER NOT NULL,data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,observed_at),CHECK(observed_at>kickoff)
);

CREATE TABLE openfoot_matches (
 source_id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, season TEXT NOT NULL,
 kickoff INTEGER NOT NULL, data TEXT NOT NULL, fetched_at INTEGER NOT NULL,
 attempted_at INTEGER, retry_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE openfoot_pick_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT NOT NULL,fixture_id INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,market TEXT NOT NULL,
 alternative INTEGER NOT NULL CHECK(alternative IN (0,1)),
 published_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,
 recovered INTEGER NOT NULL DEFAULT 0 CHECK(recovered IN (0,1)),data TEXT NOT NULL,
 CHECK(published_at<kickoff)
);

CREATE TABLE openfoot_publication_archives (
 day TEXT NOT NULL,fixture_id INTEGER NOT NULL,archived_at INTEGER NOT NULL,
 reason TEXT NOT NULL,PRIMARY KEY(day,fixture_id,archived_at)
);

CREATE TABLE openfoot_quota (day TEXT PRIMARY KEY,n INTEGER NOT NULL);

CREATE TABLE openfoot_shadow (
 fixture_id INTEGER NOT NULL, version TEXT NOT NULL, kickoff INTEGER NOT NULL,
 created_at INTEGER NOT NULL CHECK(created_at<kickoff), data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,version,kickoff)
);

CREATE TABLE openfoot_state (key TEXT PRIMARY KEY,data TEXT NOT NULL);

CREATE TABLE openfoot_sync (
 competition_id TEXT NOT NULL, season TEXT NOT NULL, cursor TEXT,
 complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
 updated_at INTEGER NOT NULL, PRIMARY KEY(competition_id,season)
);

CREATE TABLE openfoot_team_links (
 league INTEGER NOT NULL, source_id TEXT NOT NULL, team_id INTEGER NOT NULL,
 evidence TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
 PRIMARY KEY(league,source_id), UNIQUE(league,team_id)
);

CREATE TABLE openfoot_winner_analysis_history (
 fixture_id INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,
 market TEXT NOT NULL CHECK(market IN ('H','A')),
 captured_at INTEGER NOT NULL CHECK(captured_at<kickoff),
 recorded_at INTEGER NOT NULL,
 provenance TEXT NOT NULL CHECK(provenance IN ('displayed','reconstructed')),
 data TEXT NOT NULL CHECK(json_valid(data)),
 PRIMARY KEY(fixture_id,kickoff,market),
 CHECK(provenance='reconstructed' OR recorded_at<kickoff)
);

CREATE TABLE openfoot_xg (
 source_id TEXT PRIMARY KEY, fixture_id INTEGER NOT NULL UNIQUE, league INTEGER NOT NULL,
 kickoff INTEGER NOT NULL, observed_at INTEGER NOT NULL,
 home_xg REAL NOT NULL CHECK(home_xg>=0 AND home_xg<=20),
 away_xg REAL NOT NULL CHECK(away_xg>=0 AND away_xg<=20), data TEXT NOT NULL
);

CREATE TABLE opponent_history (
 team_id INTEGER NOT NULL, fixture_id INTEGER NOT NULL, kickoff INTEGER NOT NULL,
 league_id INTEGER NOT NULL, source_at INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(team_id,fixture_id)
);

CREATE TABLE published_alternatives (
 day TEXT PRIMARY KEY, fixture_id INTEGER NOT NULL, kickoff INTEGER NOT NULL,
 market TEXT NOT NULL CHECK(market NOT IN ('H','A','D')),
 published_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL, data TEXT NOT NULL,
 CHECK(published_at<kickoff)
);

CREATE TABLE published_picks (
 day TEXT NOT NULL, fixture_id INTEGER NOT NULL, kickoff INTEGER NOT NULL,
 market TEXT NOT NULL, alternative INTEGER NOT NULL CHECK(alternative IN (0,1)),
 published_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
 recovered INTEGER NOT NULL DEFAULT 0 CHECK(recovered IN (0,1)), data TEXT NOT NULL,
 PRIMARY KEY(day,fixture_id), CHECK(published_at<kickoff)
);

CREATE TABLE quota(day TEXT PRIMARY KEY,n INTEGER NOT NULL);

CREATE TABLE results(fixture_id INTEGER PRIMARY KEY,hg INTEGER NOT NULL,ag INTEGER NOT NULL,settled_at INTEGER NOT NULL);

CREATE TABLE sync_requests(
 id TEXT PRIMARY KEY, league_id INTEGER NOT NULL CHECK(league_id IN(94,39,140,78,135,61,88,2,3,848)),
 requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0, result TEXT
);

CREATE INDEX bigodds_legs_ticket ON bigodds_legs(ticket_id);

CREATE UNIQUE INDEX bigodds_one_active ON bigodds_tickets(status) WHERE status='active';

CREATE INDEX bigodds_ticket_legs_fixture ON bigodds_ticket_legs(fixture_id);

CREATE INDEX bigodds_ticket_time ON bigodds_tickets(created_at DESC);

CREATE INDEX fixtures_league_time ON fixtures(league,kickoff);

CREATE INDEX fixtures_status_time ON fixtures(kickoff) WHERE finished=0;

CREATE INDEX forecast_fixture ON forecasts(fixture_id);

CREATE INDEX forecasts_fixture_kickoff_created ON forecasts(fixture_id,kickoff,created_at DESC,id DESC);

CREATE INDEX openfoot_analysis_history_kickoff
 ON openfoot_winner_analysis_history(kickoff DESC);

CREATE INDEX openfoot_context_latest ON openfoot_context_sources(fixture_id,kind,observed_at DESC);

CREATE INDEX openfoot_match_details_latest ON openfoot_match_details(league,fixture_id,observed_at DESC);

CREATE INDEX openfoot_matches_pending ON openfoot_matches(status,retry_at,kickoff DESC);

CREATE INDEX openfoot_xg_history ON openfoot_xg(league,kickoff);

CREATE INDEX opponent_history_team_time ON opponent_history(team_id,kickoff);

CREATE UNIQUE INDEX published_alternative_day ON published_picks(day) WHERE alternative=1;

CREATE VIEW bigodds_all_legs AS
 SELECT fixture_id,ticket_id,kickoff,snapshot,status,settled_at,result,'legacy' storage FROM bigodds_legs
 UNION ALL
 SELECT fixture_id,ticket_id,kickoff,snapshot,status,settled_at,result,'ticket' storage FROM bigodds_ticket_legs;

CREATE VIEW openfoot_current_alternatives AS
 SELECT day,fixture_id,kickoff,market,published_at,recorded_at,data FROM published_alternatives p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at)
 UNION ALL
 SELECT day,fixture_id,kickoff,market,published_at,recorded_at,data FROM openfoot_alternative_revisions p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at);

CREATE VIEW openfoot_current_picks AS
 SELECT day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data FROM published_picks p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at)
 UNION ALL
 SELECT day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data FROM openfoot_pick_revisions p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at);

CREATE TRIGGER bigodds_leg_no_delete BEFORE DELETE ON bigodds_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;

CREATE TRIGGER bigodds_leg_snapshot_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;

CREATE TRIGGER bigodds_ticket_leg_no_delete BEFORE DELETE ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;

CREATE TRIGGER bigodds_ticket_leg_snapshot_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;

CREATE TRIGGER bigodds_ticket_no_delete BEFORE DELETE ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable Big Odds ticket'); END;

CREATE TRIGGER bigodds_ticket_snapshot_immutable BEFORE UPDATE OF id,created_at,policy,odd,bookmaker,data ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable Big Odds ticket'); END;

CREATE TRIGGER immutable_daily_markets BEFORE UPDATE ON "daily_markets_v1_archive" BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;

CREATE TRIGGER immutable_daily_markets_delete BEFORE DELETE ON "daily_markets_v1_archive" BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;

CREATE TRIGGER immutable_daily_markets_v2 BEFORE UPDATE ON daily_markets BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;

CREATE TRIGGER immutable_daily_markets_v2_delete BEFORE DELETE ON daily_markets BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;

CREATE TRIGGER immutable_forecasts BEFORE UPDATE ON forecasts BEGIN SELECT RAISE(ABORT,'forecasts are immutable'); END;

CREATE TRIGGER immutable_forecasts_delete BEFORE DELETE ON forecasts BEGIN SELECT RAISE(ABORT,'forecasts are immutable'); END;

CREATE TRIGGER immutable_published_alternatives BEFORE UPDATE ON published_alternatives BEGIN SELECT RAISE(ABORT,'published alternatives are immutable'); END;

CREATE TRIGGER immutable_published_alternatives_delete BEFORE DELETE ON published_alternatives BEGIN SELECT RAISE(ABORT,'published alternatives are immutable'); END;

CREATE TRIGGER immutable_published_picks BEFORE UPDATE ON published_picks BEGIN SELECT RAISE(ABORT,'published picks are immutable'); END;

CREATE TRIGGER immutable_published_picks_delete BEFORE DELETE ON published_picks BEGIN SELECT RAISE(ABORT,'published picks are immutable'); END;

CREATE TRIGGER openfoot_analysis_history_no_delete
 BEFORE DELETE ON openfoot_winner_analysis_history
 BEGIN SELECT RAISE(ABORT,'analysis history is immutable'); END;

CREATE TRIGGER openfoot_analysis_history_no_update
 BEFORE UPDATE ON openfoot_winner_analysis_history
 BEGIN SELECT RAISE(ABORT,'analysis history is immutable'); END;

CREATE TRIGGER openfoot_context_forecasts_no_delete BEFORE DELETE ON openfoot_context_forecasts BEGIN SELECT RAISE(ABORT,'immutable context forecast'); END;

CREATE TRIGGER openfoot_context_forecasts_no_update BEFORE UPDATE ON openfoot_context_forecasts BEGIN SELECT RAISE(ABORT,'immutable context forecast'); END;

CREATE TRIGGER openfoot_context_sources_no_delete BEFORE DELETE ON openfoot_context_sources BEGIN SELECT RAISE(ABORT,'immutable context'); END;

CREATE TRIGGER openfoot_context_sources_no_update BEFORE UPDATE ON openfoot_context_sources BEGIN SELECT RAISE(ABORT,'immutable context'); END;

CREATE TRIGGER openfoot_immutable_alternative_delete BEFORE DELETE ON openfoot_alternative_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;

CREATE TRIGGER openfoot_immutable_alternative_update BEFORE UPDATE ON openfoot_alternative_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;

CREATE TRIGGER openfoot_immutable_pick_delete BEFORE DELETE ON openfoot_pick_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;

CREATE TRIGGER openfoot_immutable_pick_update BEFORE UPDATE ON openfoot_pick_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;

CREATE TRIGGER openfoot_market_quotes_no_delete BEFORE DELETE ON openfoot_market_quotes BEGIN SELECT RAISE(ABORT,'immutable quote'); END;

CREATE TRIGGER openfoot_market_quotes_no_update BEFORE UPDATE ON openfoot_market_quotes BEGIN SELECT RAISE(ABORT,'immutable quote'); END;

CREATE TRIGGER openfoot_match_details_no_delete BEFORE DELETE ON openfoot_match_details BEGIN SELECT RAISE(ABORT,'immutable match details'); END;

CREATE TRIGGER openfoot_match_details_no_update BEFORE UPDATE ON openfoot_match_details BEGIN SELECT RAISE(ABORT,'immutable match details'); END;

CREATE TRIGGER openfoot_no_duplicate_alternative BEFORE INSERT ON openfoot_alternative_revisions
 WHEN EXISTS(SELECT 1 FROM openfoot_current_alternatives p WHERE p.day=NEW.day)
 BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER openfoot_no_duplicate_pick BEFORE INSERT ON openfoot_pick_revisions
 WHEN EXISTS(SELECT 1 FROM openfoot_current_picks p WHERE p.day=NEW.day AND p.fixture_id=NEW.fixture_id)
 BEGIN SELECT RAISE(IGNORE); END;
