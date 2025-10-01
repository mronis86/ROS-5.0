-- Simple Supabase Schema for Run of Show App
-- Run this in your Supabase SQL Editor

-- Drop existing tables if they exist
DROP TABLE IF EXISTS run_of_show_data CASCADE;
DROP TABLE IF EXISTS calendar_events CASCADE;

-- Create calendar_events table
CREATE TABLE calendar_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    schedule_data JSONB DEFAULT '{}'::jsonb
);

-- Create run_of_show_data table
CREATE TABLE run_of_show_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    schedule_items JSONB DEFAULT '[]'::jsonb,
    custom_columns JSONB DEFAULT '[]'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_calendar_events_updated_at 
    BEFORE UPDATE ON calendar_events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_run_of_show_data_updated_at 
    BEFORE UPDATE ON run_of_show_data 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create active_users table for user tracking
CREATE TABLE active_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add trigger for updated_at
CREATE TRIGGER update_active_users_updated_at 
    BEFORE UPDATE ON active_users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_of_show_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_users ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (for now)
CREATE POLICY "Allow all operations for calendar_events" ON calendar_events
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for run_of_show_data" ON run_of_show_data
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for active_users" ON active_users
    FOR ALL USING (true) WITH CHECK (true);

-- Enable real-time replication
ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;
ALTER PUBLICATION supabase_realtime ADD TABLE run_of_show_data;
ALTER PUBLICATION supabase_realtime ADD TABLE active_users;
