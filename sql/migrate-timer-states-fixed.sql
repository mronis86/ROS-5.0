-- Fixed migration for timer states with proper started_at handling
-- This ensures started_at is only set when timer is actually started, not when it's already running

-- Update start_timer_for_event function to properly handle started_at
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
    -- Only update started_at if timer is not already running
    started_at = CASE 
      WHEN active_timers.timer_state = 'running' THEN active_timers.started_at
      ELSE EXCLUDED.started_at
    END,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = EXCLUDED.is_active,
    timer_state = 'running',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Also create a function to get active timer with proper started_at
DROP FUNCTION IF EXISTS get_active_timer_for_event(UUID);

CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id UUID)
RETURNS TABLE(
  id UUID,
  event_id UUID,
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  is_active BOOLEAN,
  timer_state TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.id,
    at.event_id,
    at.item_id,
    at.user_id,
    at.started_at,
    at.duration_seconds,
    at.is_active,
    at.timer_state,
    at.created_at,
    at.updated_at
  FROM active_timers at
  WHERE at.event_id = p_event_id 
    AND at.is_active = true
    AND at.timer_state IN ('loaded', 'running')
  ORDER BY at.updated_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Add a function to update timer state without changing started_at
CREATE OR REPLACE FUNCTION update_timer_state(
  p_event_id UUID,
  p_timer_state TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE active_timers 
  SET 
    timer_state = p_timer_state,
    updated_at = NOW()
  WHERE event_id = p_event_id AND is_active = true;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Add a function to load a timer (set to loaded state without starting)
CREATE OR REPLACE FUNCTION load_timer_for_event(
  p_event_id UUID,
  p_item_id BIGINT,
  p_user_id UUID,
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO active_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NULL, p_duration_seconds, true, 'loaded')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    -- Don't change started_at when loading
    started_at = active_timers.started_at,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = EXCLUDED.is_active,
    timer_state = 'loaded',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

