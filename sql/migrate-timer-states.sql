-- Migration script to add timer_state column and update functions
-- Run this in your Supabase SQL editor to apply the timer state changes

-- Add timer_state column to existing active_timers table
ALTER TABLE active_timers 
ADD COLUMN IF NOT EXISTS timer_state VARCHAR(20) DEFAULT 'stopped' CHECK (timer_state IN ('loaded', 'running', 'stopped'));

-- Create index for timer_state
CREATE INDEX IF NOT EXISTS idx_active_timers_timer_state ON active_timers(timer_state);

-- Add timer_state column to timer_actions table
ALTER TABLE timer_actions 
ADD COLUMN IF NOT EXISTS timer_state VARCHAR(20);

-- Create sub_cue_timers table for indented items
CREATE TABLE IF NOT EXISTS sub_cue_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  is_active BOOLEAN DEFAULT false,
  timer_state VARCHAR(20) DEFAULT 'stopped' CHECK (timer_state IN ('loaded', 'running', 'stopped')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, item_id) -- Only one sub-cue timer per item per event
);

-- Create secondary_timers table for secondary timer display
CREATE TABLE IF NOT EXISTS secondary_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE, -- Only one secondary timer per event
  item_id BIGINT NOT NULL,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  remaining_seconds INTEGER,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add timer_state column to secondary_timers table
ALTER TABLE secondary_timers 
ADD COLUMN IF NOT EXISTS timer_state VARCHAR(20) DEFAULT 'stopped' CHECK (timer_state IN ('loaded', 'running', 'stopped'));

-- Add last_loaded_cue tracking to calendar_events table
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS last_loaded_cue_id BIGINT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS last_loaded_cue_state VARCHAR(20) DEFAULT 'none' CHECK (last_loaded_cue_state IN ('none', 'loaded', 'running', 'stopped'));

-- Create index for last_loaded_cue_id
CREATE INDEX IF NOT EXISTS idx_calendar_events_last_loaded_cue_id ON calendar_events(last_loaded_cue_id);

-- Create indexes for sub_cue_timers
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_item_id ON sub_cue_timers(item_id);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_is_active ON sub_cue_timers(is_active);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_timer_state ON sub_cue_timers(timer_state);

-- Create indexes for secondary_timers
CREATE INDEX IF NOT EXISTS idx_secondary_timers_event_id ON secondary_timers(event_id);
CREATE INDEX IF NOT EXISTS idx_secondary_timers_item_id ON secondary_timers(item_id);
CREATE INDEX IF NOT EXISTS idx_secondary_timers_is_active ON secondary_timers(is_active);
CREATE INDEX IF NOT EXISTS idx_secondary_timers_timer_state ON secondary_timers(timer_state);

-- Enable RLS for sub_cue_timers
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view sub-cue timers for their events" ON sub_cue_timers;
DROP POLICY IF EXISTS "Users can insert/update sub-cue timers for their events" ON sub_cue_timers;

-- Create RLS policies for sub_cue_timers
CREATE POLICY "Users can view sub-cue timers for their events" ON sub_cue_timers
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert/update sub-cue timers for their events" ON sub_cue_timers
  FOR ALL USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Enable RLS for secondary_timers
ALTER TABLE secondary_timers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view secondary timers for their events" ON secondary_timers;
DROP POLICY IF EXISTS "Users can insert/update secondary timers for their events" ON secondary_timers;

-- Create RLS policies for secondary_timers
CREATE POLICY "Users can view secondary timers for their events" ON secondary_timers
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert/update secondary timers for their events" ON secondary_timers
  FOR ALL USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

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

