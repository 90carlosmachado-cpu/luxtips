CREATE TABLE IF NOT EXISTS openfoot_match_details(
 source_id TEXT NOT NULL,fixture_id INTEGER NOT NULL,league INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,observed_at INTEGER NOT NULL,data TEXT NOT NULL,
 PRIMARY KEY(fixture_id,observed_at),CHECK(observed_at>kickoff)
);
CREATE INDEX IF NOT EXISTS openfoot_match_details_latest ON openfoot_match_details(league,fixture_id,observed_at DESC);
CREATE TRIGGER IF NOT EXISTS openfoot_match_details_no_update BEFORE UPDATE ON openfoot_match_details BEGIN SELECT RAISE(ABORT,'immutable match details'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_match_details_no_delete BEFORE DELETE ON openfoot_match_details BEGIN SELECT RAISE(ABORT,'immutable match details'); END;
CREATE TABLE IF NOT EXISTS openfoot_coverage_audit(
 league INTEGER NOT NULL,fixture_id INTEGER NOT NULL,kind TEXT NOT NULL,
 observed_at INTEGER NOT NULL,data TEXT NOT NULL,
 PRIMARY KEY(league,fixture_id,kind,observed_at)
);
