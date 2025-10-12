-- Create scripts table for Scripts Follow page (standalone, not tied to events)
CREATE TABLE IF NOT EXISTS scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_name VARCHAR(255) NOT NULL,
    script_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255)
);

-- Create script_comments table
CREATE TABLE IF NOT EXISTS script_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID NOT NULL,
    line_number INTEGER NOT NULL,
    comment_text TEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_script FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scripts_name ON scripts(script_name);
CREATE INDEX IF NOT EXISTS idx_scripts_created_at ON scripts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_script_comments_script_id ON script_comments(script_id);
CREATE INDEX IF NOT EXISTS idx_script_comments_line_number ON script_comments(script_id, line_number);

-- Add comment
COMMENT ON TABLE scripts IS 'Stores imported scripts for the Scripts Follow feature';
COMMENT ON TABLE script_comments IS 'Stores line-by-line comments for scripts';

