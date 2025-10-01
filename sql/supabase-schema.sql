-- Create the calendar_events table
CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    schedule_data JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_events_created_at ON calendar_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_events_name ON calendar_events(name);

-- Enable Row Level Security (RLS)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Create policies for RLS (drop existing ones first to avoid conflicts)
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON calendar_events;
DROP POLICY IF EXISTS "Allow all operations for anonymous users" ON calendar_events;

-- Allow all operations for authenticated users (you can modify this based on your needs)
CREATE POLICY "Allow all operations for authenticated users" ON calendar_events
    FOR ALL USING (auth.role() = 'authenticated');

-- Allow all operations for anonymous users (for development - you may want to restrict this in production)
CREATE POLICY "Allow all operations for anonymous users" ON calendar_events
    FOR ALL USING (true);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update the updated_at column
CREATE TRIGGER update_calendar_events_updated_at 
    BEFORE UPDATE ON calendar_events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create the run_of_show_data table
CREATE TABLE IF NOT EXISTS run_of_show_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    schedule_items JSONB DEFAULT '[]'::jsonb,
    custom_columns JSONB DEFAULT '[]'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_event_id ON run_of_show_data(event_id);
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_event_date ON run_of_show_data(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_created_at ON run_of_show_data(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE run_of_show_data ENABLE ROW LEVEL SECURITY;

-- Create policies for RLS (drop existing ones first to avoid conflicts)
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON run_of_show_data;
DROP POLICY IF EXISTS "Allow all operations for anonymous users" ON run_of_show_data;

CREATE POLICY "Allow all operations for authenticated users" ON run_of_show_data
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for anonymous users" ON run_of_show_data
    FOR ALL USING (true);

-- Create a trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_run_of_show_data_updated_at 
    BEFORE UPDATE ON run_of_show_data 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert some sample data (optional - remove if not needed)
INSERT INTO calendar_events (name, date, schedule_data) VALUES
    ('Sample Event 1', '2024-01-15', '{"items": [], "customColumns": []}'),
    ('Sample Event 2', '2024-01-20', '{"items": [], "customColumns": []}')
ON CONFLICT DO NOTHING;
