-- Fixed setup script for user sessions tracking
-- Run this in your Supabase SQL editor

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    user_role VARCHAR(20) NOT NULL CHECK (user_role IN ('VIEWER', 'EDITOR', 'OPERATOR')),
    session_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_event_id ON user_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);

-- Enable RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can create their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can delete their own sessions" ON user_sessions;

-- Create RLS policies
CREATE POLICY "Users can view their own sessions" ON user_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions" ON user_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON user_sessions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions" ON user_sessions
    FOR DELETE USING (auth.uid() = user_id);

-- Create the main function for getting/creating user sessions
CREATE OR REPLACE FUNCTION get_or_create_user_session(
    p_user_id UUID,
    p_event_id UUID,
    p_user_role VARCHAR(20)
)
RETURNS user_sessions AS $$
DECLARE
    session_record user_sessions;
BEGIN
    -- First, deactivate any existing active sessions for this user
    UPDATE user_sessions 
    SET is_active = false, updated_at = NOW()
    WHERE user_id = p_user_id AND is_active = true;
    
    -- Check if there's an existing session for this user and event
    SELECT * INTO session_record
    FROM user_sessions
    WHERE user_id = p_user_id 
    AND event_id = p_event_id 
    AND is_active = false
    ORDER BY updated_at DESC
    LIMIT 1;
    
    -- If session exists, reactivate it with new role
    IF session_record.id IS NOT NULL THEN
        UPDATE user_sessions
        SET 
            user_role = p_user_role,
            is_active = true,
            session_started_at = NOW(),
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE id = session_record.id
        RETURNING * INTO session_record;
    ELSE
        -- Create new session
        INSERT INTO user_sessions (user_id, event_id, user_role, is_active)
        VALUES (p_user_id, p_event_id, p_user_role, true)
        RETURNING * INTO session_record;
    END IF;
    
    RETURN session_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get current user session
CREATE OR REPLACE FUNCTION get_current_user_session(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_role VARCHAR(20),
    session_started_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        us.id,
        us.event_id,
        us.user_role,
        us.session_started_at,
        us.last_activity_at
    FROM user_sessions us
    WHERE us.user_id = p_user_id 
    AND us.is_active = true
    ORDER BY us.updated_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update user activity
CREATE OR REPLACE FUNCTION update_user_activity(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE user_sessions
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE user_id = p_user_id AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to cleanup inactive sessions
CREATE OR REPLACE FUNCTION cleanup_inactive_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    UPDATE user_sessions
    SET is_active = false, updated_at = NOW()
    WHERE is_active = true 
    AND last_activity_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_user_sessions_updated_at 
    BEFORE UPDATE ON user_sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
