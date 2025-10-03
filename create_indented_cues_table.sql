-- Create indented_cues table
CREATE TABLE indented_cues (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Event and item identification
    event_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    parent_item_id TEXT NOT NULL,
    
    -- User information
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    user_role TEXT NOT NULL,
    
    -- Indentation info
    indented_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Create indexes
CREATE INDEX idx_indented_cues_event_id ON indented_cues(event_id);
CREATE INDEX idx_indented_cues_item_id ON indented_cues(item_id);
CREATE INDEX idx_indented_cues_parent_item_id ON indented_cues(parent_item_id);

-- Add updated_at trigger
CREATE TRIGGER update_indented_cues_updated_at BEFORE UPDATE ON indented_cues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON TABLE indented_cues TO public;
GRANT ALL ON TABLE indented_cues TO authenticated;
GRANT ALL ON TABLE indented_cues TO service_role;
