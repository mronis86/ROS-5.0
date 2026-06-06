-- Per-user personal notes for the Notes popout (separate from shared run_of_show_data)
-- Keyed by event + user + cue row + column so operators don't overwrite each other.

CREATE TABLE IF NOT EXISTS user_event_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  schedule_item_id BIGINT NOT NULL,
  column_key TEXT NOT NULL DEFAULT 'personal',
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id, schedule_item_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_user_event_notes_event_user
  ON user_event_notes (event_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_event_notes_item
  ON user_event_notes (event_id, schedule_item_id);

COMMENT ON TABLE user_event_notes IS 'Personal operator notes for Notes popout; not merged into run_of_show_data';
