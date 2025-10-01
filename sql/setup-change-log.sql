-- Quick setup script for change log tracking
-- Run this in your Supabase SQL editor

-- Create change_log table
CREATE TABLE IF NOT EXISTS change_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL,
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_change_log_event_id ON change_log(event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_id ON change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON change_log(action);
CREATE INDEX IF NOT EXISTS idx_change_log_table_name ON change_log(table_name);
CREATE INDEX IF NOT EXISTS idx_change_log_record_id ON change_log(record_id);

-- Enable RLS
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view change logs for their events" ON change_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

CREATE POLICY "Users can create change logs for their events" ON change_log
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

-- Create the main logging function
CREATE OR REPLACE FUNCTION log_change(
    p_event_id UUID,
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

-- Create function to get change log
CREATE OR REPLACE FUNCTION get_change_log(
    p_event_id UUID,
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
