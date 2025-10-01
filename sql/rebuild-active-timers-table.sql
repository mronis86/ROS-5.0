-- Rebuild active_timers table with correct structure
-- This will fix all the type casting issues once and for all

-- Drop existing table and functions
DROP TABLE IF EXISTS active_timers CASCADE;
DROP FUNCTION IF EXISTS load_cue_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS load_cue_for_event(text, text, text, integer);

-- Create active_timers table with TEXT columns
CREATE TABLE active_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    is_running BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    duration_seconds INTEGER NOT NULL,
    timer_state TEXT NOT NULL DEFAULT 'loaded',
    last_loaded_cue_id TEXT, -- Add missing column
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    
    -- Unique constraint to prevent duplicates
    CONSTRAINT unique_event_id UNIQUE (event_id)
);

-- Create index for performance
CREATE INDEX idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX idx_active_timers_user_id ON active_timers(user_id);

-- Enable RLS
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Users can manage active timers for their events" ON active_timers
    FOR ALL USING (true);

-- Create simple load_cue_for_event function
CREATE OR REPLACE FUNCTION load_cue_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    -- Use UPSERT to either insert or update the active timer
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
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, 'Unknown User', 'Operator',
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
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Simple load_cue_for_event function - no type casting issues';
