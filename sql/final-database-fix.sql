-- FINAL DATABASE FIX - Remove all conflicts and create clean functions
-- This script removes ALL existing timer functions and recreates them cleanly

-- Drop ALL existing timer functions to remove conflicts
DROP FUNCTION IF EXISTS load_cue_for_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS load_cue_for_event(UUID, BIGINT, UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS stop_timer_for_event(TEXT) CASCADE;
DROP FUNCTION IF EXISTS stop_timer_for_event(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_active_timer_for_event(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_active_timer_for_event(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_active_sub_cue_timers_for_event(UUID) CASCADE;
DROP FUNCTION IF EXISTS has_active_sub_cue_timer_for_event(TEXT) CASCADE;
DROP FUNCTION IF EXISTS has_active_sub_cue_timer_for_event(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_recent_timer_actions(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_recent_timer_actions(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_last_loaded_cue(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_last_loaded_cue(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_completed_cues_for_event(TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_completed_cues_for_event(UUID) CASCADE;
DROP FUNCTION IF EXISTS clear_completed_cues_for_event(TEXT) CASCADE;
DROP FUNCTION IF EXISTS clear_completed_cues_for_event(UUID) CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_timer_actions() CASCADE;
DROP FUNCTION IF EXISTS expire_completed_sub_cue_timers() CASCADE;
DROP FUNCTION IF EXISTS update_last_loaded_cue(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS update_last_loaded_cue(TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS update_last_loaded_cue(UUID, TEXT) CASCADE;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS timer_actions CASCADE;
DROP TABLE IF EXISTS sub_cue_timers CASCADE;
DROP TABLE IF EXISTS completed_cues CASCADE;
DROP TABLE IF EXISTS active_timers CASCADE;

-- Add missing columns to calendar_events table if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_events') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'last_loaded_cue_id') THEN
            ALTER TABLE calendar_events ADD COLUMN last_loaded_cue_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'last_loaded_cue_state') THEN
            ALTER TABLE calendar_events ADD COLUMN last_loaded_cue_state TEXT;
        END IF;
    END IF;
END $$;

-- Create active_timers table with all required columns
CREATE TABLE active_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event and item identification
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    
    -- User information
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    
    -- Timer state
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_loaded_cue_id TEXT,
    is_running BOOLEAN DEFAULT true NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    timer_state TEXT DEFAULT 'idle'
);

-- Create sub_cue_timers table with all required columns
CREATE TABLE sub_cue_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event and item identification
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    sub_cue_id TEXT NOT NULL,
    
    -- User information
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    
    -- Timer state
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_running BOOLEAN DEFAULT true NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    duration_seconds INTEGER DEFAULT 0
);

-- Create completed_cues table with all required columns
CREATE TABLE completed_cues (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event and cue identification
    event_id TEXT NOT NULL,
    cue_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    
    -- User information
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    
    -- Completion info
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Create timer_actions table with all required columns
CREATE TABLE timer_actions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event and item identification
    event_id TEXT NOT NULL,
    item_id TEXT,
    
    -- User information
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    
    -- Action details
    action_type TEXT NOT NULL,
    action_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    duration_seconds INTEGER DEFAULT 0,
    timer_state TEXT DEFAULT 'idle'
);

-- Create indexes for better performance
CREATE INDEX idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX idx_active_timers_item_id ON active_timers(item_id);
CREATE INDEX idx_active_timers_is_running ON active_timers(is_running);
CREATE INDEX idx_active_timers_is_active ON active_timers(is_active);
CREATE INDEX idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX idx_sub_cue_timers_item_id ON sub_cue_timers(item_id);
CREATE INDEX idx_sub_cue_timers_is_running ON sub_cue_timers(is_running);
CREATE INDEX idx_completed_cues_event_id ON completed_cues(event_id);
CREATE INDEX idx_completed_cues_cue_id ON completed_cues(cue_id);
CREATE INDEX idx_timer_actions_event_id ON timer_actions(event_id);
CREATE INDEX idx_timer_actions_item_id ON timer_actions(item_id);
CREATE INDEX idx_timer_actions_action_timestamp ON timer_actions(action_timestamp);

-- Create all functions with TEXT parameters only
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    is_running BOOLEAN,
    is_active BOOLEAN,
    timer_state TEXT,
    last_loaded_cue_id TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        at.id,
        at.event_id,
        at.item_id,
        at.user_id,
        at.user_name,
        at.user_role,
        at.started_at,
        at.duration_seconds,
        at.is_running,
        at.is_active,
        at.timer_state,
        at.last_loaded_cue_id
    FROM active_timers at
    WHERE at.event_id = p_event_id AND (at.is_running = true OR at.timer_state = 'loaded');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    sub_cue_id TEXT,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    is_running BOOLEAN,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sct.id,
        sct.event_id,
        sct.item_id,
        sct.sub_cue_id,
        sct.user_id,
        sct.user_name,
        sct.user_role,
        sct.started_at,
        sct.duration_seconds,
        sct.is_running,
        sct.is_active
    FROM sub_cue_timers sct
    WHERE sct.event_id = p_event_id AND sct.is_running = true;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION has_active_sub_cue_timer_for_event(p_event_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM sub_cue_timers
        WHERE event_id = p_event_id AND is_running = true
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_recent_timer_actions(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    action_type TEXT,
    action_timestamp TIMESTAMP WITH TIME ZONE,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT,
    timer_state TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ta.id,
        ta.event_id,
        ta.item_id,
        ta.action_type,
        ta.action_timestamp,
        ta.user_id,
        ta.user_name,
        ta.user_role,
        ta.timer_state
    FROM timer_actions ta
    WHERE ta.event_id = p_event_id
    ORDER BY ta.action_timestamp DESC
    LIMIT 100;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_last_loaded_cue(p_event_id TEXT)
RETURNS TABLE (
    id TEXT,
    segment_name TEXT,
    start_time TEXT,
    end_time TEXT,
    duration_ms INTEGER,
    speakers TEXT,
    notes TEXT,
    assets JSONB,
    participants JSONB,
    custom_fields JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        at.last_loaded_cue_id AS id,
        at.last_loaded_cue_id AS segment_name,
        at.started_at::TEXT AS start_time,
        (at.started_at + INTERVAL '1 second' * at.duration_seconds)::TEXT AS end_time,
        at.duration_seconds * 1000 AS duration_ms,
        ''::TEXT AS speakers,
        ''::TEXT AS notes,
        '{}'::JSONB AS assets,
        '{}'::JSONB AS participants,
        '{}'::JSONB AS custom_fields
    FROM active_timers at
    WHERE at.event_id = p_event_id AND at.is_running = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_completed_cues_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    cue_id TEXT,
    item_id TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    user_id TEXT,
    user_name TEXT,
    user_role TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cc.id,
        cc.event_id,
        cc.cue_id,
        cc.item_id,
        cc.completed_at,
        cc.user_id,
        cc.user_name,
        cc.user_role
    FROM completed_cues cc
    WHERE cc.event_id = p_event_id
    ORDER BY cc.completed_at DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION clear_completed_cues_for_event(p_event_id TEXT)
RETURNS VOID AS $$
BEGIN
    DELETE FROM completed_cues
    WHERE event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_timer_actions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM timer_actions
    WHERE action_timestamp < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION expire_completed_sub_cue_timers()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE sub_cue_timers 
    SET is_running = false, updated_at = timezone('utc'::text, now())
    WHERE is_running = true 
    AND started_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Create the function that matches what the app is calling (4 parameters)
CREATE OR REPLACE FUNCTION load_cue_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    timer_exists BOOLEAN;
    timer_id UUID;
    user_name TEXT := 'Unknown User';
    user_role TEXT := 'Operator';
BEGIN
    -- Check if there's already an active timer for this event
    SELECT EXISTS(
        SELECT 1 FROM active_timers 
        WHERE event_id = p_event_id AND is_running = true
    ) INTO timer_exists;
    
    IF timer_exists THEN
        -- Update existing timer
        UPDATE active_timers 
        SET 
            item_id = p_item_id,
            last_loaded_cue_id = p_item_id,
            user_id = p_user_id,
            user_name = user_name,
            user_role = user_role,
            started_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now()),
            timer_state = 'loaded',
            duration_seconds = p_duration_seconds
        WHERE event_id = p_event_id AND is_running = true
        RETURNING id INTO timer_id;
    ELSE
        -- Create new timer
        INSERT INTO active_timers (
            event_id, item_id, last_loaded_cue_id, 
            user_id, user_name, user_role, 
            started_at, is_running, is_active, timer_state, duration_seconds
        ) VALUES (
            p_event_id, p_item_id, p_item_id,
            p_user_id, user_name, user_role,
            timezone('utc'::text, now()), true, true, 'loaded', p_duration_seconds
        ) RETURNING id INTO timer_id;
    END IF;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, user_name, user_role,
        'LOAD_CUE', timezone('utc'::text, now()), 
        jsonb_build_object('cue_id', p_item_id), 'loaded'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_last_loaded_cue(p_event_id TEXT, p_cue_id TEXT, p_cue_state TEXT DEFAULT 'loaded')
RETURNS BOOLEAN AS $$
BEGIN
    -- Update the last loaded cue for the event in active_timers
    UPDATE active_timers 
    SET 
        last_loaded_cue_id = p_cue_id,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_running = true;
    
    -- Also update calendar_events if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_events') THEN
        UPDATE calendar_events 
        SET 
            last_loaded_cue_id = p_cue_id,
            last_loaded_cue_state = p_cue_state,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_event_id;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stop_timer_for_event(p_event_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    stopped_count INTEGER;
BEGIN
    -- Stop all active timers for the event
    UPDATE active_timers 
    SET 
        is_running = false,
        is_active = false,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_running = true;
    
    GET DIAGNOSTICS stopped_count = ROW_COUNT;
    
    -- Also stop sub-cue timers
    UPDATE sub_cue_timers 
    SET 
        is_running = false,
        updated_at = timezone('utc'::text, now())
    WHERE event_id = p_event_id AND is_running = true;
    
    RETURN stopped_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(p_event_id TEXT, p_item_id TEXT, p_user_id TEXT, p_duration_seconds INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    timer_id UUID;
    user_name TEXT := 'Unknown User';
    user_role TEXT := 'Operator';
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
        user_id, user_name, user_role, 
        started_at, is_running, is_active, duration_seconds
    ) VALUES (
        p_event_id, p_item_id, p_item_id,
        p_user_id, user_name, user_role,
        timezone('utc'::text, now()), true, true, p_duration_seconds
    ) RETURNING id INTO timer_id;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, user_name, user_role,
        'START_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', p_item_id), 'running'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

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
    AND is_running = true;
    
    GET DIAGNOSTICS stopped_count = ROW_COUNT;
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, COALESCE(p_item_id, 'all'), 'system', 'System', 'System',
        'STOP_SECONDARY_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('sub_cue_id', COALESCE(p_item_id, 'all')), 'stopped'
    );
    
    RETURN stopped_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_cue_completed(p_event_id TEXT, p_item_id TEXT, p_cue_id TEXT, p_user_id TEXT, p_user_name TEXT, p_user_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Insert completed cue record
    INSERT INTO completed_cues (
        event_id, item_id, cue_id, user_id, user_name, user_role, completed_at
    ) VALUES (
        p_event_id, p_item_id, p_cue_id, p_user_id, p_user_name, p_user_role, timezone('utc'::text, now())
    );
    
    -- Log the action
    INSERT INTO timer_actions (
        event_id, item_id, user_id, user_name, user_role,
        action_type, action_timestamp, details, timer_state
    ) VALUES (
        p_event_id, p_item_id, p_user_id, p_user_name, p_user_role,
        'STOP_TIMER', timezone('utc'::text, now()), 
        jsonb_build_object('cue_id', p_cue_id), 'completed'
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on all functions
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_recent_timer_actions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_timer_actions(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_last_loaded_cue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_last_loaded_cue(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_completed_cues_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_completed_cues_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION clear_completed_cues_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_completed_cues_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION cleanup_old_timer_actions() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_timer_actions() TO anon;
GRANT EXECUTE ON FUNCTION expire_completed_sub_cue_timers() TO authenticated;
GRANT EXECUTE ON FUNCTION expire_completed_sub_cue_timers() TO anon;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION update_last_loaded_cue(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_last_loaded_cue(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION stop_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION mark_cue_completed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_cue_completed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

-- Add comments
COMMENT ON TABLE active_timers IS 'Stores active timer sessions for run of show items';
COMMENT ON TABLE sub_cue_timers IS 'Stores active sub-cue timer sessions';
COMMENT ON TABLE completed_cues IS 'Stores completed cue records';
COMMENT ON TABLE timer_actions IS 'Stores timer action history';

COMMENT ON FUNCTION get_active_timer_for_event(TEXT) IS 'Returns active timer for an event';
COMMENT ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) IS 'Returns active sub-cue timers for an event';
COMMENT ON FUNCTION has_active_sub_cue_timer_for_event(TEXT) IS 'Checks if there is an active sub-cue timer for an event';
COMMENT ON FUNCTION get_recent_timer_actions(TEXT) IS 'Returns recent timer actions for an event';
COMMENT ON FUNCTION get_last_loaded_cue(TEXT) IS 'Returns the last loaded cue for an event';
COMMENT ON FUNCTION get_completed_cues_for_event(TEXT) IS 'Returns completed cues for an event';
COMMENT ON FUNCTION clear_completed_cues_for_event(TEXT) IS 'Clears all completed cues for an event';
COMMENT ON FUNCTION cleanup_old_timer_actions() IS 'Removes timer actions older than 7 days';
COMMENT ON FUNCTION expire_completed_sub_cue_timers() IS 'Expires sub-cue timers that have been running for more than 24 hours';
COMMENT ON FUNCTION load_cue_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Loads a cue for an event and creates/updates active timer';
COMMENT ON FUNCTION stop_timer_for_event(TEXT) IS 'Stops all active timers for an event';
COMMENT ON FUNCTION start_sub_cue_timer_for_event(TEXT, TEXT, TEXT, INTEGER) IS 'Starts a sub-cue timer for an event';
COMMENT ON FUNCTION stop_sub_cue_timer_for_event(TEXT, TEXT) IS 'Stops sub-cue timers for an event';
COMMENT ON FUNCTION update_last_loaded_cue(TEXT, TEXT, TEXT) IS 'Updates the last loaded cue for an event';
COMMENT ON FUNCTION mark_cue_completed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS 'Marks a cue as completed and logs the action';

-- Enable Row Level Security
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE completed_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_actions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow all operations for authenticated users" ON active_timers FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON sub_cue_timers FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON completed_cues FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow all operations for authenticated users" ON timer_actions FOR ALL TO authenticated USING (true);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_active_timers_updated_at BEFORE UPDATE ON active_timers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sub_cue_timers_updated_at BEFORE UPDATE ON sub_cue_timers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_completed_cues_updated_at BEFORE UPDATE ON completed_cues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_timer_actions_updated_at BEFORE UPDATE ON timer_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
