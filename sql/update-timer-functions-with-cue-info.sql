-- Update timer functions to use row_is and cue_is columns
-- This script updates the existing functions to populate the new columns

-- Update load_cue_for_event function to accept and use row_is, cue_is, and timer_id parameters
CREATE OR REPLACE FUNCTION load_cue_for_event(
    p_event_id TEXT, 
    p_item_id TEXT, 
    p_user_id TEXT, 
    p_duration_seconds INTEGER,
    p_row_is INTEGER DEFAULT NULL,
    p_cue_is TEXT DEFAULT NULL,
    p_timer_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Use UPSERT to either insert or update the active timer
    INSERT INTO active_timers (
        event_id, item_id, user_id,
        started_at, is_running, is_active, duration_seconds, timer_state,
        row_is, cue_is, timer_id
    ) VALUES (
        p_event_id, p_item_id, p_user_id,
        timezone('utc'::text, now()), false, true, p_duration_seconds, 'loaded',
        p_row_is, p_cue_is, p_timer_id
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
        row_is = EXCLUDED.row_is,
        cue_is = EXCLUDED.cue_is,
        timer_id = EXCLUDED.timer_id,
        updated_at = timezone('utc'::text, now());

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, 'Unknown User', 'Operator',
        'LOAD_CUE', timezone('utc'::text, now()), 
        jsonb_build_object(
            'duration_seconds', p_duration_seconds,
            'row_is', p_row_is,
            'cue_is', p_cue_is,
            'timer_id', p_timer_id
        ), 'loaded'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update start_timer_for_event function to accept and use row_is, cue_is, and timer_id parameters
CREATE OR REPLACE FUNCTION start_timer_for_event(
    p_event_id TEXT, 
    p_item_id TEXT, 
    p_user_id TEXT,
    p_row_is INTEGER DEFAULT NULL,
    p_cue_is TEXT DEFAULT NULL,
    p_timer_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update the active timer to running state
    UPDATE active_timers 
    SET 
        is_running = true,
        timer_state = 'running',
        started_at = timezone('utc'::text, now()),
        row_is = COALESCE(p_row_is, row_is),
        cue_is = COALESCE(p_cue_is, cue_is),
        timer_id = COALESCE(p_timer_id, timer_id),
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_active = true;

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, 'Unknown User', 'Operator',
        'START_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object(
            'row_is', p_row_is,
            'cue_is', p_cue_is,
            'timer_id', p_timer_id
        ), 'running'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon;

-- Add comments
COMMENT ON COLUMN active_timers.row_is IS 'Row number in the schedule for this cue';
COMMENT ON COLUMN active_timers.cue_is IS 'Formatted cue display text (e.g., CUE 1, CUE 2)';
COMMENT ON COLUMN active_timers.timer_id IS 'Unique timer identifier for this cue session';
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) IS 'Load cue function with row_is, cue_is, and timer_id info';
COMMENT ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) IS 'Start timer function with row_is, cue_is, and timer_id info';
