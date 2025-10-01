-- Quick fix for timer started_at issue
-- This will update any running timers that don't have a started_at value

-- First, let's see what we have
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
ORDER BY updated_at DESC;

-- Update any running timers that don't have started_at set
-- This is a one-time fix
UPDATE active_timers 
SET started_at = created_at
WHERE timer_state = 'running' 
  AND started_at IS NULL;

-- Verify the fix
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
ORDER BY updated_at DESC;

