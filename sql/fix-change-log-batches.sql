-- Fix Change Log Batches Table and RLS Policies
-- This adds missing columns to the existing change_log_batches table

-- Add missing columns to existing change_log_batches table
DO $$ 
BEGIN
    -- Add user_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'change_log_batches' AND column_name = 'user_id') THEN
        ALTER TABLE change_log_batches ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    
    -- Add user_name column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'change_log_batches' AND column_name = 'user_name') THEN
        ALTER TABLE change_log_batches ADD COLUMN user_name TEXT;
    END IF;
    
    -- Add user_role column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'change_log_batches' AND column_name = 'user_role') THEN
        ALTER TABLE change_log_batches ADD COLUMN user_role TEXT;
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_change_log_batches_event_id ON change_log_batches(event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_batches_synced ON change_log_batches(synced);
CREATE INDEX IF NOT EXISTS idx_change_log_batches_created_at ON change_log_batches(created_at);

-- Enable Row Level Security
ALTER TABLE change_log_batches ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view change log batches for events they have access to" ON change_log_batches;
DROP POLICY IF EXISTS "Users can insert change log batches for events they have access to" ON change_log_batches;
DROP POLICY IF EXISTS "Users can update change log batches for events they have access to" ON change_log_batches;
DROP POLICY IF EXISTS "Users can delete change log batches for events they have access to" ON change_log_batches;

-- Create RLS policies for change_log_batches
CREATE POLICY "Users can view change log batches for events they have access to" ON change_log_batches
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      -- Allow if user has access to the event
      EXISTS (
        SELECT 1 FROM run_of_show_data rosd 
        WHERE rosd.event_id = change_log_batches.event_id 
        AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
      )
      OR
      -- Allow if user created the batch
      change_log_batches.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert change log batches for events they have access to" ON change_log_batches
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND (
      -- Allow if user has access to the event
      EXISTS (
        SELECT 1 FROM run_of_show_data rosd 
        WHERE rosd.event_id = change_log_batches.event_id 
        AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
      )
      OR
      -- Allow if user is the creator
      change_log_batches.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update change log batches for events they have access to" ON change_log_batches
  FOR UPDATE USING (
    auth.uid() IS NOT NULL AND (
      -- Allow if user has access to the event
      EXISTS (
        SELECT 1 FROM run_of_show_data rosd 
        WHERE rosd.event_id = change_log_batches.event_id 
        AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
      )
      OR
      -- Allow if user created the batch
      change_log_batches.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete change log batches for events they have access to" ON change_log_batches
  FOR DELETE USING (
    auth.uid() IS NOT NULL AND (
      -- Allow if user has access to the event
      EXISTS (
        SELECT 1 FROM run_of_show_data rosd 
        WHERE rosd.event_id = change_log_batches.event_id 
        AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
      )
      OR
      -- Allow if user created the batch
      change_log_batches.user_id = auth.uid()
    )
  );

-- Grant permissions
GRANT ALL ON change_log_batches TO authenticated;
GRANT ALL ON change_log_batches TO anon;

-- Add comments
COMMENT ON TABLE change_log_batches IS 'Stores batches of change log entries for efficient syncing';
COMMENT ON COLUMN change_log_batches.event_id IS 'The event this batch belongs to';
COMMENT ON COLUMN change_log_batches.changes IS 'JSON array of change log entries';
COMMENT ON COLUMN change_log_batches.synced IS 'Whether this batch has been synced to the main change log';
COMMENT ON COLUMN change_log_batches.user_id IS 'User who created this batch';
COMMENT ON COLUMN change_log_batches.user_name IS 'Name of the user who created this batch';
COMMENT ON COLUMN change_log_batches.user_role IS 'Role of the user who created this batch';
