-- Check current timer state in the database
-- Run this in your Supabase SQL editor to see what's actually stored

-- Check active_timers table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'active_timers' 
ORDER BY ordinal_position;

-- Check current active timers
SELECT 
  id,
  event_id,
  item_id,
  user_id,
  started_at,
  duration_seconds,
  is_active,
  timer_state,
  created_at,
  updated_at
FROM active_timers 
WHERE is_active = true
ORDER BY updated_at DESC;

-- Check if there are any timers with started_at = NULL but timer_state = 'running'
SELECT 
  id,
  event_id,
  item_id,
  started_at,
  timer_state,
  created_at,
  updated_at
FROM active_timers 
WHERE timer_state = 'running' 
  AND started_at IS NULL
ORDER BY updated_at DESC;

