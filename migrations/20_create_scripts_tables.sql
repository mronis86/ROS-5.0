-- Alter existing script_comments table to add comment_type column
-- Run this if the table already exists
ALTER TABLE script_comments 
ADD COLUMN IF NOT EXISTS comment_type VARCHAR(50) DEFAULT 'GENERAL';

-- Add constraint to validate comment types
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_comment_type'
    ) THEN
        ALTER TABLE script_comments 
        ADD CONSTRAINT check_comment_type 
        CHECK (comment_type IN ('GENERAL', 'CUE', 'AUDIO', 'GFX', 'VIDEO', 'LIGHTING'));
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scripts_name ON scripts(script_name);
CREATE INDEX IF NOT EXISTS idx_scripts_created_at ON scripts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_script_comments_script_id ON script_comments(script_id);
CREATE INDEX IF NOT EXISTS idx_script_comments_line_number ON script_comments(script_id, line_number);

-- Add comment
COMMENT ON TABLE scripts IS 'Stores imported scripts for the Scripts Follow feature';
COMMENT ON TABLE script_comments IS 'Stores line-by-line comments for scripts';

