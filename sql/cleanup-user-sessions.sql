-- Clean up conflicting user session functions
-- This script removes the conflicting function definitions

-- Drop the conflicting functions
DROP FUNCTION IF EXISTS get_or_create_user_session(uuid, text, character varying);
DROP FUNCTION IF EXISTS get_or_create_user_session(uuid, uuid, character varying);

-- Drop the user_sessions table if it exists
DROP TABLE IF EXISTS user_sessions CASCADE;

-- Recreate the user_sessions table with consistent types
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

-- Create a single, consistent function
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
  
  -- Try to find existing session
  SELECT id INTO v_session_id
  FROM user_sessions
  WHERE user_id = p_user_id AND event_id = p_event_id;
  
  IF v_session_id IS NOT NULL THEN
    -- Update existing session
    UPDATE user_sessions
    SET user_role = p_user_role,
        last_activity = now(),
        updated_at = now()
    WHERE id = v_session_id;
  ELSE
    -- Create new session
    INSERT INTO user_sessions (user_id, event_id, username, user_role)
    VALUES (p_user_id, p_event_id, COALESCE(v_username, 'Unknown User'), p_user_role)
    RETURNING id INTO v_session_id;
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

-- Create RLS policies
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

CREATE TRIGGER update_user_sessions_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
