-- Complete setup script for user sessions and change log tracking
-- Run this in your Supabase SQL editor

-- ==============================================
-- USER SESSIONS SETUP
-- ==============================================

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL, -- Using TEXT to match existing data
    user_role VARCHAR(20) NOT NULL CHECK (user_role IN ('VIEWER', 'EDITOR', 'OPERATOR')),
    session_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for user_sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_event_id ON user_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);

-- Enable RLS for user_sessions
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can create their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON user_sessions;
DROP POLICY IF EXISTS "Users can delete their own sessions" ON user_sessions;

-- Create RLS policies for user_sessions
CREATE POLICY "Users can view their own sessions" ON user_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions" ON user_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON user_sessions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions" ON user_sessions
    FOR DELETE USING (auth.uid() = user_id);

-- ==============================================
-- CHANGE LOG SETUP
-- ==============================================

-- Create change_log table
CREATE TABLE IF NOT EXISTS change_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_name VARCHAR(255) NOT NULL,
    user_role VARCHAR(20) NOT NULL CHECK (user_role IN ('VIEWER', 'EDITOR', 'OPERATOR')),
    action VARCHAR(20) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'MOVE', 'DUPLICATE')),
    table_name VARCHAR(100) NOT NULL,
    record_id VARCHAR(100),
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for change_log
CREATE INDEX IF NOT EXISTS idx_change_log_event_id ON change_log(event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_id ON change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON change_log(action);
CREATE INDEX IF NOT EXISTS idx_change_log_table_name ON change_log(table_name);
CREATE INDEX IF NOT EXISTS idx_change_log_record_id ON change_log(record_id);

-- Enable RLS for change_log
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view change logs for their events" ON change_log;
DROP POLICY IF EXISTS "Users can create change logs for their events" ON change_log;

-- Create RLS policies for change_log
CREATE POLICY "Users can view change logs for their events" ON change_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id::TEXT = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

CREATE POLICY "Users can create change logs for their events" ON change_log
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id::TEXT = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

-- ==============================================
-- FUNCTIONS
-- ==============================================

-- User Sessions Functions
CREATE OR REPLACE FUNCTION get_or_create_user_session(
    p_user_id UUID,
    p_event_id TEXT,
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

CREATE OR REPLACE FUNCTION get_current_user_session(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    event_id TEXT,
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

CREATE OR REPLACE FUNCTION update_user_activity(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE user_sessions
    SET last_activity_at = NOW(), updated_at = NOW()
    WHERE user_id = p_user_id AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

-- Change Log Functions
CREATE OR REPLACE FUNCTION log_change(
    p_event_id TEXT,
    p_user_id UUID,
    p_user_name VARCHAR(255),
    p_user_role VARCHAR(20),
    p_action VARCHAR(20),
    p_table_name VARCHAR(100),
    p_record_id VARCHAR(100) DEFAULT NULL,
    p_field_name VARCHAR(100) DEFAULT NULL,
    p_old_value TEXT DEFAULT NULL,
    p_new_value TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    change_id UUID;
BEGIN
    INSERT INTO change_log (
        event_id,
        user_id,
        user_name,
        user_role,
        action,
        table_name,
        record_id,
        field_name,
        old_value,
        new_value,
        description,
        metadata
    ) VALUES (
        p_event_id,
        p_user_id,
        p_user_name,
        p_user_role,
        p_action,
        p_table_name,
        p_record_id,
        p_field_name,
        p_old_value,
        p_new_value,
        p_description,
        p_metadata
    ) RETURNING id INTO change_id;
    
    RETURN change_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_change_log(
    p_event_id TEXT,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    user_name VARCHAR(255),
    user_role VARCHAR(20),
    action VARCHAR(20),
    table_name VARCHAR(100),
    record_id VARCHAR(100),
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cl.id,
        cl.user_name,
        cl.user_role,
        cl.action,
        cl.table_name,
        cl.record_id,
        cl.field_name,
        cl.old_value,
        cl.new_value,
        cl.description,
        cl.metadata,
        cl.created_at
    FROM change_log cl
    WHERE cl.event_id = p_event_id
    ORDER BY cl.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- TRIGGERS
-- ==============================================

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for user_sessions
CREATE TRIGGER update_user_sessions_updated_at 
    BEFORE UPDATE ON user_sessions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
