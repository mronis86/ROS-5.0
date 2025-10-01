-- Fix timer timestamp issue
-- This ensures the started_at timestamp is exactly the same between frontend and database

-- Update start_timer_for_event function to accept started_at parameter
DROP FUNCTION IF EXISTS start_timer_for_event(UUID, BIGINT, UUID, INTEGER);

CREATE OR REPLACE FUNCTION start_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER,
  p_started_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO active_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, COALESCE(p_started_at, NOW()), p_duration_seconds, true, 'running')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    -- Use the provided started_at timestamp, or keep existing if not provided
    started_at = CASE 
      WHEN p_started_at IS NOT NULL THEN p_started_at
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

