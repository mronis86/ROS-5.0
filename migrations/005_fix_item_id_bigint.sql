-- migrations/005_fix_item_id_bigint.sql

-- Fix item_id column to use BIGINT instead of INTEGER
-- PostgreSQL INTEGER can only hold values up to 2,147,483,647
-- But our item_id values are much larger (e.g., 1759289895440)

-- Update active_timers table
ALTER TABLE active_timers 
ALTER COLUMN item_id TYPE BIGINT USING item_id::bigint;

-- Update completed_cues table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'completed_cues' AND column_name = 'item_id') THEN
        ALTER TABLE completed_cues 
        ALTER COLUMN item_id TYPE BIGINT USING item_id::bigint;
    END IF;
END $$;

-- Update sub_cue_timers table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'sub_cue_timers' AND column_name = 'item_id') THEN
        ALTER TABLE sub_cue_timers 
        ALTER COLUMN item_id TYPE BIGINT USING item_id::bigint;
    END IF;
END $$;

-- Update last_loaded_cue_id column in active_timers if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'active_timers' AND column_name = 'last_loaded_cue_id') THEN
        ALTER TABLE active_timers 
        ALTER COLUMN last_loaded_cue_id TYPE BIGINT USING last_loaded_cue_id::bigint;
    END IF;
END $$;

-- Update any other tables that might have item_id columns
-- Check run_of_show_data table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'run_of_show_data' AND column_name = 'item_id') THEN
        ALTER TABLE run_of_show_data 
        ALTER COLUMN item_id TYPE BIGINT USING item_id::bigint;
    END IF;
END $$;

-- Update indexes to handle BIGINT
DROP INDEX IF EXISTS idx_active_timers_item_id;
CREATE INDEX IF NOT EXISTS idx_active_timers_item_id ON active_timers(item_id);

-- Update functions to handle BIGINT
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT,  -- Changed from INTEGER to BIGINT
  user_id TEXT,
  user_name TEXT,
  user_role TEXT,
  timer_state TEXT,
  is_active BOOLEAN,
  is_running BOOLEAN,
  started_at TIMESTAMPTZ,
  last_loaded_cue_id BIGINT,  -- Changed from INTEGER to BIGINT
  cue_is TEXT,
  duration_seconds INTEGER,
  elapsed_seconds INTEGER,
  remaining_seconds INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    at.id,
    at.item_id,
    at.user_id,
    at.user_name,
    at.user_role,
    at.timer_state,
    at.is_active,
    at.is_running,
    at.started_at,
    at.last_loaded_cue_id,
    at.cue_is,
    at.duration_seconds,
    CASE
      WHEN at.is_running AND at.started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - at.started_at))::INTEGER
      ELSE at.elapsed_seconds -- Use stored elapsed_seconds if not running
    END as elapsed_seconds,
    CASE
      WHEN at.is_running AND at.started_at IS NOT NULL THEN GREATEST(0, at.duration_seconds - EXTRACT(EPOCH FROM (NOW() - at.started_at))::INTEGER)
      ELSE GREATEST(0, at.duration_seconds - at.elapsed_seconds) -- Use stored elapsed_seconds if not running
    END as remaining_seconds
  FROM active_timers at
  WHERE at.event_id = p_event_id
  ORDER BY at.updated_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
