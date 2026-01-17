-- Add materialized roster slot count columns to leagues table
-- These columns avoid expensive jsonb_array_elements_text() subqueries in ADP calculations

ALTER TABLE leagues
ADD COLUMN IF NOT EXISTS qb_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS rb_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS wr_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS te_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS flex_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS super_flex_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS rec_flex_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS wrrb_flex_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS k_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS def_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS bn_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS dl_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lb_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS db_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS idp_flex_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS starter_count SMALLINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS idp_count SMALLINT DEFAULT 0;

-- Backfill existing leagues with roster slot counts
UPDATE leagues SET
  qb_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'QB'),
  rb_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'RB'),
  wr_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'WR'),
  te_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'TE'),
  flex_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'FLEX'),
  super_flex_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'SUPER_FLEX'),
  rec_flex_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'REC_FLEX'),
  wrrb_flex_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'WRRB_FLEX'),
  k_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'K'),
  def_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'DEF'),
  bn_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'BN'),
  dl_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'DL'),
  lb_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'LB'),
  db_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'DB'),
  idp_flex_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem = 'IDP_FLEX'),
  starter_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem != 'BN'),
  idp_count = (SELECT COUNT(*) FROM jsonb_array_elements_text(roster_positions) elem WHERE elem IN ('DL', 'LB', 'DB', 'IDP_FLEX'))
WHERE roster_positions IS NOT NULL;

-- Add indexes for common ADP query filters
CREATE INDEX IF NOT EXISTS idx_leagues_qb_count ON leagues(qb_count);
CREATE INDEX IF NOT EXISTS idx_leagues_super_flex_count ON leagues(super_flex_count);
CREATE INDEX IF NOT EXISTS idx_leagues_te_count ON leagues(te_count);

-- Add index on drafts.start_time for date range filtering
CREATE INDEX IF NOT EXISTS idx_drafts_start_time ON drafts(start_time);

-- Add composite index for common ADP query pattern
CREATE INDEX IF NOT EXISTS idx_drafts_status_start_time ON drafts(status, start_time);
