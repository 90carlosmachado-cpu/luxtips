-- Additive. NBA and football publications are retained.
CREATE TABLE IF NOT EXISTS bigodds_tickets (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, policy TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','won','lost','void')),
 closed_at INTEGER, odd REAL NOT NULL CHECK(odd>=8 AND odd<=15.000000001),
 bookmaker TEXT NOT NULL, data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bigodds_one_active ON bigodds_tickets(status) WHERE status='active';
CREATE INDEX IF NOT EXISTS bigodds_ticket_time ON bigodds_tickets(created_at DESC);
CREATE TABLE IF NOT EXISTS bigodds_legs (
 fixture_id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES bigodds_tickets(id),
 kickoff INTEGER NOT NULL, snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','void')),
 settled_at INTEGER, result TEXT
);
CREATE INDEX IF NOT EXISTS bigodds_legs_ticket ON bigodds_legs(ticket_id);
CREATE TRIGGER IF NOT EXISTS bigodds_ticket_snapshot_immutable BEFORE UPDATE OF id,created_at,policy,odd,bookmaker,data ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable Big Odds ticket'); END;
CREATE TRIGGER IF NOT EXISTS bigodds_leg_snapshot_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
CREATE TRIGGER IF NOT EXISTS bigodds_ticket_no_delete BEFORE DELETE ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable Big Odds ticket'); END;
CREATE TRIGGER IF NOT EXISTS bigodds_leg_no_delete BEFORE DELETE ON bigodds_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
