-- Create timer_actions table for broadcasting timer actions across clients
CREATE TABLE IF NOT EXISTS timer_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- 'LOAD_CUE', 'START_TIMER', 'STOP_TIMER', 'ADJUST_TIME'
  item_id BIGINT,
  duration_seconds INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient queries
CREATE INDEX IF EXISTS idx_timer_actions_event_id ON timer_actions(event_id);
CREATE INDEX IF EXISTS idx_timer_actions_timestamp ON timer_actions(timestamp);

-- Enable RLS
ALTER TABLE timer_actions ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for timer_actions
CREATE POLICY "Users can view timer actions for their events" ON timer_actions
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Create RLS policy for inserting timer actions
CREATE POLICY "Users can insert timer actions for their events" ON timer_actions
  FOR INSERT WITH CHECK (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Create function to clean up old timer actions (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_timer_actions()
RETURNS void AS $$
BEGIN
  DELETE FROM timer_actions 
  WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Create function to get recent timer actions for an event
CREATE OR REPLACE FUNCTION get_recent_timer_actions(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  action_type VARCHAR(50),
  item_id BIGINT,
  duration_seconds INTEGER,
  timestamp TIMESTAMPTZ,
  user_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ta.id,
    ta.action_type,
    ta.item_id,
    ta.duration_seconds,
    ta.timestamp,
    ta.user_id
  FROM timer_actions ta
  WHERE ta.event_id = p_event_id
    AND ta.timestamp > NOW() - INTERVAL '5 minutes'
  ORDER BY ta.timestamp DESC;
END;
$$ LANGUAGE plpgsql;

