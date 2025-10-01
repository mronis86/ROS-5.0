-- Simple User Tracking System
-- Tracks which authenticated user opened which run of show with what role

-- Create the user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  username text NOT NULL,
  user_role text NOT NULL,
  last_activity timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create a simple function to get or create user session
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

-- Enable RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Create simple RLS policies (drop existing ones first)
DROP POLICY IF EXISTS "Users can view their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can insert their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON user_sessions;

CREATE POLICY "Users can view their own sessions" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sessions" ON user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON user_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_sessions_updated_at ON user_sessions;
CREATE TRIGGER update_user_sessions_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add user tracking columns to run_of_show_data table
ALTER TABLE run_of_show_data
ADD COLUMN IF NOT EXISTS last_modified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_modified_by_name text,
ADD COLUMN IF NOT EXISTS last_modified_by_role text;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_run_of_show_data_last_modified_by 
ON run_of_show_data (last_modified_by);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_event 
ON user_sessions (user_id, event_id);
