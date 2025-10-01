-- Complete fix for log_change function overloading issue
-- This will drop ALL existing log_change functions and create a single definitive one

-- Drop ALL existing log_change functions to avoid any overloading conflicts
DROP FUNCTION IF EXISTS log_change CASCADE;

-- Create the definitive log_change function with the correct signature
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
    p_metadata JSONB DEFAULT '{}',
    p_row_number INTEGER DEFAULT NULL,
    p_cue_number INTEGER DEFAULT NULL
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
        metadata,
        row_number,
        cue_number
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
        p_metadata,
        p_row_number,
        p_cue_number
    ) RETURNING id INTO change_id;
    
    RETURN change_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION log_change TO authenticated;
GRANT EXECUTE ON FUNCTION log_change TO anon;

