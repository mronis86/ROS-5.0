-- Complete Database Schema for Run of Show Application
-- This creates both tables with proper relationships

-- Drop existing tables if they exist (to start fresh)
DROP TABLE IF EXISTS run_of_show_data CASCADE;
DROP TABLE IF EXISTS calendar_events CASCADE;

-- Create the calendar_events table
CREATE TABLE calendar_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    schedule_data JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the run_of_show_data table
CREATE TABLE run_of_show_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL UNIQUE, -- This links to calendar_events
    event_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    schedule_items JSONB DEFAULT '[]'::jsonb,
    custom_columns JSONB DEFAULT '[]'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes for calendar_events
CREATE INDEX idx_calendar_events_date ON calendar_events(date DESC);
CREATE INDEX idx_calendar_events_created_at ON calendar_events(created_at DESC);
CREATE INDEX idx_calendar_events_name ON calendar_events(name);

-- Create indexes for run_of_show_data
CREATE INDEX idx_run_of_show_data_event_id ON run_of_show_data(event_id);
CREATE INDEX idx_run_of_show_data_event_date ON run_of_show_data(event_date DESC);
CREATE INDEX idx_run_of_show_data_created_at ON run_of_show_data(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_of_show_data ENABLE ROW LEVEL SECURITY;

-- Create policies for calendar_events
CREATE POLICY "Allow all operations for authenticated users" ON calendar_events
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON calendar_events
    FOR ALL USING (true);

-- Create policies for run_of_show_data
CREATE POLICY "Allow all operations for authenticated users" ON run_of_show_data
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON run_of_show_data
    FOR ALL USING (true);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update the updated_at column
CREATE TRIGGER update_calendar_events_updated_at 
    BEFORE UPDATE ON calendar_events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_run_of_show_data_updated_at 
    BEFORE UPDATE ON run_of_show_data 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable real-time replication for collaborative editing
ALTER PUBLICATION supabase_realtime ADD TABLE run_of_show_data;
ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;

-- Insert some sample data (optional - remove if not needed)
INSERT INTO calendar_events (name, date, schedule_data) VALUES
    ('Sample Event 1', '2024-01-15', '{"location": "Great Hall", "numberOfDays": 1, "eventId": "sample-event-1"}'),
    ('Sample Event 2', '2024-01-20', '{"location": "Great Hall", "numberOfDays": 1, "eventId": "sample-event-2"}')
ON CONFLICT DO NOTHING;

INSERT INTO run_of_show_data (event_id, event_name, event_date, schedule_items, custom_columns, settings) VALUES
    ('sample-event-1', 'Sample Event 1', '2024-01-15', '[]', '[]', '{"eventName": "Sample Event 1", "masterStartTime": ""}'),
    ('sample-event-2', 'Sample Event 2', '2024-01-20', '[]', '[]', '{"eventName": "Sample Event 2", "masterStartTime": ""}')
ON CONFLICT (event_id) DO NOTHING;
