-- Complete User Tracking Setup
-- This script sets up everything needed for user tracking from scratch

-- Drop everything first to start clean
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP FUNCTION IF EXISTS get_or_create_user_session(uuid, text, text);
-- Note: Not dropping update_updated_at_column() as it's used by other tables

-- Create the user_sessions table
CREATE TABLE user_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  username text NOT NULL,
  user_role text NOT NULL,
  last_activity timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create the update_updated_at_column function (only if it doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the get_or_create_user_session function
CREATE OR REPLACE FUNCTION get_or_create_user_session(
  p_user_id uuid,
  p_event_id text,
  p_user_role text
)
RETURNS TABLE(
  session_id uuid,
  user_id uuid,
  event_id text,
  username text,
  user_role text,
  last_activity timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id uuid;
  v_username text;
BEGIN
  -- Get username from auth.users
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_username
  FROM auth.users 
  WHERE id = p_user_id;
  
  -- Try to find existing session for this user and event
  SELECT us.id INTO v_session_id
  FROM user_sessions us
  WHERE us.user_id = p_user_id AND us.event_id = p_event_id;
  
  IF v_session_id IS NOT NULL THEN
    -- Update existing session with new role
    UPDATE user_sessions
    SET user_role = p_user_role,
        last_activity = now(),
        updated_at = now()
    WHERE user_sessions.id = v_session_id;
  ELSE
    -- Create new session
    INSERT INTO user_sessions (user_id, event_id, username, user_role)
    VALUES (p_user_id, p_event_id, COALESCE(v_username, 'Unknown User'), p_user_role)
    RETURNING user_sessions.id INTO v_session_id;
  END IF;
  
  -- Return the session data
  RETURN QUERY
  SELECT us.id, us.user_id, us.event_id, us.username, us.user_role, us.last_activity
  FROM user_sessions us
  WHERE us.id = v_session_id;
END;
$$;

-- Enable RLS on user_sessions
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_sessions
CREATE POLICY "Users can view their own sessions" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sessions" ON user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON user_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- Create trigger for updated_at on user_sessions
CREATE TRIGGER update_user_sessions_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add user tracking columns to run_of_show_data table
ALTER TABLE run_of_show_data
ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_modified_by_name text,
ADD COLUMN IF NOT EXISTS last_modified_by_role text;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_event 
ON user_sessions (user_id, event_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_event 
ON user_sessions (event_id);

CREATE INDEX IF NOT EXISTS idx_run_of_show_data_last_modified_by 
ON run_of_show_data (last_modified_by);

-- Create trigger for updated_at on run_of_show_data (if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_run_of_show_data_updated_at') THEN
    CREATE TRIGGER update_run_of_show_data_updated_at
      BEFORE UPDATE ON run_of_show_data
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON user_sessions TO authenticated;
GRANT ALL ON run_of_show_data TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_user_session(uuid, text, text) TO authenticated;

-- Test data removed - the table will be populated when users actually use the app
