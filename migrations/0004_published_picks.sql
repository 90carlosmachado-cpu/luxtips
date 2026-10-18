CREATE TABLE IF NOT EXISTS published_picks (
 day TEXT NOT NULL, fixture_id INTEGER NOT NULL, kickoff INTEGER NOT NULL,
 market TEXT NOT NULL, alternative INTEGER NOT NULL CHECK(alternative IN (0,1)),
 published_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
 recovered INTEGER NOT NULL DEFAULT 0 CHECK(recovered IN (0,1)), data TEXT NOT NULL,
 PRIMARY KEY(day,fixture_id), CHECK(published_at<kickoff)
);
CREATE UNIQUE INDEX IF NOT EXISTS published_alternative_day ON published_picks(day) WHERE alternative=1;
CREATE TRIGGER IF NOT EXISTS immutable_published_picks BEFORE UPDATE ON published_picks BEGIN SELECT RAISE(ABORT,'published picks are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_published_picks_delete BEFORE DELETE ON published_picks BEGIN SELECT RAISE(ABORT,'published picks are immutable'); END;
CREATE TABLE IF NOT EXISTS maintenance_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind='refresh-odds'), requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, result TEXT);
