-- Supplemental source data is kept outside the calibrated model's training pool.
CREATE TABLE IF NOT EXISTS opponent_history (
 team_id INTEGER NOT NULL, fixture_id INTEGER NOT NULL, kickoff INTEGER NOT NULL,
 league_id INTEGER NOT NULL, source_at INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(team_id,fixture_id)
);
CREATE INDEX IF NOT EXISTS opponent_history_team_time ON opponent_history(team_id,kickoff);
