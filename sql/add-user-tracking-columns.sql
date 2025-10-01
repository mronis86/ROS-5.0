-- Add user tracking columns to run_of_show_data table
-- This script adds the columns needed to track who made changes

-- Add the new columns
ALTER TABLE run_of_show_data
ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_modified_by_name text,
ADD COLUMN IF NOT EXISTS last_modified_by_role text;

-- Add an index for better performance
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_last_modified_by 
ON run_of_show_data (last_modified_by);

-- Optional: Update existing rows with default values
-- UPDATE run_of_show_data 
-- SET last_modified_by_name = 'System', 
--     last_modified_by_role = 'UNKNOWN' 
-- WHERE last_modified_by_name IS NULL;
