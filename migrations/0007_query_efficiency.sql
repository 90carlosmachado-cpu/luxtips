-- Index only unfinished fixtures; preserve the existing league index for historical fits.
CREATE INDEX IF NOT EXISTS fixtures_status_time ON fixtures(kickoff) WHERE finished=0;
-- Latest immutable snapshot for each fixture/kickoff, used by historical evaluation.
CREATE INDEX IF NOT EXISTS forecasts_fixture_kickoff_created ON forecasts(fixture_id,kickoff,created_at DESC,id DESC);
