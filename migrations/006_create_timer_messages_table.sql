-- Create timer_messages table for storing timer messages
-- This table stores messages that can be triggered during timer events

CREATE TABLE IF NOT EXISTS timer_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Event and message information
    event_id UUID NOT NULL,
    message TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    
    -- User information
    sent_by TEXT NOT NULL,
    sent_by_name TEXT DEFAULT 'Unknown User',
    sent_by_role TEXT DEFAULT 'VIEWER',
    
    -- Message metadata
    message_type TEXT DEFAULT 'general',
    priority INTEGER DEFAULT 2
);

-- Add indexes for performance (only after table is created)
CREATE INDEX IF NOT EXISTS idx_timer_messages_event_id ON timer_messages (event_id);
CREATE INDEX IF NOT EXISTS idx_timer_messages_enabled ON timer_messages (enabled);
CREATE INDEX IF NOT EXISTS idx_timer_messages_created_at ON timer_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timer_messages_sent_by ON timer_messages (sent_by);

-- Create the update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to automatically update updated_at
CREATE TRIGGER update_timer_messages_updated_at 
    BEFORE UPDATE ON timer_messages 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert a test record to verify the table works
INSERT INTO timer_messages (
    event_id,
    message,
    enabled,
    sent_by,
    sent_by_name,
    sent_by_role,
    message_type,
    priority
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Test message',
    true,
    'test-user',
    'Test User',
    'OPERATOR',
    'general',
    2
);

-- Clean up the test record
DELETE FROM timer_messages WHERE event_id = '00000000-0000-0000-0000-000000000001';

-- Verify the table was created correctly
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'timer_messages' 
ORDER BY ordinal_position;
