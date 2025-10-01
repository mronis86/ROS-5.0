-- Complete Timer Schema for Run of Show Application
-- This creates all timer-related tables and functions needed by the application

-- Drop existing tables and functions if they exist
DROP TABLE IF EXISTS timer_actions CASCADE;
DROP TABLE IF EXISTS active_timers CASCADE;
DROP TABLE IF EXISTS completed_cues CASCADE;
DROP TABLE IF EXISTS sub_cue_timers CASCADE;

-- Drop existing functions
DROP FUNCTION IF EXISTS get_recent_timer_actions(UUID);
DROP FUNCTION IF EXISTS get_last_loaded_cue(UUID);
DROP FUNCTION IF EXISTS cleanup_old_timer_actions();
DROP FUNCTION IF EXISTS get_completed_cues_for_event(UUID);
DROP FUNCTION IF EXISTS clear_completed_cues_for_event(UUID);

-- Create active_timers table - ONE ROW PER EVENT
CREATE TABLE active_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    item_id TEXT,
    user_id TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT false,
    timer_state TEXT DEFAULT 'stopped' CHECK (timer_state IN ('stopped', 'running', 'paused')),
    last_loaded_cue_id TEXT -- This is the missing column that was causing errors
);

-- Create indexes for active_timers
CREATE INDEX idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX idx_active_timers_user_id ON active_timers(user_id);
CREATE INDEX idx_active_timers_is_active ON active_timers(is_active);
CREATE INDEX idx_active_timers_timer_state ON active_timers(timer_state);

-- Enable RLS for active_timers
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for active_timers
CREATE POLICY "Users can view active timers for their events" ON active_timers
    FOR SELECT USING (true);

CREATE POLICY "Users can insert active timers for their events" ON active_timers
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update active timers for their events" ON active_timers
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete active timers for their events" ON active_timers
    FOR DELETE USING (true);

-- Create timer_actions table for broadcasting timer actions across clients
CREATE TABLE timer_actions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    item_id TEXT,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('start', 'stop', 'pause', 'resume', 'reset', 'complete')),
    action_timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    timer_state TEXT DEFAULT 'stopped' CHECK (timer_state IN ('stopped', 'running', 'paused')),
    duration_seconds INTEGER DEFAULT 0,
    notes TEXT
);

-- Create indexes for timer_actions
CREATE INDEX idx_timer_actions_event_id ON timer_actions(event_id);
CREATE INDEX idx_timer_actions_timestamp ON timer_actions(action_timestamp);
CREATE INDEX idx_timer_actions_user_id ON timer_actions(user_id);

-- Enable RLS for timer_actions
ALTER TABLE timer_actions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for timer_actions
CREATE POLICY "Users can view timer actions for their events" ON timer_actions
    FOR SELECT USING (true);

CREATE POLICY "Users can insert timer actions for their events" ON timer_actions
    FOR INSERT WITH CHECK (true);

-- Create completed_cues table to track which rows have been finished
CREATE TABLE completed_cues (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    notes TEXT
);

-- Create indexes for completed_cues
CREATE INDEX idx_completed_cues_event_id ON completed_cues(event_id);
CREATE INDEX idx_completed_cues_item_id ON completed_cues(item_id);
CREATE INDEX idx_completed_cues_completed_at ON completed_cues(completed_at);

-- Enable RLS for completed_cues
ALTER TABLE completed_cues ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for completed_cues
CREATE POLICY "Users can view completed cues for their events" ON completed_cues
    FOR SELECT USING (true);

CREATE POLICY "Users can insert completed cues for their events" ON completed_cues
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update completed cues for their events" ON completed_cues
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete completed cues for their events" ON completed_cues
    FOR DELETE USING (true);

-- Create sub_cue_timers table - ONE ROW PER EVENT (like active_timers)
CREATE TABLE sub_cue_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    item_id TEXT,
    user_id TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT false,
    timer_state TEXT DEFAULT 'stopped' CHECK (timer_state IN ('stopped', 'running', 'paused'))
);

-- Create indexes for sub_cue_timers
CREATE INDEX idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX idx_sub_cue_timers_is_active ON sub_cue_timers(is_active);

-- Enable RLS for sub_cue_timers
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sub_cue_timers
CREATE POLICY "Users can view sub cue timers for their events" ON sub_cue_timers
    FOR SELECT USING (true);

CREATE POLICY "Users can insert sub cue timers for their events" ON sub_cue_timers
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update sub cue timers for their events" ON sub_cue_timers
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete sub cue timers for their events" ON sub_cue_timers
    FOR DELETE USING (true);

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_active_timers_updated_at
    BEFORE UPDATE ON active_timers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sub_cue_timers_updated_at
    BEFORE UPDATE ON sub_cue_timers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to get recent timer actions
