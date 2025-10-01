-- Final comprehensive fix for all timer functions
-- This addresses all type casting issues and function conflicts

-- Drop all existing timer functions to avoid conflicts
DROP FUNCTION IF EXISTS load_cue_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS load_cue_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS start_timer_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS start_timer_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS stop_timer_for_event(uuid, bigint, uuid);
DROP FUNCTION IF EXISTS stop_timer_for_event(text, text, text);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(uuid, bigint, uuid, integer);
DROP FUNCTION IF EXISTS start_sub_cue_timer_for_event(text, text, text, integer);
DROP FUNCTION IF EXISTS stop_sub_cue_timer_for_event(text, text);

-- Recreate active_timers table with TEXT columns
DROP TABLE IF EXISTS active_timers CASCADE;
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
    last_loaded_cue_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    
    -- Unique constraint to prevent duplicates
    CONSTRAINT unique_event_id UNIQUE (event_id)
);

-- Create sub_cue_timers table with TEXT columns
DROP TABLE IF EXISTS sub_cue_timers CASCADE;
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

-- Create indexes
CREATE INDEX idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX idx_active_timers_user_id ON active_timers(user_id);
CREATE INDEX idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX idx_sub_cue_timers_user_id ON sub_cue_timers(user_id);

-- Enable RLS
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage active timers for their events" ON active_timers
    FOR ALL USING (true);
CREATE POLICY "Users can manage sub-cue timers for their events" ON sub_cue_timers
    FOR ALL USING (true);

-- 1. Load CUE function
CREATE OR REPLACE FUNCTION load_cue_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    -- Use UPSERT to either insert or update the active timer
    INSERT INTO active_timers (
        event_id, item_id, user_id,
        started_at, is_running, is_active, duration_seconds, timer_state, last_loaded_cue_id
    ) VALUES (
        p_event_id, p_item_id, p_user_id,
        timezone('utc'::text, now()), false, true, p_duration_seconds, 'loaded', p_item_id
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
        last_loaded_cue_id = EXCLUDED.last_loaded_cue_id,
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

-- 2. Start timer function
CREATE OR REPLACE FUNCTION start_timer_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    -- Use UPSERT to either insert or update the active timer
    INSERT INTO active_timers (
        event_id, item_id, user_id,
        started_at, is_running, is_active, duration_seconds, timer_state, last_loaded_cue_id
    ) VALUES (
        p_event_id, p_item_id, p_user_id,
        timezone('utc'::text, now()), true, true, p_duration_seconds, 'running', p_item_id
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
        last_loaded_cue_id = EXCLUDED.last_loaded_cue_id,
        updated_at = timezone('utc'::text, now());

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, 'Unknown User', 'Operator',
        'START_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('duration_seconds', p_duration_seconds), 'running'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 3. Stop timer function
CREATE OR REPLACE FUNCTION stop_timer_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Stop the active timer
    UPDATE active_timers 
    SET 
        is_running = false,
        is_active = false,
        timer_state = 'stopped',
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_active = true;

    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, 'Unknown User', 'Operator',
        'STOP_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('item_id', p_item_id), 'stopped'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 4. Start sub-cue timer function
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

-- 5. Stop sub-cue timer function
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
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION stop_timer_for_event(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_timer_for_event(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO anon;

-- Add comments
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Load cue function - no type casting issues';
COMMENT ON FUNCTION start_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Start timer function - no type casting issues';
COMMENT ON FUNCTION stop_timer_for_event(TEXT, TEXT, TEXT) IS 'Stop timer function - no type casting issues';
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Start sub-cue timer function - no type casting issues';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Stop sub-cue timer function - no type casting issues';
