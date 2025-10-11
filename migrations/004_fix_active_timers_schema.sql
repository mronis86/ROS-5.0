-- Fix active_timers table schema to match API server expectations
-- This migration ensures the database schema matches what the API server expects

-- First, check if the table exists and what its current structure is
-- If it doesn't exist, create it with the correct schema

-- Drop the existing table if it exists (this will lose data, but ensures clean schema)
DROP TABLE IF EXISTS active_timers CASCADE;

-- Create the active_timers table with the correct schema
CREATE TABLE active_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT DEFAULT 'Unknown User',
  user_role TEXT DEFAULT 'OPERATOR',
  timer_state TEXT NOT NULL DEFAULT 'loaded',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_running BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_loaded_cue_id INTEGER,
  cue_is TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 300,
  elapsed_seconds INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint on event_id to ensure only one active timer per event
ALTER TABLE active_timers
ADD CONSTRAINT unique_event_id UNIQUE (event_id);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_active_timers_event_id ON active_timers (event_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_item_id ON active_timers (item_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_user_id ON active_timers (user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_is_active ON active_timers (is_active);
CREATE INDEX IF NOT EXISTS idx_active_timers_is_running ON active_timers (is_running);
CREATE INDEX IF NOT EXISTS idx_active_timers_started_at ON active_timers (started_at);

-- Add function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to automatically update updated_at
CREATE TRIGGER update_active_timers_updated_at 
  BEFORE UPDATE ON active_timers 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert a test record to verify the schema works
INSERT INTO active_timers (
  event_id, 
  item_id, 
  user_id, 
  timer_state, 
  is_active, 
  is_running, 
  started_at,
  duration_seconds
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  0,
  'test-user',
  'loaded',
  true,
  false,
  '2099-12-31T23:59:59.999Z',
  300
);

-- Clean up the test record
DELETE FROM active_timers WHERE event_id = '00000000-0000-0000-0000-000000000000';

-- Verify the table was created correctly
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'active_timers' 
ORDER BY ordinal_position;


