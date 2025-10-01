-- Detailed Database Schema for Run of Show Application
-- This creates separate tables for better data organization and querying

-- Drop existing tables if they exist (to start fresh)
DROP TABLE IF EXISTS schedule_items CASCADE;
DROP TABLE IF EXISTS custom_columns CASCADE;
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

-- Create the run_of_show_data table (main event data)
CREATE TABLE run_of_show_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    event_name_setting TEXT DEFAULT '',
    master_start_time TEXT DEFAULT '',
    settings JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the schedule_items table (individual schedule items)
CREATE TABLE schedule_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    day INTEGER DEFAULT 1,
    program_type TEXT DEFAULT '',
    shot_type TEXT DEFAULT '',
    segment_name TEXT DEFAULT '',
    duration_hours INTEGER DEFAULT 0,
    duration_minutes INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    assets TEXT DEFAULT '',
    speakers TEXT DEFAULT '',
    has_ppt BOOLEAN DEFAULT false,
    has_qa BOOLEAN DEFAULT false,
    timer_id TEXT DEFAULT '',
    is_public BOOLEAN DEFAULT true,
    is_indented BOOLEAN DEFAULT false,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    FOREIGN KEY (event_id) REFERENCES run_of_show_data(event_id) ON DELETE CASCADE
);

-- Create the custom_columns table (custom column definitions)
CREATE TABLE custom_columns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    column_id TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    FOREIGN KEY (event_id) REFERENCES run_of_show_data(event_id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX idx_calendar_events_date ON calendar_events(date DESC);
CREATE INDEX idx_calendar_events_created_at ON calendar_events(created_at DESC);
CREATE INDEX idx_calendar_events_name ON calendar_events(name);

CREATE INDEX idx_run_of_show_data_event_id ON run_of_show_data(event_id);
CREATE INDEX idx_run_of_show_data_event_date ON run_of_show_data(event_date DESC);
CREATE INDEX idx_run_of_show_data_created_at ON run_of_show_data(created_at DESC);

CREATE INDEX idx_schedule_items_event_id ON schedule_items(event_id);
CREATE INDEX idx_schedule_items_item_id ON schedule_items(event_id, item_id);
CREATE INDEX idx_schedule_items_day ON schedule_items(event_id, day);
CREATE INDEX idx_schedule_items_created_at ON schedule_items(created_at DESC);

CREATE INDEX idx_custom_columns_event_id ON custom_columns(event_id);
CREATE INDEX idx_custom_columns_created_at ON custom_columns(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_of_show_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_columns ENABLE ROW LEVEL SECURITY;

-- Create policies for all tables
CREATE POLICY "Allow all operations for authenticated users" ON calendar_events
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON calendar_events
    FOR ALL USING (true);

CREATE POLICY "Allow all operations for authenticated users" ON run_of_show_data
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON run_of_show_data
    FOR ALL USING (true);

CREATE POLICY "Allow all operations for authenticated users" ON schedule_items
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON schedule_items
    FOR ALL USING (true);

CREATE POLICY "Allow all operations for authenticated users" ON custom_columns
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON custom_columns
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

CREATE TRIGGER update_schedule_items_updated_at 
    BEFORE UPDATE ON schedule_items 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_columns_updated_at 
    BEFORE UPDATE ON custom_columns 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data
INSERT INTO calendar_events (name, date, schedule_data) VALUES
    ('Sample Event 1', '2024-01-15', '{"location": "Great Hall", "numberOfDays": 1, "eventId": "sample-event-1"}'),
    ('Sample Event 2', '2024-01-20', '{"location": "Great Hall", "numberOfDays": 1, "eventId": "sample-event-2"}')
ON CONFLICT DO NOTHING;

INSERT INTO run_of_show_data (event_id, event_name, event_date, event_name_setting, master_start_time) VALUES
    ('sample-event-1', 'Sample Event 1', '2024-01-15', 'Sample Event 1', ''),
    ('sample-event-2', 'Sample Event 2', '2024-01-20', 'Sample Event 2', '')
ON CONFLICT (event_id) DO NOTHING;

INSERT INTO schedule_items (event_id, item_id, day, program_type, shot_type, segment_name, duration_hours, duration_minutes, duration_seconds, notes, assets, speakers, has_ppt, has_qa, timer_id, is_public, is_indented) VALUES
    ('sample-event-1', 1, 1, 'Opening', 'Wide', 'Welcome & Introduction', 0, 5, 0, 'Welcome everyone to the event', '', 'John Doe', false, false, 'timer-1', true, false),
    ('sample-event-1', 2, 1, 'Presentation', 'Medium', 'Keynote Speech', 0, 30, 0, 'Main presentation', 'slides.pdf', 'Jane Smith', true, false, 'timer-2', true, false),
    ('sample-event-2', 1, 1, 'Opening', 'Wide', 'Event Kickoff', 0, 10, 0, 'Start of the event', '', 'Event Host', false, true, 'timer-3', true, false)
ON CONFLICT DO NOTHING;
