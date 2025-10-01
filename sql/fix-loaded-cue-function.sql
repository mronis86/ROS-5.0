-- Fix get_active_timer_for_event to return loaded cues
-- This fixes the issue where loaded cues reset immediately after loading

CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    is_running BOOLEAN,
    is_active BOOLEAN,
    timer_state TEXT,
    last_loaded_cue_id TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        at.id,
        at.event_id,
        at.item_id,
        at.user_id,
        at.user_name,
        at.user_role,
        at.started_at,
        at.duration_seconds,
        at.is_running,
        at.is_active,
        at.timer_state,
        at.last_loaded_cue_id
    FROM active_timers at
    WHERE at.event_id = p_event_id AND (at.is_running = true OR at.timer_state = 'loaded');
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION get_active_timer_for_event(TEXT) IS 'Returns active timer or loaded cue for an event';
