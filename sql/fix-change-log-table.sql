-- Fix change_log table to include missing columns
-- This will add the missing columns if they don't exist

-- Add table_name column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'table_name'
    ) THEN
        ALTER TABLE change_log ADD COLUMN table_name VARCHAR(100);
    END IF;
END $$;

-- Add record_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'record_id'
    ) THEN
        ALTER TABLE change_log ADD COLUMN record_id VARCHAR(100);
    END IF;
END $$;

-- Add field_name column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'field_name'
    ) THEN
        ALTER TABLE change_log ADD COLUMN field_name VARCHAR(100);
    END IF;
END $$;

-- Add old_value column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'old_value'
    ) THEN
        ALTER TABLE change_log ADD COLUMN old_value TEXT;
    END IF;
END $$;

-- Add new_value column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'new_value'
    ) THEN
        ALTER TABLE change_log ADD COLUMN new_value TEXT;
    END IF;
END $$;

-- Add description column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE change_log ADD COLUMN description TEXT;
    END IF;
END $$;

-- Add metadata column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE change_log ADD COLUMN metadata JSONB DEFAULT '{}';
    END IF;
END $$;

-- Add row_number column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'row_number'
    ) THEN
        ALTER TABLE change_log ADD COLUMN row_number INTEGER;
    END IF;
END $$;

-- Add cue_number column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'change_log' 
        AND column_name = 'cue_number'
    ) THEN
        ALTER TABLE change_log ADD COLUMN cue_number INTEGER;
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_change_log_table_name ON change_log(table_name);
CREATE INDEX IF NOT EXISTS idx_change_log_record_id ON change_log(record_id);

-- Update the log_change function to match the schema
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