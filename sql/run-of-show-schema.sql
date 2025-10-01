-- Complete Run of Show Database Schema
-- This creates the run_of_show_data table with all required fields for the application

-- Drop existing table if it exists to start fresh
DROP TABLE IF EXISTS run_of_show_data CASCADE;

-- Create the run_of_show_data table with all required fields
CREATE TABLE run_of_show_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event identification
    event_id TEXT NOT NULL UNIQUE, -- Links to calendar_events
    event_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    
    -- Core data fields
    schedule_items JSONB DEFAULT '[]'::jsonb NOT NULL, -- Array of ScheduleItem objects
    custom_columns JSONB DEFAULT '[]'::jsonb NOT NULL, -- Array of CustomColumn objects
    settings JSONB DEFAULT '{}'::jsonb NOT NULL, -- Event settings and configuration
    
    -- User tracking fields (for change log and collaboration)
    last_modified_by TEXT, -- User ID who last modified
    last_modified_by_name TEXT, -- Display name of last modifier
    last_modified_by_role TEXT, -- Role of last modifier (VIEWER/EDITOR/OPERATOR)
    
    -- Additional metadata
    version INTEGER DEFAULT 1, -- For optimistic locking
    is_active BOOLEAN DEFAULT true, -- Soft delete flag
    tags TEXT[] DEFAULT '{}' -- Optional tags for categorization
);

-- Create comprehensive indexes for performance
CREATE INDEX idx_run_of_show_data_event_id ON run_of_show_data(event_id);
CREATE INDEX idx_run_of_show_data_event_date ON run_of_show_data(event_date DESC);
CREATE INDEX idx_run_of_show_data_created_at ON run_of_show_data(created_at DESC);
CREATE INDEX idx_run_of_show_data_updated_at ON run_of_show_data(updated_at DESC);
CREATE INDEX idx_run_of_show_data_last_modified_by ON run_of_show_data(last_modified_by);
CREATE INDEX idx_run_of_show_data_is_active ON run_of_show_data(is_active) WHERE is_active = true;
CREATE INDEX idx_run_of_show_data_tags ON run_of_show_data USING GIN(tags);

-- Create GIN indexes for JSONB fields for better query performance
CREATE INDEX idx_run_of_show_data_schedule_items_gin ON run_of_show_data USING GIN(schedule_items);
CREATE INDEX idx_run_of_show_data_custom_columns_gin ON run_of_show_data USING GIN(custom_columns);
CREATE INDEX idx_run_of_show_data_settings_gin ON run_of_show_data USING GIN(settings);

-- Add constraints for data integrity
ALTER TABLE run_of_show_data ADD CONSTRAINT chk_event_id_not_empty CHECK (length(trim(event_id)) > 0);
ALTER TABLE run_of_show_data ADD CONSTRAINT chk_event_name_not_empty CHECK (length(trim(event_name)) > 0);
ALTER TABLE run_of_show_data ADD CONSTRAINT chk_schedule_items_is_array CHECK (jsonb_typeof(schedule_items) = 'array');
ALTER TABLE run_of_show_data ADD CONSTRAINT chk_custom_columns_is_array CHECK (jsonb_typeof(custom_columns) = 'array');
ALTER TABLE run_of_show_data ADD CONSTRAINT chk_settings_is_object CHECK (jsonb_typeof(settings) = 'object');
ALTER TABLE run_of_show_data ADD CONSTRAINT chk_version_positive CHECK (version > 0);

-- Enable Row Level Security (RLS)
ALTER TABLE run_of_show_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON run_of_show_data;
DROP POLICY IF EXISTS "Allow all operations for anonymous users" ON run_of_show_data;
DROP POLICY IF EXISTS "Allow read access for all users" ON run_of_show_data;
DROP POLICY IF EXISTS "Allow write access for authenticated users" ON run_of_show_data;

-- Create comprehensive RLS policies
CREATE POLICY "Allow read access for all users" ON run_of_show_data
    FOR SELECT USING (true);

CREATE POLICY "Allow write access for authenticated users" ON run_of_show_data
    FOR ALL USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Fallback policy for anonymous users (if needed for development)
CREATE POLICY "Allow all operations for anonymous users" ON run_of_show_data
    FOR ALL USING (true)
    WITH CHECK (true);

-- Create function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    -- Increment version for optimistic locking
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update the updated_at column and version
DROP TRIGGER IF EXISTS update_run_of_show_data_updated_at ON run_of_show_data;
CREATE TRIGGER update_run_of_show_data_updated_at 
    BEFORE UPDATE ON run_of_show_data 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to validate schedule_items structure
CREATE OR REPLACE FUNCTION validate_schedule_items()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate that schedule_items is an array
    IF jsonb_typeof(NEW.schedule_items) != 'array' THEN
        RAISE EXCEPTION 'schedule_items must be an array';
    END IF;
    
    -- Validate each schedule item has required fields
    FOR i IN 0..jsonb_array_length(NEW.schedule_items) - 1 LOOP
        DECLARE
            item jsonb := NEW.schedule_items->i;
        BEGIN
            -- Check required fields exist
            IF NOT (item ? 'id' AND item ? 'segmentName' AND item ? 'programType') THEN
                RAISE EXCEPTION 'Schedule item at index % is missing required fields (id, segmentName, programType)', i;
            END IF;
            
            -- Validate data types
            IF jsonb_typeof(item->'id') != 'number' THEN
                RAISE EXCEPTION 'Schedule item id at index % must be a number', i;
            END IF;
            
            IF jsonb_typeof(item->'segmentName') != 'string' THEN
                RAISE EXCEPTION 'Schedule item segmentName at index % must be a string', i;
            END IF;
        END;
    END LOOP;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to validate schedule_items
