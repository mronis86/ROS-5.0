-- Create scripts table for Scripts Follow page
CREATE TABLE IF NOT EXISTS scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL,
    script_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255),
    CONSTRAINT fk_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Create script_comments table
CREATE TABLE IF NOT EXISTS script_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID NOT NULL,
    event_id UUID NOT NULL,
    line_number INTEGER NOT NULL,
    comment_text TEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_script FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE,
    CONSTRAINT fk_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scripts_event_id ON scripts(event_id);
CREATE INDEX IF NOT EXISTS idx_script_comments_script_id ON script_comments(script_id);
CREATE INDEX IF NOT EXISTS idx_script_comments_event_id ON script_comments(event_id);
CREATE INDEX IF NOT EXISTS idx_script_comments_line_number ON script_comments(script_id, line_number);

-- Add comment
COMMENT ON TABLE scripts IS 'Stores imported scripts for the Scripts Follow feature';
COMMENT ON TABLE script_comments IS 'Stores line-by-line comments for scripts';

