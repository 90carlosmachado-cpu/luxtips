-- An additional selection never overwrites an already published winner.
CREATE TABLE IF NOT EXISTS published_alternatives (
 day TEXT PRIMARY KEY, fixture_id INTEGER NOT NULL, kickoff INTEGER NOT NULL,
 market TEXT NOT NULL CHECK(market NOT IN ('H','A','D')),
 published_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL, data TEXT NOT NULL,
 CHECK(published_at<kickoff)
);
CREATE TRIGGER IF NOT EXISTS immutable_published_alternatives BEFORE UPDATE ON published_alternatives BEGIN SELECT RAISE(ABORT,'published alternatives are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_published_alternatives_delete BEFORE DELETE ON published_alternatives BEGIN SELECT RAISE(ABORT,'published alternatives are immutable'); END;
