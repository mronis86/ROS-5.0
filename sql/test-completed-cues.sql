-- Test script to check if completed_cues table and functions exist
-- Run this in your Supabase SQL editor to verify the setup

-- Check if table exists
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'completed_cues'
ORDER BY ordinal_position;

-- Check if functions exist
SELECT routine_name, routine_type
FROM information_schema.routines 
WHERE routine_name IN (
  'get_completed_cues_for_event',
  'mark_cue_completed',
  'unmark_cue_completed',
  'clear_completed_cues_for_event'
);

-- Test the function (this will return empty if table doesn't exist)
SELECT * FROM get_completed_cues_for_event('00000000-0000-0000-0000-000000000000'::uuid);

-- Test inserting a completed cue
SELECT mark_cue_completed('00000000-0000-0000-0000-000000000000'::uuid, 123, '00000000-0000-0000-0000-000000000000'::uuid);

-- Test getting the completed cue
SELECT * FROM get_completed_cues_for_event('00000000-0000-0000-0000-000000000000'::uuid);

-- Clean up test data
SELECT clear_completed_cues_for_event('00000000-0000-0000-0000-000000000000'::uuid);
