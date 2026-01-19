-- Add GIN index on leagues.rosters for faster leaguemate lookups
CREATE INDEX IF NOT EXISTS idx_leagues_rosters_gin ON leagues USING GIN (rosters);
