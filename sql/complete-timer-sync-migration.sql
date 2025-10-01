-- Complete Timer Synchronization Migration
-- This script sets up both active timers and timer actions for full cross-client sync

-- Drop existing tables and functions to start fresh
DROP TABLE IF EXISTS timer_actions CASCADE;
DROP TABLE IF EXISTS active_timers CASCADE;
DROP FUNCTION IF EXISTS get_active_timer_for_event(UUID);
DROP FUNCTION IF EXISTS stop_all_timers_for_event(UUID, UUID);
DROP FUNCTION IF EXISTS get_recent_timer_actions(UUID);
DROP FUNCTION IF EXISTS cleanup_old_timer_actions();

-- Create active_timers table
CREATE TABLE active_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for active_timers
CREATE INDEX idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX idx_active_timers_user_id ON active_timers(user_id);
CREATE INDEX idx_active_timers_is_active ON active_timers(is_active);

-- Enable RLS for active_timers
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for active_timers
CREATE POLICY "Users can view active timers for their events" ON active_timers
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Create RLS policy for inserting active timers
CREATE POLICY "Users can insert active timers for their events" ON active_timers
  FOR INSERT WITH CHECK (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Create RLS policy for updating active timers
CREATE POLICY "Users can update active timers for their events" ON active_timers
  FOR UPDATE USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Create RLS policy for deleting active timers
CREATE POLICY "Users can delete active timers for their events" ON active_timers
  FOR DELETE USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Create trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_active_timers_updated_at
  BEFORE UPDATE ON active_timers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to get current active timer for an event
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  elapsed_seconds BIGINT,
  remaining_seconds BIGINT,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.id,
    at.item_id,
    at.user_id,
    at.started_at,
    at.duration_seconds,
    EXTRACT(EPOCH FROM (NOW() - at.started_at))::BIGINT as elapsed_seconds,
    GREATEST(0, at.duration_seconds - EXTRACT(EPOCH FROM (NOW() - at.started_at))::BIGINT) as remaining_seconds,
    at.is_active
  FROM active_timers at
  WHERE at.event_id = p_event_id
    AND at.is_active = true
  ORDER BY at.started_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to stop all timers for an event (when a new one starts)
CREATE OR REPLACE FUNCTION stop_all_timers_for_event(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE active_timers 
  SET is_active = false, updated_at = NOW()
  WHERE event_id = p_event_id 
    AND is_active = true;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create timer_actions table for broadcasting timer actions across clients
CREATE TABLE timer_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- 'LOAD_CUE', 'START_TIMER', 'STOP_TIMER', 'ADJUST_TIME'
  item_id BIGINT,
  duration_seconds INTEGER,
  action_timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient queries
CREATE INDEX idx_timer_actions_event_id ON timer_actions(event_id);
CREATE INDEX idx_timer_actions_timestamp ON timer_actions(action_timestamp);

-- Enable RLS for timer_actions
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
  action_timestamp TIMESTAMPTZ,
  user_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ta.id,
    ta.action_type,
    ta.item_id,
    ta.duration_seconds,
    ta.action_timestamp,
    ta.user_id
  FROM timer_actions ta
  WHERE ta.event_id = p_event_id
    AND ta.action_timestamp > NOW() - INTERVAL '5 minutes'
  ORDER BY ta.action_timestamp DESC;
END;
$$ LANGUAGE plpgsql;
