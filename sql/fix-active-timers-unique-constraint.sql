-- Fix active_timers table to ensure only one row per event
-- Add unique constraint on event_id

-- First, clean up any duplicate rows (keep the most recent one)
DELETE FROM active_timers 
WHERE id NOT IN (
    SELECT DISTINCT ON (event_id) id 
    FROM active_timers 
    ORDER BY event_id, started_at DESC
);

-- Add unique constraint on event_id
ALTER TABLE active_timers 
ADD CONSTRAINT unique_event_id UNIQUE (event_id);

-- Grant necessary permissions
GRANT ALL ON active_timers TO authenticated;
GRANT ALL ON active_timers TO service_role;
