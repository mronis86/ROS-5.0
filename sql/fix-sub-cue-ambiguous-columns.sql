-- Fix ambiguous column reference error in start_sub_cue_timer_for_event function
-- This addresses the 42702 error: "column reference 'user_role' is ambiguous"

-- Drop existing functions to resolve conflicts
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(text, text);

-- Recreate the functions with explicit variable qualification
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    timer_id UUID;
    v_user_name TEXT := 'Unknown User';
    v_user_role TEXT := 'Operator';
BEGIN
    -- Get user info from user_sessions table
    SELECT 
        COALESCE(us.username, 'Unknown User'),
        COALESCE(us.user_role, 'Operator')
    INTO v_user_name, v_user_role
    FROM user_sessions us
    WHERE us.user_id = p_user_id AND us.event_id = p_event_id
    ORDER BY us.created_at DESC
    LIMIT 1;
    
    -- Use defaults if no session found
    IF v_user_name IS NULL THEN
        v_user_name := 'Unknown User';
        v_user_role := 'Operator';
    END IF;
    
    -- Stop any existing sub-cue timers for this event
    UPDATE sub_cue_timers 
    SET 
        is_running = false,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_running = true;
    
    -- Create new sub-cue timer
    INSERT INTO sub_cue_timers (
        event_id, item_id, sub_cue_id, 
        user_id, user_name, user_role, 
        started_at, is_running, is_active, duration_seconds
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_item_id::bigint,
        p_user_id::uuid, v_user_name, v_user_role, -- Use qualified local variables
        timezone('utc'::text, now()), true, true, p_duration_seconds
    ) RETURNING id INTO timer_id;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_user_id::uuid, v_user_name, v_user_role, -- Use qualified local variables
        'START_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'running'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(p_event_id TEXT, p_item_id TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    stopped_count INTEGER;
    v_user_name TEXT := 'Unknown User';
    v_user_role TEXT := 'Operator';
BEGIN
    -- Get user info from user_sessions table
    SELECT 
        COALESCE(us.username, 'Unknown User'),
        COALESCE(us.user_role, 'Operator')
    INTO v_user_name, v_user_role
    FROM user_sessions us
    WHERE us.user_id = auth.uid() AND us.event_id = p_event_id
    ORDER BY us.created_at DESC
    LIMIT 1;

    -- Use defaults if no session found
    IF v_user_name IS NULL THEN
        v_user_name := 'Unknown User';
        v_user_role := 'Operator';
    END IF;

    -- Stop sub-cue timers for the event
    UPDATE sub_cue_timers 
    SET 
        is_running = false,
        is_active = false,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id::uuid 
      AND (p_item_id IS NULL OR item_id = p_item_id::bigint)
      AND is_active = true
    RETURNING 1 INTO stopped_count;

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, auth.uid(), v_user_name, v_user_role, -- Use qualified local variables
        'STOP_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'stopped'
    );

    RETURN COALESCE(stopped_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO anon;

-- Add comments for documentation
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Starts a sub-cue timer for an event';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Stops sub-cue timers for an event';
