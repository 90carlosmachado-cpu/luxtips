CREATE TABLE IF NOT EXISTS daily_markets (
  day TEXT PRIMARY KEY,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  market TEXT NOT NULL CHECK(market IN ('HX','XA')),
  policy_version TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at<kickoff),
  data TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_daily_markets BEFORE UPDATE ON daily_markets BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_daily_markets_delete BEFORE DELETE ON daily_markets BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;
