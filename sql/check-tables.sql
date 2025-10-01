-- Check if the active_timers table exists and show its structure
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'active_timers'
ORDER BY ordinal_position;

-- Check if the timer_actions table exists and show its structure
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'timer_actions'
ORDER BY ordinal_position;

