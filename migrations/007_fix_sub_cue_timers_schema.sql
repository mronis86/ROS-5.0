-- Fix sub_cue_timers table schema to match API server expectations
-- This migration ensures the database schema matches what the API server expects

-- Drop and recreate the sub_cue_timers table with the correct schema
DROP TABLE IF EXISTS sub_cue_timers CASCADE;

-- Create the sub_cue_timers table with the correct schema
CREATE TABLE sub_cue_timers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Event and item identification
    event_id UUID NOT NULL,
    item_id BIGINT NOT NULL,
    sub_cue_id TEXT,
    
    -- User information
    user_id TEXT NOT NULL,
    user_name TEXT DEFAULT 'Unknown User',
    user_role TEXT DEFAULT 'VIEWER',
    
    -- Timer details
    duration_seconds INTEGER DEFAULT 0,
    row_number INTEGER,
    cue_display TEXT,
    timer_id TEXT,
    
    -- Timer state
    is_active BOOLEAN DEFAULT true,
    is_running BOOLEAN DEFAULT false,
    started_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_event_id ON sub_cue_timers (event_id);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_item_id ON sub_cue_timers (item_id);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_is_running ON sub_cue_timers (is_running);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_created_at ON sub_cue_timers (created_at DESC);

-- Add trigger to automatically update updated_at
CREATE TRIGGER update_sub_cue_timers_updated_at 
    BEFORE UPDATE ON sub_cue_timers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert a test record to verify the table works
INSERT INTO sub_cue_timers (
    event_id,
    item_id,
    user_id,
    user_name,
    user_role,
    duration_seconds,
    row_number,
    cue_display,
    timer_id,
    is_active,
    is_running,
    started_at
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    1234567890,
    'test-user',
    'Test User',
    'OPERATOR',
    60,
    1,
    'Test Cue',
    'test-timer-id',
    true,
    true,
    NOW()
);

-- Clean up the test record
DELETE FROM sub_cue_timers WHERE event_id = '00000000-0000-0000-0000-000000000001';

-- Verify the table was created correctly
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'sub_cue_timers' 
ORDER BY ordinal_position;








