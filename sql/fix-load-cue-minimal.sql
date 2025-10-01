-- Minimal fix for load_cue_for_event - treat everything as TEXT
-- This should work regardless of your actual column types

-- Drop existing function
DROP FUNCTION IF EXISTS load_cue_for_event(text, text, text, integer);

-- Create minimal function that treats all IDs as TEXT
CREATE OR REPLACE FUNCTION load_cue_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    -- Use UPSERT to either insert or update the active timer
    -- Treat all IDs as TEXT to avoid type casting issues
    INSERT INTO active_timers (
        event_id, item_id, user_id,
        started_at, is_running, is_active, duration_seconds, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id,
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
        p_event_id, p_item_id, p_user_id,
        'LOAD_CUE', timezone('utc'::text, now()), 
        jsonb_build_object('duration_seconds', p_duration_seconds), 'loaded'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;

-- Add comment
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Minimal load_cue_for_event function - treats all IDs as TEXT';
