-- Immutable publications stay untouched. User-requested resets append archive
-- markers; subsequent cycles append new revisions, including for the same game.
CREATE TABLE IF NOT EXISTS openfoot_publication_archives (
 day TEXT NOT NULL,fixture_id INTEGER NOT NULL,archived_at INTEGER NOT NULL,
 reason TEXT NOT NULL,PRIMARY KEY(day,fixture_id,archived_at)
);
CREATE TABLE IF NOT EXISTS openfoot_pick_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT NOT NULL,fixture_id INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,market TEXT NOT NULL,
 alternative INTEGER NOT NULL CHECK(alternative IN (0,1)),
 published_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,
 recovered INTEGER NOT NULL DEFAULT 0 CHECK(recovered IN (0,1)),data TEXT NOT NULL,
 CHECK(published_at<kickoff)
);
CREATE TABLE IF NOT EXISTS openfoot_alternative_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT NOT NULL,fixture_id INTEGER NOT NULL,
 kickoff INTEGER NOT NULL,market TEXT NOT NULL CHECK(market NOT IN ('H','A','D')),
 published_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL,data TEXT NOT NULL,
 CHECK(published_at<kickoff)
);
CREATE VIEW IF NOT EXISTS openfoot_current_picks AS
 SELECT day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data FROM published_picks p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at)
 UNION ALL
 SELECT day,fixture_id,kickoff,market,alternative,published_at,recorded_at,recovered,data FROM openfoot_pick_revisions p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at);
CREATE VIEW IF NOT EXISTS openfoot_current_alternatives AS
 SELECT day,fixture_id,kickoff,market,published_at,recorded_at,data FROM published_alternatives p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at)
 UNION ALL
 SELECT day,fixture_id,kickoff,market,published_at,recorded_at,data FROM openfoot_alternative_revisions p
 WHERE NOT EXISTS(SELECT 1 FROM openfoot_publication_archives a WHERE a.day=p.day AND a.fixture_id=p.fixture_id AND p.published_at<=a.archived_at);
CREATE TRIGGER IF NOT EXISTS openfoot_no_duplicate_pick BEFORE INSERT ON openfoot_pick_revisions
 WHEN EXISTS(SELECT 1 FROM openfoot_current_picks p WHERE p.day=NEW.day AND p.fixture_id=NEW.fixture_id)
 BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS openfoot_no_duplicate_alternative BEFORE INSERT ON openfoot_alternative_revisions
 WHEN EXISTS(SELECT 1 FROM openfoot_current_alternatives p WHERE p.day=NEW.day)
 BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS openfoot_immutable_pick_update BEFORE UPDATE ON openfoot_pick_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_immutable_pick_delete BEFORE DELETE ON openfoot_pick_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_immutable_alternative_update BEFORE UPDATE ON openfoot_alternative_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS openfoot_immutable_alternative_delete BEFORE DELETE ON openfoot_alternative_revisions
 BEGIN SELECT RAISE(ABORT,'published revisions are immutable'); END;
