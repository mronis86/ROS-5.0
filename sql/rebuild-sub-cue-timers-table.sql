-- Rebuild sub_cue_timers table with TEXT columns
-- This fixes the uuid = text type casting issues

-- Drop existing sub_cue_timers table and functions
DROP TABLE IF EXISTS sub_cue_timers CASCADE;
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(text, text);
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(text);

-- Create sub_cue_timers table with TEXT columns
CREATE TABLE sub_cue_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    sub_cue_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    is_running BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    duration_seconds INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Create indexes for performance
CREATE INDEX idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX idx_sub_cue_timers_user_id ON sub_cue_timers(user_id);
CREATE INDEX idx_sub_cue_timers_item_id ON sub_cue_timers(item_id);

-- Enable RLS
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Users can manage sub-cue timers for their events" ON sub_cue_timers
    FOR ALL USING (true);

-- Create start_sub_cue_timer_for_event function
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

-- Create stop_sub_cue_timer_for_event function
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

-- Create get_active_sub_cue_timers_for_event function
CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    sub_cue_id TEXT,
    user_id TEXT,
    started_at TIMESTAMPTZ,
    is_running BOOLEAN,
    is_active BOOLEAN,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sct.id,
        sct.event_id,
        sct.item_id,
        sct.sub_cue_id,
        sct.user_id,
        sct.started_at,
        sct.is_running,
        sct.is_active,
        sct.duration_seconds,
        sct.created_at,
        sct.updated_at
    FROM sub_cue_timers sct
    WHERE sct.event_id = p_event_id 
      AND sct.is_active = true
    ORDER BY sct.started_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for the get function
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO anon;

-- Add comments
COMMENT ON TABLE sub_cue_timers IS 'Sub-cue timers table with TEXT columns to avoid type casting issues';
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Start sub-cue timer function - no type casting issues';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Stop sub-cue timer function - no type casting issues';
COMMENT ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) IS 'Get active sub-cue timers function - no type casting issues';
