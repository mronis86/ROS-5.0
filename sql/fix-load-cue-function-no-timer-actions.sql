-- Fix load_cue_for_event function to remove timer_actions table references
-- This function should only work with active_timers table

-- Drop the existing function
DROP FUNCTION IF EXISTS load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT);

-- Create the fixed function without timer_actions
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
        row_is, cue_is, timer_id,
        created_at, updated_at
    ) VALUES (
        p_event_id, p_item_id, p_user_id,
        timezone('utc'::text, now()), false, true, p_duration_seconds, 'loaded',
        p_row_is, p_cue_is, p_timer_id,
        timezone('utc'::text, now()), timezone('utc'::text, now())
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

    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) IS 'Load cue function - works with active_timers table only, no timer_actions';