DROP TRIGGER IF EXISTS validate_schedule_items_trigger ON run_of_show_data;
CREATE TRIGGER validate_schedule_items_trigger
    BEFORE INSERT OR UPDATE ON run_of_show_data
    FOR EACH ROW
    EXECUTE FUNCTION validate_schedule_items();

-- Create function to validate custom_columns structure
CREATE OR REPLACE FUNCTION validate_custom_columns()
RETURNS TRIGGER AS $$
BEGIN
    -- Validate that custom_columns is an array
    IF jsonb_typeof(NEW.custom_columns) != 'array' THEN
        RAISE EXCEPTION 'custom_columns must be an array';
    END IF;
    
    -- Validate each custom column has required fields
    FOR i IN 0..jsonb_array_length(NEW.custom_columns) - 1 LOOP
        DECLARE
            column_item jsonb := NEW.custom_columns->i;
        BEGIN
            -- Check required fields exist
            IF NOT (column_item ? 'id' AND column_item ? 'name') THEN
                RAISE EXCEPTION 'Custom column at index % is missing required fields (id, name)', i;
            END IF;
            
            -- Validate data types
            IF jsonb_typeof(column_item->'id') != 'string' THEN
                RAISE EXCEPTION 'Custom column id at index % must be a string', i;
            END IF;
            
            IF jsonb_typeof(column_item->'name') != 'string' THEN
                RAISE EXCEPTION 'Custom column name at index % must be a string', i;
            END IF;
        END;
    END LOOP;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to validate custom_columns
DROP TRIGGER IF EXISTS validate_custom_columns_trigger ON run_of_show_data;
CREATE TRIGGER validate_custom_columns_trigger
    BEFORE INSERT OR UPDATE ON run_of_show_data
    FOR EACH ROW
    EXECUTE FUNCTION validate_custom_columns();

-- Enable real-time replication for collaborative editing
ALTER PUBLICATION supabase_realtime ADD TABLE run_of_show_data;

-- Insert sample data for testing (optional - remove in production)
INSERT INTO run_of_show_data (
    event_id, 
    event_name, 
    event_date, 
    schedule_items, 
    custom_columns, 
    settings,
    last_modified_by,
    last_modified_by_name,
    last_modified_by_role
) VALUES
    (
        'sample-event-1', 
        'Sample Event 1', 
        '2024-01-15', 
        '[
            {
                "id": 1,
                "day": 1,
                "programType": "PreShow/End",
                "shotType": "Podium",
                "segmentName": "Welcome and Introduction",
                "durationHours": 0,
                "durationMinutes": 5,
                "durationSeconds": 0,
                "notes": "Welcome remarks",
                "assets": "",
                "speakers": "",
                "speakersText": "",
                "hasPPT": false,
                "hasQA": false,
                "timerId": "",
                "customFields": {},
                "isPublic": true,
                "isIndented": false
            }
        ]'::jsonb, 
        '[
            {
                "id": "custom1",
                "name": "Custom Field 1"
            }
        ]'::jsonb, 
        '{
            "eventName": "Sample Event 1", 
            "masterStartTime": "09:00",
            "dayStartTimes": {"1": "09:00"},
            "lastSaved": "2024-01-15T09:00:00Z"
        }'::jsonb,
        'sample-user-1',
        'Sample User',
        'EDITOR'
    ),
    (
        'sample-event-2', 
        'Sample Event 2', 
        '2024-01-20', 
        '[]'::jsonb, 
        '[]'::jsonb, 
        '{
            "eventName": "Sample Event 2", 
            "masterStartTime": "",
            "dayStartTimes": {},
            "lastSaved": "2024-01-20T10:00:00Z"
        }'::jsonb,
        'sample-user-2',
        'Another User',
        'VIEWER'
    )
ON CONFLICT (event_id) DO NOTHING;

-- Create a view for easier querying of active events
CREATE OR REPLACE VIEW active_run_of_show_events AS
SELECT 
    id,
    event_id,
    event_name,
    event_date,
    schedule_items,
    custom_columns,
    settings,
    last_modified_by,
    last_modified_by_name,
    last_modified_by_role,
    version,
    created_at,
    updated_at,
    tags
FROM run_of_show_data 
WHERE is_active = true
ORDER BY event_date DESC, updated_at DESC;

-- Grant permissions on the view
GRANT SELECT ON active_run_of_show_events TO authenticated;
GRANT SELECT ON active_run_of_show_events TO anon;

-- Add comments for documentation
COMMENT ON TABLE run_of_show_data IS 'Stores run of show data for events including schedule items, custom columns, and settings';
COMMENT ON COLUMN run_of_show_data.event_id IS 'Unique identifier linking to calendar_events table';
COMMENT ON COLUMN run_of_show_data.schedule_items IS 'JSONB array of ScheduleItem objects containing the event schedule';
COMMENT ON COLUMN run_of_show_data.custom_columns IS 'JSONB array of CustomColumn objects for custom data fields';
COMMENT ON COLUMN run_of_show_data.settings IS 'JSONB object containing event-specific settings and configuration';
COMMENT ON COLUMN run_of_show_data.last_modified_by IS 'User ID of the last person to modify this record';
COMMENT ON COLUMN run_of_show_data.version IS 'Version number for optimistic locking during concurrent edits';
COMMENT ON COLUMN run_of_show_data.is_active IS 'Soft delete flag - false means the record is deleted';
COMMENT ON COLUMN run_of_show_data.tags IS 'Array of tags for categorizing and filtering events';