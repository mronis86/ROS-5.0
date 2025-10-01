-- Fix sub-cue timer function overloading issues
-- Drop all conflicting functions and recreate with consistent parameter types

-- Drop all existing sub-cue timer functions to resolve conflicts
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(TEXT, INTEGER, TEXT, INTEGER);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(UUID, INTEGER, TEXT, INTEGER);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(UUID, TEXT, TEXT, INTEGER);

DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(TEXT);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(TEXT, INTEGER);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(UUID);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(UUID, INTEGER);

-- Recreate start_sub_cue_timer_for_event with consistent TEXT parameters
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(
    p_event_id TEXT,
    p_item_id TEXT,
    p_user_id TEXT,
    p_duration_seconds INTEGER
)
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
    timer_state TEXT
) AS $$
DECLARE
    v_user_name TEXT;
    v_user_role TEXT;
    v_timer_id UUID;
BEGIN
    -- Get user name and role
    SELECT name, role INTO v_user_name, v_user_role
    FROM user_profiles 
    WHERE id = p_user_id;
    
    -- Insert new sub-cue timer
    INSERT INTO sub_cue_timers (
        event_id, 
        item_id, 
        user_id, 
        user_name, 
        user_role, 
        started_at, 
        duration_seconds, 
        is_running, 
        is_active, 
        timer_state
    ) VALUES (
        p_event_id, 
        p_item_id, 
        p_user_id, 
        COALESCE(v_user_name, 'Unknown User'), 
        COALESCE(v_user_role, 'Unknown Role'), 
        NOW(), 
        p_duration_seconds, 
        true, 
        true, 
        'running'
    ) RETURNING id INTO v_timer_id;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, 
        item_id, 
        user_id, 
        user_name, 
        user_role, 
        action_type, 
        action_timestamp
    ) VALUES (
        p_event_id, 
        p_item_id, 
        p_user_id, 
        COALESCE(v_user_name, 'Unknown User'), 
        COALESCE(v_user_role, 'Unknown Role'), 
        'START_SECONDARY_TIMER', 
        NOW()
    );
    
    -- Return the created timer
    RETURN QUERY
    SELECT 
        sct.id,
        sct.event_id,
        sct.item_id,
        sct.user_id,
        sct.user_name,
        sct.user_role,
        sct.started_at,
        sct.duration_seconds,
        sct.is_running,
        sct.is_active,
        sct.timer_state
    FROM sub_cue_timers sct
    WHERE sct.id = v_timer_id;
END;
$$ LANGUAGE plpgsql;

-- Recreate stop_sub_cue_timer_for_event with consistent TEXT parameters
CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(
    p_event_id TEXT,
    p_item_id TEXT DEFAULT NULL
)
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
    timer_state TEXT
) AS $$
DECLARE
    v_user_name TEXT;
    v_user_role TEXT;
BEGIN
    -- Get user name and role from the timer being stopped
    SELECT user_name, user_role INTO v_user_name, v_user_role
    FROM sub_cue_timers 
    WHERE event_id = p_event_id 
    AND (p_item_id IS NULL OR item_id = p_item_id)
    AND is_active = true
    LIMIT 1;
    
    -- Stop the timer(s)
    UPDATE sub_cue_timers 
    SET 
        is_running = false,
        is_active = false,
        timer_state = 'stopped'
    WHERE event_id = p_event_id 
    AND (p_item_id IS NULL OR item_id = p_item_id)
    AND is_active = true;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, 
        item_id, 
        user_id, 
        user_name, 
        user_role, 
        action_type, 
        action_timestamp
    ) VALUES (
        p_event_id, 
        p_item_id, 
        'system', 
        COALESCE(v_user_name, 'System'), 
        COALESCE(v_user_role, 'System'), 
        'STOP_SECONDARY_TIMER', 
        NOW()
    );
    
    -- Return the stopped timer(s)
    RETURN QUERY
    SELECT 
        sct.id,
        sct.event_id,
        sct.item_id,
        sct.user_id,
        sct.user_name,
        sct.user_role,
        sct.started_at,
        sct.duration_seconds,
        sct.is_running,
        sct.is_active,
        sct.timer_state
    FROM sub_cue_timers sct
    WHERE sct.event_id = p_event_id 
    AND (p_item_id IS NULL OR sct.item_id = p_item_id)
    AND sct.is_active = false;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
