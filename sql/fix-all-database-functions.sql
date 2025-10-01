-- Comprehensive fix for all database function issues
-- This script addresses all the errors we've encountered

-- Drop all existing functions to start clean
DROP FUNCTION IF EXISTS load_cue_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS load_cue_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(text, text);

-- Create load_cue_for_event function with proper type casting
CREATE OR REPLACE FUNCTION load_cue_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_name TEXT := 'Unknown User';
    v_user_role TEXT := 'Operator';
    existing_timer RECORD;
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

    -- Check if there's already an active timer for this event
    SELECT * INTO existing_timer
    FROM active_timers 
    WHERE event_id = p_event_id::uuid;

    -- Use UPSERT to either insert or update the active timer
    INSERT INTO active_timers (
        event_id, item_id, user_id,
        started_at, is_running, is_active, duration_seconds, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_user_id::uuid,
        timezone('utc'::text, now()), false, true, p_duration_seconds, 'loaded'
    )
    ON CONFLICT (event_id) 
    DO UPDATE SET
        item_id = EXCLUDED.item_id,
        user_id = EXCLUDED.user_id,
        started_at = EXCLUDED.started_at,
        is_running = EXCLUDED.is_running,
        is_active = EXCLUDED.is_active,
        duration_seconds = EXCLUDED.duration_seconds,
        timer_state = EXCLUDED.timer_state,
        updated_at = timezone('utc'::text, now());

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_user_id::uuid,
        'LOAD_CUE', timezone('utc'::text, now()), 
        jsonb_build_object('duration_seconds', p_duration_seconds), 'loaded'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create start_sub_cue_timer_for_event function with proper type casting
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
    WHERE event_id = p_event_id::uuid AND is_running = true;
    
    -- Create new sub-cue timer
    INSERT INTO sub_cue_timers (
        event_id, item_id, sub_cue_id, 
        user_id,
        started_at, is_running, is_active, duration_seconds
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_item_id::bigint,
        p_user_id::uuid,
        timezone('utc'::text, now()), true, true, p_duration_seconds
    ) RETURNING id INTO timer_id;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_user_id::uuid,
        'START_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'running'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create stop_sub_cue_timer_for_event function with proper type casting
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
        event_id, item_id, user_id,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, auth.uid(),
        'STOP_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'stopped'
    );

    RETURN COALESCE(stopped_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO anon;

-- Add comments for documentation
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Loads a cue for an event using UPSERT to handle duplicate key constraints';
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Starts a sub-cue timer for an event';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Stops sub-cue timers for an event';
