-- Update change_log table to match detailed local change log structure
-- This adds missing columns to store complete change information

-- Add missing columns
ALTER TABLE change_log 
  ADD COLUMN IF NOT EXISTS user_role text,
  ADD COLUMN IF NOT EXISTS field_name text,
  ADD COLUMN IF NOT EXISTS old_value text,
  ADD COLUMN IF NOT EXISTS new_value text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS row_number integer,
  ADD COLUMN IF NOT EXISTS cue_number text;

-- Rename old_values to old_values_json for clarity (keep as backup)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'change_log' AND column_name = 'old_values'
  ) THEN
    ALTER TABLE change_log RENAME COLUMN old_values TO old_values_json;
  END IF;
END $$;

-- Rename new_values to new_values_json for clarity (keep as backup)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'change_log' AND column_name = 'new_values'
  ) THEN
    ALTER TABLE change_log RENAME COLUMN new_values TO new_values_json;
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_change_log_row_number ON change_log (row_number);
CREATE INDEX IF NOT EXISTS idx_change_log_cue_number ON change_log (cue_number);
CREATE INDEX IF NOT EXISTS idx_change_log_user_role ON change_log (user_role);
CREATE INDEX IF NOT EXISTS idx_change_log_field_name ON change_log (field_name);

-- Add comments for documentation
COMMENT ON COLUMN change_log.user_role IS 'User role at time of change: VIEWER, EDITOR, or OPERATOR';
COMMENT ON COLUMN change_log.field_name IS 'Specific field that was changed (e.g., durationMinutes, segmentName)';
COMMENT ON COLUMN change_log.old_value IS 'Previous value before change';
COMMENT ON COLUMN change_log.new_value IS 'New value after change';
COMMENT ON COLUMN change_log.description IS 'Human-readable description of the change';
COMMENT ON COLUMN change_log.row_number IS 'Row number in schedule (1-based index)';
COMMENT ON COLUMN change_log.cue_number IS 'CUE number/identifier';

-- Verify the table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'change_log'
ORDER BY ordinal_position;

