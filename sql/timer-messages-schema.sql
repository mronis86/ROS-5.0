-- Timer Messages Table Schema
-- This table stores messages that can be displayed on the full screen timer
-- Messages are linked to specific run of show events

CREATE TABLE IF NOT EXISTS timer_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Link to the run of show event
  event_id TEXT NOT NULL,
  
  -- Message content
  message TEXT NOT NULL,
  
  -- Message status
  enabled BOOLEAN DEFAULT true,
  
  -- Who sent the message
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_by_name TEXT,
  sent_by_role TEXT,
  
  -- Message metadata
  message_type TEXT DEFAULT 'general', -- 'general', 'urgent', 'info', 'warning'
  priority INTEGER DEFAULT 1, -- 1=low, 2=medium, 3=high, 4=urgent
  
  -- Expiration (optional)
  expires_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT timer_messages_message_not_empty CHECK (LENGTH(TRIM(message)) > 0),
  CONSTRAINT timer_messages_priority_range CHECK (priority >= 1 AND priority <= 4)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_timer_messages_event_id ON timer_messages(event_id);
CREATE INDEX IF NOT EXISTS idx_timer_messages_enabled ON timer_messages(enabled);
CREATE INDEX IF NOT EXISTS idx_timer_messages_created_at ON timer_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timer_messages_event_enabled ON timer_messages(event_id, enabled);

-- Create a composite index for the most common query
CREATE INDEX IF NOT EXISTS idx_timer_messages_event_enabled_created 
ON timer_messages(event_id, enabled, created_at DESC);

-- Add RLS (Row Level Security) policies
ALTER TABLE timer_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read messages for events they have access to
CREATE POLICY "Users can read timer messages for their events" ON timer_messages
  FOR SELECT USING (
    event_id IN (
      SELECT event_id FROM user_sessions 
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can insert messages for events they have access to
CREATE POLICY "Users can insert timer messages for their events" ON timer_messages
  FOR INSERT WITH CHECK (
    event_id IN (
      SELECT event_id FROM user_sessions 
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can update messages they sent or if they're editors/operators
CREATE POLICY "Users can update timer messages" ON timer_messages
  FOR UPDATE USING (
    sent_by = auth.uid() OR
    event_id IN (
      SELECT event_id FROM user_sessions 
      WHERE user_id = auth.uid() 
      AND user_role IN ('EDITOR', 'OPERATOR')
    )
  );

-- Policy: Users can delete messages they sent or if they're editors/operators
CREATE POLICY "Users can delete timer messages" ON timer_messages
  FOR DELETE USING (
    sent_by = auth.uid() OR
    event_id IN (
      SELECT event_id FROM user_sessions 
      WHERE user_id = auth.uid() 
      AND user_role IN ('EDITOR', 'OPERATOR')
    )
  );

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timer_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_timer_messages_updated_at
  BEFORE UPDATE ON timer_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_timer_messages_updated_at();

-- Create a function to get the latest active message for an event
CREATE OR REPLACE FUNCTION get_latest_timer_message(p_event_id TEXT)
RETURNS TABLE (
  id UUID,
  message TEXT,
  enabled BOOLEAN,
  sent_by_name TEXT,
  sent_by_role TEXT,
  message_type TEXT,
  priority INTEGER,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tm.id,
    tm.message,
    tm.enabled,
    tm.sent_by_name,
    tm.sent_by_role,
    tm.message_type,
    tm.priority,
    tm.created_at
  FROM timer_messages tm
  WHERE tm.event_id = p_event_id
    AND tm.enabled = true
    AND (tm.expires_at IS NULL OR tm.expires_at > NOW())
  ORDER BY tm.priority DESC, tm.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to disable expired messages
CREATE OR REPLACE FUNCTION disable_expired_timer_messages()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE timer_messages 
  SET enabled = false, updated_at = NOW()
  WHERE enabled = true 
    AND expires_at IS NOT NULL 
    AND expires_at <= NOW();
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON timer_messages TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_latest_timer_message(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION disable_expired_timer_messages() TO anon, authenticated;

-- Insert some sample data (optional - remove in production)
-- INSERT INTO timer_messages (event_id, message, sent_by_name, sent_by_role, message_type, priority)
-- VALUES 
--   ('sample-event-1', 'Welcome to the show!', 'System', 'SYSTEM', 'info', 1),
--   ('sample-event-1', 'URGENT: Technical difficulties', 'John Doe', 'OPERATOR', 'urgent', 4),
--   ('sample-event-1', 'Break in 5 minutes', 'Jane Smith', 'EDITOR', 'info', 2);

COMMENT ON TABLE timer_messages IS 'Stores messages that can be displayed on the full screen timer';
COMMENT ON COLUMN timer_messages.event_id IS 'Links to the run of show event';
COMMENT ON COLUMN timer_messages.message IS 'The message text to display';
COMMENT ON COLUMN timer_messages.enabled IS 'Whether the message is currently active';
COMMENT ON COLUMN timer_messages.sent_by IS 'User ID of who sent the message';
COMMENT ON COLUMN timer_messages.sent_by_name IS 'Display name of who sent the message';
COMMENT ON COLUMN timer_messages.sent_by_role IS 'Role of who sent the message';
COMMENT ON COLUMN timer_messages.message_type IS 'Type of message: general, urgent, info, warning';
COMMENT ON COLUMN timer_messages.priority IS 'Priority level: 1=low, 2=medium, 3=high, 4=urgent';
COMMENT ON COLUMN timer_messages.expires_at IS 'Optional expiration time for the message';

