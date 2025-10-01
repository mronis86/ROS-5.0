-- Fix duplicate key constraint error in load_cue_for_event function
-- This addresses the 23505 error: "duplicate key value violates unique constraint 'unique_event_id'"

-- Drop and recreate the load_cue_for_event function to use UPSERT instead of INSERT
DROP FUNCTION IF EXISTS load_cue_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS load_cue_for_event(text, text, text, integer);

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
        event_id, item_id, user_id, user_name, user_role,
        started_at, is_running, is_active, duration_seconds, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_user_id::uuid, v_user_name, v_user_role,
        timezone('utc'::text, now()), false, true, p_duration_seconds, 'loaded'
    )
    ON CONFLICT (event_id) 
    DO UPDATE SET
        item_id = EXCLUDED.item_id,
        user_id = EXCLUDED.user_id,
        user_name = EXCLUDED.user_name,
        user_role = EXCLUDED.user_role,
        started_at = EXCLUDED.started_at,
        is_running = EXCLUDED.is_running,
        is_active = EXCLUDED.is_active,
        duration_seconds = EXCLUDED.duration_seconds,
        timer_state = EXCLUDED.timer_state,
        updated_at = timezone('utc'::text, now());

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id::uuid, p_item_id::bigint, p_user_id::uuid, v_user_name, v_user_role,
        'LOAD_CUE', timezone('utc'::text, now()), 
        jsonb_build_object('duration_seconds', p_duration_seconds), 'loaded'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;

-- Add comment for documentation
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Loads a cue for an event using UPSERT to handle duplicate key constraints';
