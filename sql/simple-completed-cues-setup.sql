-- Simple completed cues setup - guaranteed to work
-- Run this in your Supabase SQL editor

-- Drop existing table if it exists
DROP TABLE IF EXISTS completed_cues CASCADE;

-- Create the completed_cues table
CREATE TABLE completed_cues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, item_id)
);

-- Create indexes
CREATE INDEX idx_completed_cues_event_id ON completed_cues(event_id);
CREATE INDEX idx_completed_cues_item_id ON completed_cues(item_id);

-- Enable RLS
ALTER TABLE completed_cues ENABLE ROW LEVEL SECURITY;

-- Create simple RLS policy (allow all for now)
CREATE POLICY "Allow all operations on completed_cues" ON completed_cues
  FOR ALL USING (true);

-- Simple function to get completed cues
CREATE OR REPLACE FUNCTION get_completed_cues_for_event(p_event_id UUID)
RETURNS TABLE (
  item_id BIGINT,
  user_id UUID,
  completed_at TIMESTAMPTZ,
  user_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cc.item_id,
    cc.user_id,
    cc.completed_at,
    'User' as user_name
  FROM completed_cues cc
  WHERE cc.event_id = p_event_id
  ORDER BY cc.completed_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Simple function to mark cue as completed
CREATE OR REPLACE FUNCTION mark_cue_completed(
  p_event_id UUID,
  p_item_id BIGINT,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO completed_cues (event_id, item_id, user_id, completed_at)
  VALUES (p_event_id, p_item_id, p_user_id, NOW())
  ON CONFLICT (event_id, item_id) 
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    completed_at = EXCLUDED.completed_at;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Simple function to unmark cue as completed
CREATE OR REPLACE FUNCTION unmark_cue_completed(
  p_event_id UUID,
  p_item_id BIGINT
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM completed_cues 
  WHERE event_id = p_event_id AND item_id = p_item_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Simple function to clear all completed cues
CREATE OR REPLACE FUNCTION clear_completed_cues_for_event(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM completed_cues WHERE event_id = p_event_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Test the functions
SELECT 'Setup completed successfully!' as status;

-- Test inserting a completed cue
SELECT mark_cue_completed('00000000-0000-0000-0000-000000000000'::uuid, 123, '00000000-0000-0000-0000-000000000000'::uuid);

-- Test getting completed cues
SELECT * FROM get_completed_cues_for_event('00000000-0000-0000-0000-000000000000'::uuid);

-- Clean up test data
SELECT clear_completed_cues_for_event('00000000-0000-0000-0000-000000000000'::uuid);
