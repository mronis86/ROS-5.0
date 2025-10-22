-- Migration 011: Fix show_start_overtime table item_id to BIGINT
-- The item_id values are too large for INTEGER type (max 2,147,483,647)
-- Need to use BIGINT to handle large timestamp-based IDs

-- Drop the existing table and recreate with BIGINT
DROP TABLE IF EXISTS show_start_overtime;

CREATE TABLE show_start_overtime (
    id SERIAL PRIMARY KEY,
    event_id TEXT NOT NULL,
    item_id BIGINT NOT NULL, -- Changed from INTEGER to BIGINT
    show_start_overtime INTEGER NOT NULL, -- Minutes late (+) or early (-)
    scheduled_time TEXT, -- The scheduled start time from Start column
    actual_time TIMESTAMP, -- When the START button was actually clicked
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(event_id, item_id) -- Only one show start overtime per event/item
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_show_start_overtime_event_id ON show_start_overtime(event_id);
CREATE INDEX IF NOT EXISTS idx_show_start_overtime_item_id ON show_start_overtime(item_id);

-- Add comment
COMMENT ON TABLE show_start_overtime IS 'Tracks show start overtime - when show starts early/late compared to scheduled time';
COMMENT ON COLUMN show_start_overtime.show_start_overtime IS 'Minutes late (+) or early (-) compared to scheduled start time';
COMMENT ON COLUMN show_start_overtime.scheduled_time IS 'The scheduled start time from Start column (e.g., "8:00 PM")';
COMMENT ON COLUMN show_start_overtime.actual_time IS 'When the START button was actually clicked';
COMMENT ON COLUMN show_start_overtime.item_id IS 'BIGINT to handle large timestamp-based IDs';
