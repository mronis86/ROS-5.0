-- Persist segment name on secondary / sub-cue timers for Clock & Fullscreen labels
ALTER TABLE sub_cue_timers
  ADD COLUMN IF NOT EXISTS segment_name TEXT;
