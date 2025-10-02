-- Neon Database Setup for Run of Show Timer Application
-- This creates all required tables and functions for Neon Postgres

-- Drop existing tables if they exist (in correct order due to foreign keys)
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
    timer_state TEXT DEFAULT 'idle',
    cue_is TEXT
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
    is_running BOOLEAN DEFAULT true NOT NULL
);

-- Create completed_cues table with all required columns
CREATE TABLE completed_cues (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event and item identification
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    cue_id TEXT NOT NULL,
    
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
    item_id TEXT NOT NULL,
    
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

CREATE INDEX idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX idx_sub_cue_timers_item_id ON sub_cue_timers(item_id);
CREATE INDEX idx_sub_cue_timers_is_running ON sub_cue_timers(is_running);

CREATE INDEX idx_completed_cues_event_id ON completed_cues(event_id);
CREATE INDEX idx_completed_cues_item_id ON completed_cues(item_id);
CREATE INDEX idx_completed_cues_completed_at ON completed_cues(completed_at);

CREATE INDEX idx_timer_actions_event_id ON timer_actions(event_id);
CREATE INDEX idx_timer_actions_item_id ON timer_actions(item_id);
CREATE INDEX idx_timer_actions_timestamp ON timer_actions(action_timestamp);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_active_timers_updated_at BEFORE UPDATE ON active_timers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sub_cue_timers_updated_at BEFORE UPDATE ON sub_cue_timers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_completed_cues_updated_at BEFORE UPDATE ON completed_cues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_timer_actions_updated_at BEFORE UPDATE ON timer_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE active_timers IS 'Stores active timer sessions for run of show items';
COMMENT ON TABLE sub_cue_timers IS 'Stores active sub-cue timer sessions';
COMMENT ON TABLE completed_cues IS 'Stores completed cue records';
COMMENT ON TABLE timer_actions IS 'Stores timer action history';