-- Function to get active sub-cue timers for an event
CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(p_event_id UUID)
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
    sct.id,
    sct.item_id,
    sct.user_id,
    sct.started_at,
    sct.duration_seconds,
    CASE 
      WHEN sct.timer_state = 'running' AND sct.started_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (NOW() - sct.started_at))::BIGINT 
      ELSE 0 
    END as elapsed_seconds,
    CASE 
      WHEN sct.timer_state = 'running' AND sct.started_at IS NOT NULL AND sct.duration_seconds IS NOT NULL
      THEN GREATEST(0, sct.duration_seconds - EXTRACT(EPOCH FROM (NOW() - sct.started_at))::BIGINT)
      ELSE 0 
    END as remaining_seconds,
    sct.is_active,
    sct.timer_state
  FROM sub_cue_timers sct
  WHERE sct.event_id = p_event_id
    AND sct.timer_state IN ('loaded', 'running');
END;
$$ LANGUAGE plpgsql;

-- Function to start sub-cue timer
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO sub_cue_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NOW(), p_duration_seconds, true, 'running')
  ON CONFLICT (event_id, item_id) 
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    started_at = EXCLUDED.started_at,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = EXCLUDED.is_active,
    timer_state = 'running',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to stop sub-cue timer
CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(p_event_id UUID, p_item_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE sub_cue_timers 
  SET is_active = false, timer_state = 'stopped', updated_at = NOW()
  WHERE event_id = p_event_id AND item_id = p_item_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Drop existing function first
DROP FUNCTION IF EXISTS get_active_secondary_timer_for_event(UUID);

-- Function to get active secondary timer for an event
CREATE OR REPLACE FUNCTION get_active_secondary_timer_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  remaining_seconds INTEGER,
  is_active BOOLEAN,
  timer_state VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.id,
    st.item_id,
    st.user_id,
    st.started_at,
    st.duration_seconds,
    st.remaining_seconds,
    st.is_active,
    st.timer_state
  FROM secondary_timers st
  WHERE st.event_id = p_event_id
    AND st.timer_state IN ('loaded', 'running');
END;
$$ LANGUAGE plpgsql;

-- Function to load secondary timer (set to loaded state)
CREATE OR REPLACE FUNCTION load_secondary_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO secondary_timers (event_id, item_id, user_id, started_at, duration_seconds, remaining_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NULL, p_duration_seconds, p_duration_seconds, false, 'loaded')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    started_at = NULL,
    duration_seconds = EXCLUDED.duration_seconds,
    remaining_seconds = EXCLUDED.remaining_seconds,
    is_active = false,
    timer_state = 'loaded',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to start secondary timer (set to running state)
CREATE OR REPLACE FUNCTION start_secondary_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO secondary_timers (event_id, item_id, user_id, started_at, duration_seconds, remaining_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NOW(), p_duration_seconds, p_duration_seconds, true, 'running')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    started_at = EXCLUDED.started_at,
    duration_seconds = EXCLUDED.duration_seconds,
    remaining_seconds = EXCLUDED.remaining_seconds,
    is_active = true,
    timer_state = 'running',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to stop secondary timer
CREATE OR REPLACE FUNCTION stop_secondary_timer_for_event(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE secondary_timers 
  SET is_active = false, timer_state = 'stopped', updated_at = NOW()
  WHERE event_id = p_event_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to update secondary timer remaining time
CREATE OR REPLACE FUNCTION update_secondary_timer_remaining(
  p_event_id UUID, 
  p_remaining_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE secondary_timers 
  SET remaining_seconds = p_remaining_seconds, updated_at = NOW()
  WHERE event_id = p_event_id AND is_active = true;
  
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
UPDATE secondary_timers SET timer_state = 'stopped' WHERE timer_state IS NULL;

-- Verify the changes
SELECT 'Migration completed successfully!' as status;
SELECT COUNT(*) as active_timers_count FROM active_timers;
SELECT COUNT(*) as timer_actions_count FROM timer_actions;
SELECT COUNT(*) as sub_cue_timers_count FROM sub_cue_timers;
SELECT COUNT(*) as secondary_timers_count FROM secondary_timers;
