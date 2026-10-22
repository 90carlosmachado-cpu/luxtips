-- Requests are created only through authenticated D1 administration, not public input.
CREATE TABLE IF NOT EXISTS sync_requests(
 id TEXT PRIMARY KEY, league_id INTEGER NOT NULL CHECK(league_id IN(94,39,140,78,135,61,88,2,3,848)),
 requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0, result TEXT
);
