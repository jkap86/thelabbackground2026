CREATE TABLE IF NOT EXISTS draft_picks (
    id SERIAL PRIMARY KEY,
    draft_id VARCHAR(255) NOT NULL,
    player_id VARCHAR(255) NOT NULL,
    picked_by VARCHAR(255) NOT NULL,
    roster_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    draft_slot INTEGER NOT NULL,
    pick_no INTEGER NOT NULL,
    amount INTEGER,
    is_keeper BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE,
    UNIQUE(draft_id, pick_no)
);

CREATE INDEX IF NOT EXISTS idx_draft_picks_draft_id ON draft_picks(draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_player_id ON draft_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_picked_by ON draft_picks(picked_by);
