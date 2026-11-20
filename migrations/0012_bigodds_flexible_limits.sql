-- Apply as one atomic migration before publishing policy v6.
-- Existing ticket/leg snapshots are copied verbatim; foreign keys remain enabled.
-- Rebuild the complete dependency graph so dropping the old parent cannot leave
-- deferred FK violations. Do not set defer_foreign_keys=OFF to hide violations.
-- Preflight: only the two Bigodes leg tables may reference bigodds_tickets;
-- compare all three tables, indexes and triggers before/after the migration.
CREATE TABLE bigodds_tickets_next (
 id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, policy TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','won','lost','void')),
 closed_at INTEGER, odd REAL NOT NULL CHECK(odd>=2),
 bookmaker TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE bigodds_legs_next (
 fixture_id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES bigodds_tickets_next(id),
 kickoff INTEGER NOT NULL, snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','void')),
 settled_at INTEGER, result TEXT
);
CREATE TABLE bigodds_ticket_legs_next (
 fixture_id INTEGER NOT NULL,ticket_id TEXT NOT NULL REFERENCES bigodds_tickets_next(id),
 kickoff INTEGER NOT NULL,snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','void')),
 settled_at INTEGER,result TEXT,
 PRIMARY KEY(ticket_id,fixture_id)
);
INSERT INTO bigodds_tickets_next SELECT * FROM bigodds_tickets;
INSERT INTO bigodds_legs_next SELECT * FROM bigodds_legs;
INSERT INTO bigodds_ticket_legs_next SELECT * FROM bigodds_ticket_legs;
DROP VIEW bigodds_all_legs;
DROP TABLE bigodds_legs;
DROP TABLE bigodds_ticket_legs;
DROP TABLE bigodds_tickets;
ALTER TABLE bigodds_tickets_next RENAME TO bigodds_tickets;
ALTER TABLE bigodds_legs_next RENAME TO bigodds_legs;
ALTER TABLE bigodds_ticket_legs_next RENAME TO bigodds_ticket_legs;
CREATE UNIQUE INDEX bigodds_one_active ON bigodds_tickets(status) WHERE status='active';
CREATE INDEX bigodds_ticket_time ON bigodds_tickets(created_at DESC);
CREATE INDEX bigodds_legs_ticket ON bigodds_legs(ticket_id);
CREATE INDEX bigodds_ticket_legs_fixture ON bigodds_ticket_legs(fixture_id);
CREATE VIEW bigodds_all_legs AS
 SELECT fixture_id,ticket_id,kickoff,snapshot,status,settled_at,result,'legacy' storage FROM bigodds_legs
 UNION ALL
 SELECT fixture_id,ticket_id,kickoff,snapshot,status,settled_at,result,'ticket' storage FROM bigodds_ticket_legs;
CREATE TRIGGER bigodds_ticket_snapshot_immutable BEFORE UPDATE OF id,created_at,policy,odd,bookmaker,data ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable Big Odds ticket'); END;
CREATE TRIGGER bigodds_leg_snapshot_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
CREATE TRIGGER bigodds_ticket_no_delete BEFORE DELETE ON bigodds_tickets BEGIN SELECT RAISE(ABORT,'immutable Big Odds ticket'); END;
CREATE TRIGGER bigodds_leg_no_delete BEFORE DELETE ON bigodds_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
CREATE TRIGGER bigodds_ticket_leg_snapshot_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
CREATE TRIGGER bigodds_ticket_leg_no_delete BEFORE DELETE ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
PRAGMA foreign_key_check;
