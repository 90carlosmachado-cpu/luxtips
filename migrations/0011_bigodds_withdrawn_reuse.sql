-- Preserve legacy snapshots and allow distinct ticket snapshots for an explicitly
-- withdrawn fixture. Publication guards still block all non-withdrawn tickets.
CREATE TABLE IF NOT EXISTS bigodds_ticket_legs (
 fixture_id INTEGER NOT NULL,ticket_id TEXT NOT NULL REFERENCES bigodds_tickets(id),
 kickoff INTEGER NOT NULL,snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost','void')),
 settled_at INTEGER,result TEXT,
 PRIMARY KEY(ticket_id,fixture_id)
);
CREATE INDEX IF NOT EXISTS bigodds_ticket_legs_fixture ON bigodds_ticket_legs(fixture_id);
CREATE VIEW IF NOT EXISTS bigodds_all_legs AS
 SELECT fixture_id,ticket_id,kickoff,snapshot,status,settled_at,result,'legacy' storage FROM bigodds_legs
 UNION ALL
 SELECT fixture_id,ticket_id,kickoff,snapshot,status,settled_at,result,'ticket' storage FROM bigodds_ticket_legs;
CREATE TRIGGER IF NOT EXISTS bigodds_ticket_leg_snapshot_immutable BEFORE UPDATE OF fixture_id,ticket_id,kickoff,snapshot ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
CREATE TRIGGER IF NOT EXISTS bigodds_ticket_leg_no_delete BEFORE DELETE ON bigodds_ticket_legs BEGIN SELECT RAISE(ABORT,'immutable Big Odds leg'); END;
