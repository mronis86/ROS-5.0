-- Fix start_timer_for_event function to remove timer_actions table references
-- This function should only work with active_timers table

-- Drop the existing function
DROP FUNCTION IF EXISTS start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);

-- Create the fixed function without timer_actions
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

    -- Return true if at least one row was updated
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) TO anon;

-- Add comment
COMMENT ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) IS 'Start timer function - works with active_timers table only, no timer_actions';
