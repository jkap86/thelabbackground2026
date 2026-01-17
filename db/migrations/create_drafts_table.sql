CREATE TABLE IF NOT EXISTS drafts (
    draft_id VARCHAR(255) PRIMARY KEY,
    league_id VARCHAR(255) NOT NULL,
    season VARCHAR(10) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    rounds INTEGER NOT NULL,
    start_time BIGINT,
    last_picked BIGINT,
    draft_order JSONB,
    slot_to_roster_id JSONB,
    settings JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (league_id) REFERENCES leagues(league_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drafts_league_id ON drafts(league_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_league_season ON drafts(league_id, season);
