-- Fix sub_cue_timers table and functions to add row_is, cue_is, timer_id columns
-- and remove timer_actions table references

-- First, add the missing columns to sub_cue_timers table
ALTER TABLE sub_cue_timers
ADD COLUMN IF NOT EXISTS row_is INTEGER,
ADD COLUMN IF NOT EXISTS cue_is TEXT,
ADD COLUMN IF NOT EXISTS timer_id TEXT,
ADD COLUMN IF NOT EXISTS remaining_seconds INTEGER;

-- Add unique constraint for UPSERT functionality (one row per event_id + item_id)
-- Note: Drop existing constraint first if it exists, then add new one
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'sub_cue_timers_event_item_unique'
        AND table_name = 'sub_cue_timers'
    ) THEN
        ALTER TABLE sub_cue_timers DROP CONSTRAINT sub_cue_timers_event_item_unique;
    END IF;
END $$;

ALTER TABLE sub_cue_timers
ADD CONSTRAINT sub_cue_timers_event_item_unique 
UNIQUE (event_id, item_id);

-- Add comments for the new columns
COMMENT ON COLUMN sub_cue_timers.row_is IS 'Row number in the schedule for this sub-cue';
COMMENT ON COLUMN sub_cue_timers.cue_is IS 'Formatted cue display text (e.g., CUE 1, CUE 2)';
COMMENT ON COLUMN sub_cue_timers.timer_id IS 'Unique timer identifier for this sub-cue session';
COMMENT ON COLUMN sub_cue_timers.remaining_seconds IS 'Remaining time in seconds for this sub-cue timer';

-- Drop existing sub-cue timer functions
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(TEXT, TEXT);
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(TEXT);

-- Create fixed start_sub_cue_timer_for_event function
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(
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
    -- First, DELETE ALL existing sub-cue timers for this event
    DELETE FROM sub_cue_timers 
    WHERE event_id = p_event_id;

    -- Then insert the new sub-cue timer
    INSERT INTO sub_cue_timers (
        event_id, item_id, user_id,
        duration_seconds, remaining_seconds, is_active, is_running,
        started_at, row_is, cue_is, timer_id, sub_cue_id,
        created_at, updated_at
    ) VALUES (
        p_event_id, p_item_id, p_user_id,
        p_duration_seconds, p_duration_seconds, true, true,
        timezone('utc'::text, now()), p_row_is, p_cue_is, p_timer_id, p_item_id,
        timezone('utc'::text, now()), timezone('utc'::text, now())
    );

    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Create fixed stop_sub_cue_timer_for_event function
CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(
    p_event_id TEXT,
    p_item_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Delete sub-cue timer(s) completely instead of just marking as inactive
    DELETE FROM sub_cue_timers 
    WHERE event_id = p_event_id 
    AND (p_item_id IS NULL OR item_id = p_item_id);

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create fixed get_active_sub_cue_timers_for_event function
CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(
    p_event_id TEXT
)
RETURNS SETOF sub_cue_timers AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM sub_cue_timers st
    WHERE st.event_id = p_event_id 
    AND st.is_active = true
    ORDER BY st.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO anon;

GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO anon;

GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO anon;

-- Add comments
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) IS 'Start sub-cue timer function - works with sub_cue_timers table only, no timer_actions';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Stop sub-cue timer function - works with sub_cue_timers table only, no timer_actions';
COMMENT ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) IS 'Get active sub-cue timers function - works with sub_cue_timers table only, no timer_actions';
