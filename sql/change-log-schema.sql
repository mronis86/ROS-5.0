-- Change Log Schema for Tracking Row Modifications
-- This tracks who made what changes to schedule items and other data

-- Create change_log table to track all modifications
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

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_change_log_event_id ON change_log(event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_id ON change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON change_log(action);
CREATE INDEX IF NOT EXISTS idx_change_log_table_name ON change_log(table_name);
CREATE INDEX IF NOT EXISTS idx_change_log_record_id ON change_log(record_id);

-- Enable Row Level Security
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view change logs for events they have access to
CREATE POLICY "Users can view change logs for their events" ON change_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

-- Users can insert change logs for events they have access to
CREATE POLICY "Users can create change logs for their events" ON change_log
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

-- Users can delete change logs for events they have access to
CREATE POLICY "Users can delete change logs for their events" ON change_log
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id = change_log.event_id
            AND user_sessions.is_active = true
        )
    );

-- Function to log a change
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

-- Function to get change log for an event
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

-- Function to get change log for a specific record
CREATE OR REPLACE FUNCTION get_record_change_log(
    p_event_id UUID,
    p_table_name VARCHAR(100),
    p_record_id VARCHAR(100),
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id UUID,
    user_name VARCHAR(255),
    user_role VARCHAR(20),
    action VARCHAR(20),
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cl.id,
        cl.user_name,
        cl.user_role,
        cl.action,
        cl.field_name,
        cl.old_value,
        cl.new_value,
        cl.description,
        cl.created_at
    FROM change_log cl
    WHERE cl.event_id = p_event_id
    AND cl.table_name = p_table_name
    AND cl.record_id = p_record_id
    ORDER BY cl.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get change log summary for an event
CREATE OR REPLACE FUNCTION get_change_log_summary(p_event_id UUID)
RETURNS TABLE (
    total_changes BIGINT,
    unique_users BIGINT,
    last_activity TIMESTAMP WITH TIME ZONE,
    changes_by_action JSONB,
    changes_by_user JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_changes,
        COUNT(DISTINCT user_id) as unique_users,
        MAX(created_at) as last_activity,
        jsonb_object_agg(action, action_count) as changes_by_action,
        jsonb_object_agg(user_name, user_count) as changes_by_user
    FROM (
        SELECT 
            action,
            user_name,
            COUNT(*) as action_count,
            COUNT(*) OVER (PARTITION BY user_name) as user_count
        FROM change_log
        WHERE event_id = p_event_id
        GROUP BY action, user_name
    ) summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old change logs (older than 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_change_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM change_log
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a view for easy change log querying
CREATE OR REPLACE VIEW change_log_view AS
SELECT 
    cl.id,
    cl.event_id,
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
    cl.created_at,
    CASE 
        WHEN cl.action = 'CREATE' THEN 'Created'
        WHEN cl.action = 'UPDATE' THEN 'Updated'
        WHEN cl.action = 'DELETE' THEN 'Deleted'
        WHEN cl.action = 'MOVE' THEN 'Moved'
        WHEN cl.action = 'DUPLICATE' THEN 'Duplicated'
        ELSE cl.action
    END as action_display,
    CASE 
        WHEN cl.table_name = 'schedule_items' THEN 'Schedule Item'
        WHEN cl.table_name = 'custom_columns' THEN 'Custom Column'
        WHEN cl.table_name = 'settings' THEN 'Settings'
        ELSE cl.table_name
    END as table_display
FROM change_log cl;
