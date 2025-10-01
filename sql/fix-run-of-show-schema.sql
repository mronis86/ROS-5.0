-- Fix run_of_show_data table schema
-- This migration adds the missing last_change_at column and ensures all required columns exist

-- Add the last_change_at column if it doesn't exist
ALTER TABLE public.run_of_show_data 
ADD COLUMN IF NOT EXISTS last_change_at TIMESTAMP WITH TIME ZONE;

-- Ensure all required columns exist (in case they were missing)
ALTER TABLE public.run_of_show_data 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

ALTER TABLE public.run_of_show_data 
ADD COLUMN IF NOT EXISTS last_modified_by TEXT;

ALTER TABLE public.run_of_show_data 
ADD COLUMN IF NOT EXISTS last_modified_by_name TEXT;

ALTER TABLE public.run_of_show_data 
ADD COLUMN IF NOT EXISTS last_modified_by_role TEXT;

-- Update existing records to have last_change_at = updated_at (first change scenario)
UPDATE public.run_of_show_data 
SET last_change_at = updated_at 
WHERE last_change_at IS NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_last_change_at 
ON public.run_of_show_data (last_change_at);

CREATE INDEX IF NOT EXISTS idx_run_of_show_data_updated_at 
ON public.run_of_show_data (updated_at);

-- Add comments to explain the fields
COMMENT ON COLUMN public.run_of_show_data.last_change_at IS 'Tracks when the last change was made. On first change, this equals updated_at. On subsequent changes, this keeps the previous change time while updated_at gets the new time.';
COMMENT ON COLUMN public.run_of_show_data.updated_at IS 'Tracks when the record was last updated. This changes on every update.';
COMMENT ON COLUMN public.run_of_show_data.last_modified_by IS 'User ID who made the last change';
COMMENT ON COLUMN public.run_of_show_data.last_modified_by_name IS 'Name of user who made the last change';
COMMENT ON COLUMN public.run_of_show_data.last_modified_by_role IS 'Role of user who made the last change';

