-- Additive only. Must be applied explicitly; never run by request handlers.
CREATE TABLE IF NOT EXISTS openfoot_sync (
 competition_id TEXT NOT NULL, season TEXT NOT NULL, cursor TEXT,
 complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
 updated_at INTEGER NOT NULL, PRIMARY KEY(competition_id,season)
);
CREATE TABLE IF NOT EXISTS openfoot_matches (
 source_id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, season TEXT NOT NULL,
 kickoff INTEGER NOT NULL, data TEXT NOT NULL, fetched_at INTEGER NOT NULL,
 attempted_at INTEGER, retry_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS openfoot_matches_pending ON openfoot_matches(status,retry_at,kickoff DESC);
CREATE TABLE IF NOT EXISTS openfoot_team_links (
 league INTEGER NOT NULL, source_id TEXT NOT NULL, team_id INTEGER NOT NULL,
 evidence TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
 PRIMARY KEY(league,source_id), UNIQUE(league,team_id)
);
CREATE TABLE IF NOT EXISTS openfoot_xg (
 source_id TEXT PRIMARY KEY, fixture_id INTEGER NOT NULL UNIQUE, league INTEGER NOT NULL,
 kickoff INTEGER NOT NULL, observed_at INTEGER NOT NULL,
 home_xg REAL NOT NULL CHECK(home_xg>=0 AND home_xg<=20),
 away_xg REAL NOT NULL CHECK(away_xg>=0 AND away_xg<=20), data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS openfoot_xg_history ON openfoot_xg(league,kickoff);
CREATE TABLE IF NOT EXISTS openfoot_state (key TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS openfoot_quota (day TEXT PRIMARY KEY,n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS openfoot_locks (key TEXT PRIMARY KEY,until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS openfoot_shadow (
 fixture_id INTEGER NOT NULL, version TEXT NOT NULL, kickoff INTEGER NOT NULL,
 created_at INTEGER NOT NULL CHECK(created_at<kickoff), data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,version,kickoff)
);
