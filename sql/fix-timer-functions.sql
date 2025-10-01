-- Fix timer functions to handle TEXT parameters instead of UUID
-- This fixes the "operator does not exist: text = uuid" errors

-- Drop existing functions that have type conflicts
DROP FUNCTION IF EXISTS get_active_timer_for_event(TEXT);
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(TEXT);
DROP FUNCTION IF EXISTS has_active_sub_cue_timer_for_event(TEXT);

-- Create function to get active timer for an event (TEXT version)
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    last_loaded_cue_id TEXT,
    is_running BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
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
        at.last_loaded_cue_id,
        at.is_running,
        at.created_at,
        at.updated_at
    FROM active_timers at
    WHERE at.event_id = p_event_id
    AND at.is_running = true
    ORDER BY at.started_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create function to get active sub-cue timers for an event (TEXT version)
CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    sub_cue_id TEXT,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    is_running BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sct.id,
        sct.event_id,
        sct.item_id,
        sct.sub_cue_id,
        sct.user_id,
        sct.user_name,
        sct.user_role,
        sct.started_at,
        sct.is_running,
        sct.created_at,
        sct.updated_at
    FROM sub_cue_timers sct
    WHERE sct.event_id = p_event_id
    AND sct.is_running = true
    ORDER BY sct.started_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to check if there's an active sub-cue timer for an event (TEXT version)
CREATE OR REPLACE FUNCTION has_active_sub_cue_timer_for_event(p_event_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    count_result INTEGER;
BEGIN
    SELECT COUNT(*) INTO count_result
    FROM sub_cue_timers
    WHERE event_id = p_event_id
    AND is_running = true;
    
    RETURN count_result > 0;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on the new functions
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) TO anon;

-- Add comments
COMMENT ON FUNCTION get_active_timer_for_event(TEXT) IS 'Returns active timer for an event (TEXT version)';
COMMENT ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) IS 'Returns active sub-cue timers for an event (TEXT version)';
COMMENT ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) IS 'Checks if there is an active sub-cue timer for an event (TEXT version)';

