-- Simple fix for sub-cue timer functions
-- This addresses the uuid = text type casting issues

-- Drop existing sub-cue functions
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(text, text);

-- Create simple start_sub_cue_timer_for_event function
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    timer_id UUID;
BEGIN
    -- Stop any existing sub-cue timers for this event
    UPDATE sub_cue_timers 
    SET 
        is_running = false,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_running = true;
    
    -- Create new sub-cue timer
    INSERT INTO sub_cue_timers (
        event_id, item_id, sub_cue_id, 
        user_id,
        started_at, is_running, is_active, duration_seconds
    ) VALUES (
        p_event_id, p_item_id, p_item_id,
        p_user_id,
        timezone('utc'::text, now()), true, true, p_duration_seconds
    ) RETURNING id INTO timer_id;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, 'Unknown User', 'Operator',
        'START_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'running'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create simple stop_sub_cue_timer_for_event function
CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(p_event_id TEXT, p_item_id TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    stopped_count INTEGER;
BEGIN
    -- Stop sub-cue timers for the event
    UPDATE sub_cue_timers 
    SET 
        is_running = false,
        is_active = false,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id 
      AND (p_item_id IS NULL OR item_id = p_item_id)
      AND is_active = true
    RETURNING 1 INTO stopped_count;

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, auth.uid(), 'Unknown User', 'Operator',
        'STOP_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'stopped'
    );

    RETURN COALESCE(stopped_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO anon;

-- Add comments
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Simple sub-cue timer start function - no type casting issues';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Simple sub-cue timer stop function - no type casting issues';
