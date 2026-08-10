-- Add flashing mode for timer/clock stage messages
ALTER TABLE timer_messages
  ADD COLUMN IF NOT EXISTS flashing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN timer_messages.flashing IS 'When true, Clock / Full Screen Timer message display flashes';
