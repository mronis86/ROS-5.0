-- Migration to add last_change_at field to run_of_show_data table
-- This field tracks when the last change was made (different from updated_at)

-- Add the last_change_at column
ALTER TABLE public.run_of_show_data 
ADD COLUMN IF NOT EXISTS last_change_at TIMESTAMP WITH TIME ZONE;

-- Create an index for better performance when checking for changes
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_last_change_at 
ON public.run_of_show_data (last_change_at);

-- Update existing records to have last_change_at = updated_at (first change scenario)
UPDATE public.run_of_show_data 
SET last_change_at = updated_at 
WHERE last_change_at IS NULL;

-- Add a comment to explain the field
COMMENT ON COLUMN public.run_of_show_data.last_change_at IS 'Tracks when the last change was made. On first change, this equals updated_at. On subsequent changes, this keeps the previous change time while updated_at gets the new time.';

