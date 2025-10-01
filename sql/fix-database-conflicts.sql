-- Fix database function conflicts by removing all conflicting functions
-- and creating clean TEXT-only versions

-- Drop ALL existing timer functions to avoid conflicts
DROP FUNCTION IF EXISTS get_active_timer_for_event(UUID);
DROP FUNCTION IF EXISTS get_active_timer_for_event(TEXT);
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(UUID);
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(TEXT);
DROP FUNCTION IF EXISTS has_active_sub_cue_timer_for_event(UUID);
DROP FUNCTION IF EXISTS has_active_sub_cue_timer_for_event(TEXT);
DROP FUNCTION IF EXISTS get_recent_timer_actions(UUID);
DROP FUNCTION IF EXISTS get_last_loaded_cue(UUID);
DROP FUNCTION IF EXISTS get_completed_cues_for_event(UUID);
DROP FUNCTION IF EXISTS clear_completed_cues_for_event(UUID);
DROP FUNCTION IF EXISTS cleanup_old_timer_actions();

-- Create clean TEXT-only functions
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

CREATE OR REPLACE FUNCTION get_recent_timer_actions(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    action_type TEXT,
    action_timestamp TIMESTAMP WITH TIME ZONE,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    details JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta.id,
        ta.event_id,
        ta.item_id,
        ta.action_type,
        ta.action_timestamp,
        ta.user_id,
        ta.user_name,
        ta.user_role,
        ta.details
    FROM timer_actions ta
    WHERE ta.event_id = p_event_id
    ORDER BY ta.action_timestamp DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_last_loaded_cue(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    cue_id TEXT,
    loaded_at TIMESTAMP WITH TIME ZONE,
    user_id TEXT,
    user_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        at.id,
        at.event_id,
        at.item_id,
        at.last_loaded_cue_id,
        at.updated_at,
        at.user_id,
        at.user_name
    FROM active_timers at
    WHERE at.event_id = p_event_id
    AND at.last_loaded_cue_id IS NOT NULL
    ORDER BY at.updated_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_completed_cues_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    cue_id TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cc.id,
        cc.event_id,
        cc.item_id,
        cc.cue_id,
        cc.completed_at,
        cc.user_id,
        cc.user_name,
        cc.user_role
    FROM completed_cues cc
    WHERE cc.event_id = p_event_id
    ORDER BY cc.completed_at DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clear_completed_cues_for_event(p_event_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM completed_cues 
    WHERE event_id = p_event_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_timer_actions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM timer_actions 
    WHERE action_timestamp < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on all functions
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_recent_timer_actions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_timer_actions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_last_loaded_cue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_last_loaded_cue(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_completed_cues_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_completed_cues_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION clear_completed_cues_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_completed_cues_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION cleanup_old_timer_actions() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_timer_actions() TO anon;

-- Add comments
COMMENT ON FUNCTION get_active_timer_for_event(TEXT) IS 'Returns active timer for an event (TEXT version)';
COMMENT ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) IS 'Returns active sub-cue timers for an event (TEXT version)';
COMMENT ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) IS 'Checks if there is an active sub-cue timer for an event (TEXT version)';
COMMENT ON FUNCTION get_recent_timer_actions(TEXT) IS 'Returns recent timer actions for an event (TEXT version)';
COMMENT ON FUNCTION get_last_loaded_cue(TEXT) IS 'Returns the last loaded cue for an event (TEXT version)';
COMMENT ON FUNCTION get_completed_cues_for_event(TEXT) IS 'Returns completed cues for an event (TEXT version)';
COMMENT ON FUNCTION clear_completed_cues_for_event(TEXT) IS 'Clears all completed cues for an event (TEXT version)';
COMMENT ON FUNCTION cleanup_old_timer_actions() IS 'Removes timer actions older than 7 days';

