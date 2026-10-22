CREATE TABLE IF NOT EXISTS openfoot_context_sources (
 fixture_id INTEGER NOT NULL, kind TEXT NOT NULL, observed_at INTEGER NOT NULL,
 kickoff INTEGER NOT NULL, source_at INTEGER, data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,kind,observed_at), CHECK(observed_at<kickoff)
);
CREATE INDEX IF NOT EXISTS openfoot_context_latest ON openfoot_context_sources(fixture_id,kind,observed_at DESC);
CREATE TABLE IF NOT EXISTS openfoot_context_forecasts (
 fixture_id INTEGER NOT NULL,kickoff INTEGER NOT NULL,created_at INTEGER NOT NULL,
 version TEXT NOT NULL,data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,kickoff,created_at),CHECK(created_at<kickoff)
);
CREATE TABLE IF NOT EXISTS openfoot_market_quotes (
 fixture_id INTEGER NOT NULL,kickoff INTEGER NOT NULL,bookmaker TEXT NOT NULL,
 market TEXT NOT NULL,selection TEXT NOT NULL,odd REAL NOT NULL,
 provider_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,
 PRIMARY KEY(fixture_id,bookmaker,market,selection,provider_at),
 CHECK(odd>1 AND observed_at<kickoff AND provider_at<=observed_at)
);
CREATE TABLE IF NOT EXISTS openfoot_context_quota(day TEXT PRIMARY KEY,n INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS openfoot_context_sources_no_update BEFORE UPDATE ON openfoot_context_sources BEGIN SELECT RAISE(ABORT,'immutable context'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_context_sources_no_delete BEFORE DELETE ON openfoot_context_sources BEGIN SELECT RAISE(ABORT,'immutable context'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_context_forecasts_no_update BEFORE UPDATE ON openfoot_context_forecasts BEGIN SELECT RAISE(ABORT,'immutable context forecast'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_context_forecasts_no_delete BEFORE DELETE ON openfoot_context_forecasts BEGIN SELECT RAISE(ABORT,'immutable context forecast'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_market_quotes_no_update BEFORE UPDATE ON openfoot_market_quotes BEGIN SELECT RAISE(ABORT,'immutable quote'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_market_quotes_no_delete BEFORE DELETE ON openfoot_market_quotes BEGIN SELECT RAISE(ABORT,'immutable quote'); END;
