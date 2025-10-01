-- Function to get completed cues for an event
-- This returns all cues that have been stopped/completed

CREATE OR REPLACE FUNCTION get_completed_cues(p_event_id UUID)
RETURNS TABLE (
  item_id BIGINT,
  completed_at TIMESTAMPTZ,
  user_id UUID,
  user_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ta.item_id,
    ta.action_timestamp as completed_at,
    ta.user_id,
    COALESCE(us.username, 'Unknown User') as user_name
  FROM timer_actions ta
  LEFT JOIN user_sessions us ON ta.user_id = us.user_id AND ta.event_id = us.event_id
  WHERE ta.event_id = p_event_id
    AND ta.action_type = 'STOP_TIMER'
    AND ta.item_id IS NOT NULL
  ORDER BY ta.action_timestamp DESC;
END;
$$ LANGUAGE plpgsql;
