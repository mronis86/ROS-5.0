-- Fix sub_cue_timers table to have only one record per event (like active_timers)
-- This ensures we only have ONE sub-cue timer per event

-- First, remove any duplicate records (keep the most recent one)
DELETE FROM sub_cue_timers 
WHERE id NOT IN (
    SELECT id 
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY created_at DESC) as rn
        FROM sub_cue_timers
    ) ranked
    WHERE rn = 1
);

-- Add unique constraint on event_id to ensure only one sub-cue timer per event
ALTER TABLE sub_cue_timers 
ADD CONSTRAINT unique_sub_cue_timer_event_id UNIQUE (event_id);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_event_id_unique ON sub_cue_timers(event_id);

-- Verify the constraint was added
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'sub_cue_timers' 
AND constraint_type = 'UNIQUE';
