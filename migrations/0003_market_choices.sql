-- Expand the constraint without changing any existing reservation or forecast.
-- D1 migrations execute this once; retain the immutable original table as an audit archive.
ALTER TABLE daily_markets RENAME TO daily_markets_v1_archive;
CREATE TABLE daily_markets (
  day TEXT PRIMARY KEY,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  market TEXT NOT NULL CHECK(market IN ('HX','XA','O15','U15','O25','U25','O35','U35','BY','BN','HO05','AO05','HO15','AO15','O05','U45','HU15','AU15','HU25','AU25','HAP15','AAP15')),
  policy_version TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at<kickoff),
  data TEXT NOT NULL
);
INSERT INTO daily_markets SELECT * FROM daily_markets_v1_archive;
CREATE TRIGGER immutable_daily_markets_v2 BEFORE UPDATE ON daily_markets BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;
CREATE TRIGGER immutable_daily_markets_v2_delete BEFORE DELETE ON daily_markets BEGIN SELECT RAISE(ABORT,'daily market is immutable'); END;