CREATE OR REPLACE FUNCTION get_recent_timer_actions(p_event_id UUID)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    action_type TEXT,
    action_timestamp TIMESTAMP WITH TIME ZONE,
    timer_state TEXT,
    duration_seconds INTEGER,
    notes TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ta.id,
        ta.event_id,
        ta.item_id,
        ta.user_id,
        ta.action_type,
        ta.action_timestamp,
        ta.timer_state,
        ta.duration_seconds,
        ta.notes
    FROM timer_actions ta
    WHERE ta.event_id = p_event_id::TEXT
    ORDER BY ta.action_timestamp DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- Create function to get last loaded cue
CREATE OR REPLACE FUNCTION get_last_loaded_cue(p_event_id UUID)
RETURNS TABLE (
    event_id TEXT,
    last_loaded_cue_id TEXT,
    last_loaded_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        at.event_id,
        at.last_loaded_cue_id,
        at.updated_at as last_loaded_at
    FROM active_timers at
    WHERE at.event_id = p_event_id::TEXT
    AND at.last_loaded_cue_id IS NOT NULL
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create function to get completed cues for an event
CREATE OR REPLACE FUNCTION get_completed_cues_for_event(p_event_id UUID)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cc.id,
        cc.event_id,
        cc.item_id,
        cc.user_id,
        cc.completed_at,
        cc.notes
    FROM completed_cues cc
    WHERE cc.event_id = p_event_id::TEXT
    ORDER BY cc.completed_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to clear completed cues for an event
CREATE OR REPLACE FUNCTION clear_completed_cues_for_event(p_event_id UUID)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM completed_cues WHERE event_id = p_event_id::TEXT;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to cleanup old timer actions
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

-- Create function to get active timer for an event
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    is_active BOOLEAN,
    timer_state TEXT,
    last_loaded_cue_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        at.id,
        at.event_id,
        at.item_id,
        at.user_id,
        at.started_at,
        at.duration_seconds,
        at.is_active,
        at.timer_state,
        at.last_loaded_cue_id,
        at.created_at,
        at.updated_at
    FROM active_timers at
    WHERE at.event_id = p_event_id
    AND at.is_active = true
    ORDER BY at.updated_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create function to get active sub-cue timers for an event
CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(p_event_id TEXT)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
    item_id TEXT,
    user_id TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    is_active BOOLEAN,
    timer_state TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sct.id,
        sct.event_id,
        sct.item_id,
        sct.user_id,
        sct.started_at,
        sct.duration_seconds,
        sct.is_active,
        sct.timer_state,
        sct.created_at,
        sct.updated_at
    FROM sub_cue_timers sct
    WHERE sct.event_id = p_event_id
    AND sct.is_active = true
    ORDER BY sct.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Enable real-time replication for collaborative editing
ALTER PUBLICATION supabase_realtime ADD TABLE active_timers;
ALTER PUBLICATION supabase_realtime ADD TABLE timer_actions;
ALTER PUBLICATION supabase_realtime ADD TABLE completed_cues;
ALTER PUBLICATION supabase_realtime ADD TABLE sub_cue_timers;

-- Grant permissions on functions
GRANT EXECUTE ON FUNCTION get_recent_timer_actions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_timer_actions(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_last_loaded_cue(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_last_loaded_cue(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_completed_cues_for_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_completed_cues_for_event(UUID) TO anon;
GRANT EXECUTE ON FUNCTION clear_completed_cues_for_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_completed_cues_for_event(UUID) TO anon;
GRANT EXECUTE ON FUNCTION cleanup_old_timer_actions() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_timer_actions() TO anon;
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_timer_for_event(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) TO anon;

-- Add comments for documentation
COMMENT ON TABLE active_timers IS 'Tracks active timers for events - one row per event';
COMMENT ON TABLE timer_actions IS 'Logs all timer actions for real-time synchronization';
COMMENT ON TABLE completed_cues IS 'Tracks which schedule items have been completed';
COMMENT ON TABLE sub_cue_timers IS 'Tracks sub-cue timers for events - one row per event';
COMMENT ON FUNCTION get_recent_timer_actions(UUID) IS 'Returns recent timer actions for an event';
COMMENT ON FUNCTION get_last_loaded_cue(UUID) IS 'Returns the last loaded cue for an event';
COMMENT ON FUNCTION get_completed_cues_for_event(UUID) IS 'Returns completed cues for an event';
COMMENT ON FUNCTION clear_completed_cues_for_event(UUID) IS 'Clears all completed cues for an event';
COMMENT ON FUNCTION cleanup_old_timer_actions() IS 'Removes timer actions older than 7 days';
COMMENT ON FUNCTION get_active_timer_for_event(TEXT) IS 'Returns the active timer for an event';
COMMENT ON FUNCTION get_active_sub_cue_timers_for_event(TEXT) IS 'Returns active sub-cue timers for an event';
