-- Quick test to verify completed cues functions work
-- Run this after running simple-completed-cues-setup.sql

-- Test with a real event ID (replace with your actual event ID)
-- Replace '7b6d95da-c675-4c95-b2c8-8c2c8db84e7d' with your actual event ID

-- Test mark_cue_completed
SELECT mark_cue_completed('7b6d95da-c675-4c95-b2c8-8c2c8db84e7d'::uuid, 123, '00000000-0000-0000-0000-000000000000'::uuid);

-- Test get_completed_cues_for_event
SELECT * FROM get_completed_cues_for_event('7b6d95da-c675-4c95-b2c8-8c2c8db84e7d'::uuid);

-- Test unmark_cue_completed
SELECT unmark_cue_completed('7b6d95da-c675-4c95-b2c8-8c2c8db84e7d'::uuid, 123);

-- Test get_completed_cues_for_event again (should be empty)
SELECT * FROM get_completed_cues_for_event('7b6d95da-c675-4c95-b2c8-8c2c8db84e7d'::uuid);
