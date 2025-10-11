-- Add unique constraint to active_timers table to ensure only one record per event
-- This migration ensures that we only have ONE active timer per event

-- First, remove any duplicate records (keep the most recent one)
DELETE FROM active_timers 
WHERE id NOT IN (
    SELECT MAX(id) 
    FROM active_timers 
    GROUP BY event_id
);

-- Add unique constraint on event_id
ALTER TABLE active_timers 
ADD CONSTRAINT unique_event_id UNIQUE (event_id);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_active_timers_event_id ON active_timers(event_id);


