-- Active Timers Table for Real-time Timer Synchronization
-- This table stores active timer states with server timestamps for accurate cross-client sync
-- Simplified version that works without a separate events table

CREATE TABLE IF NOT EXISTS active_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL, -- References the run of show/event (no foreign key constraint)
  item_id BIGINT NOT NULL, -- Changed from INTEGER to BIGINT to handle timestamp-based IDs
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_duration_seconds INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_item_id ON active_timers(item_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_user_id ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_is_active ON active_timers(is_active);
CREATE INDEX IF NOT EXISTS idx_active_timers_started_at ON active_timers(started_at);

-- RLS (Row Level Security) policies
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see timers for events they have access to
CREATE POLICY "Users can view active timers for their events" ON active_timers
  FOR SELECT USING (
    event_id IN (
      SELECT event_id::UUID FROM user_sessions 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Policy: Users can insert their own timer
CREATE POLICY "Users can create active timers" ON active_timers
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own timers
CREATE POLICY "Users can update their own timers" ON active_timers
  FOR UPDATE USING (user_id = auth.uid());

-- Policy: Users can delete their own timers
CREATE POLICY "Users can delete their own timers" ON active_timers
  FOR DELETE USING (user_id = auth.uid());

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_active_timers_updated_at 
  BEFORE UPDATE ON active_timers 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get current active timer for an event
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT, -- Changed from INTEGER to BIGINT
  user_id UUID,
  started_at TIMESTAMPTZ,
  total_duration_seconds INTEGER,
  elapsed_seconds INTEGER,
  remaining_seconds INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.id,
    at.item_id,
    at.user_id,
    at.started_at,
    at.total_duration_seconds,
    EXTRACT(EPOCH FROM (NOW() - at.started_at))::INTEGER as elapsed_seconds,
    GREATEST(0, at.total_duration_seconds - EXTRACT(EPOCH FROM (NOW() - at.started_at))::INTEGER) as remaining_seconds
  FROM active_timers at
  WHERE at.event_id = p_event_id 
    AND at.is_active = true
  ORDER BY at.started_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to stop all timers for an event (when a new one starts)
CREATE OR REPLACE FUNCTION stop_all_timers_for_event(p_event_id UUID, p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE active_timers 
  SET is_active = false, updated_at = NOW()
  WHERE event_id = p_event_id 
    AND is_active = true
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
