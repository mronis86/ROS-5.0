-- Test script to check if the run_of_show_data table has the required columns
-- Run this in Supabase SQL editor to verify the schema

-- Check if the table exists and has the required columns
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'run_of_show_data' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check if there's any data in the table
SELECT 
    event_id,
    updated_at,
    last_change_at,
    last_modified_by,
    last_modified_by_name,
    last_modified_by_role
FROM public.run_of_show_data 
LIMIT 5;

