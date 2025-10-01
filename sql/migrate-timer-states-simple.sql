-- Simplified migration script for main timer functionality only
-- Run this in your Supabase SQL editor to apply the timer state changes

-- Add timer_state column to existing active_timers table
ALTER TABLE active_timers 
ADD COLUMN IF NOT EXISTS timer_state VARCHAR(20) DEFAULT 'stopped' CHECK (timer_state IN ('loaded', 'running', 'stopped'));

-- Create index for timer_state
CREATE INDEX IF NOT EXISTS idx_active_timers_timer_state ON active_timers(timer_state);

-- Add timer_state column to timer_actions table
ALTER TABLE timer_actions 
ADD COLUMN IF NOT EXISTS timer_state VARCHAR(20);

-- Add last_loaded_cue tracking to calendar_events table
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS last_loaded_cue_id BIGINT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS last_loaded_cue_state VARCHAR(20) DEFAULT 'none' CHECK (last_loaded_cue_state IN ('none', 'loaded', 'running', 'stopped'));

-- Create index for last_loaded_cue_id
CREATE INDEX IF NOT EXISTS idx_calendar_events_last_loaded_cue_id ON calendar_events(last_loaded_cue_id);

-- Update existing records to have proper timer_state based on is_active
UPDATE active_timers 
SET timer_state = CASE 
  WHEN is_active = true THEN 'running'
  WHEN is_active = false AND started_at IS NULL THEN 'loaded'
  ELSE 'stopped'
END
WHERE timer_state = 'stopped' OR timer_state IS NULL;

-- Drop and recreate the get_active_timer_for_event function with timer_state
DROP FUNCTION IF EXISTS get_active_timer_for_event(UUID);

CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  elapsed_seconds BIGINT,
  remaining_seconds BIGINT,
  is_active BOOLEAN,
  timer_state VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.id,
    at.item_id,
    at.user_id,
    at.started_at,
    at.duration_seconds,
    CASE 
      WHEN at.timer_state = 'running' AND at.started_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (NOW() - at.started_at))::BIGINT 
      ELSE 0 
    END as elapsed_seconds,
    CASE 
      WHEN at.timer_state = 'running' AND at.started_at IS NOT NULL AND at.duration_seconds IS NOT NULL
      THEN GREATEST(0, at.duration_seconds - EXTRACT(EPOCH FROM (NOW() - at.started_at))::BIGINT)
      ELSE 0 
    END as remaining_seconds,
    at.is_active,
    at.timer_state
  FROM active_timers at
  WHERE at.event_id = p_event_id
    AND at.timer_state IN ('loaded', 'running');
END;
$$ LANGUAGE plpgsql;

-- Update load_cue_for_event function to set timer_state
DROP FUNCTION IF EXISTS load_cue_for_event(UUID, BIGINT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION load_cue_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO active_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NULL, p_duration_seconds, false, 'loaded')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    started_at = NULL,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = false,
    timer_state = 'loaded',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Update start_timer_for_event function to set timer_state
DROP FUNCTION IF EXISTS start_timer_for_event(UUID, BIGINT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION start_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO active_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NOW(), p_duration_seconds, true, 'running')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    started_at = EXCLUDED.started_at,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = EXCLUDED.is_active,
    timer_state = 'running',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Update stop_timer_for_event function to set timer_state
DROP FUNCTION IF EXISTS stop_timer_for_event(UUID);

CREATE OR REPLACE FUNCTION stop_timer_for_event(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE active_timers 
  SET is_active = false, timer_state = 'stopped', updated_at = NOW()
  WHERE event_id = p_event_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to update last loaded CUE
CREATE OR REPLACE FUNCTION update_last_loaded_cue(p_event_id UUID, p_cue_id BIGINT, p_state VARCHAR(20))
RETURNS VOID AS $$
BEGIN
  UPDATE calendar_events 
  SET last_loaded_cue_id = p_cue_id, 
      last_loaded_cue_state = p_state,
      updated_at = NOW()
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get last loaded CUE
CREATE OR REPLACE FUNCTION get_last_loaded_cue(p_event_id UUID)
RETURNS TABLE (
  cue_id BIGINT,
  state VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.last_loaded_cue_id,
    ce.last_loaded_cue_state
  FROM calendar_events ce
  WHERE ce.id = p_event_id;
END;
$$ LANGUAGE plpgsql;

-- Backfill timer_state for existing records
UPDATE active_timers SET timer_state = 'stopped' WHERE timer_state IS NULL;
UPDATE timer_actions SET timer_state = 'stopped' WHERE timer_state IS NULL;

-- Verify the changes
SELECT 'Migration completed successfully!' as status;
SELECT COUNT(*) as active_timers_count FROM active_timers;
SELECT COUNT(*) as timer_actions_count FROM timer_actions;
SELECT 'calendar_events columns:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'calendar_events' 
AND column_name IN ('last_loaded_cue_id', 'last_loaded_cue_state');
SELECT 'Functions created:' as info;
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('update_last_loaded_cue', 'get_last_loaded_cue', 'get_active_timer_for_event');

