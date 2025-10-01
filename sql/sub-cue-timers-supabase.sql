-- Sub-Cue Timers for Supabase
-- Simple table to track secondary timers in real-time

-- Create sub_cue_timers table
CREATE TABLE IF NOT EXISTS sub_cue_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  duration_seconds INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_item_id ON sub_cue_timers(item_id);
CREATE INDEX IF NOT EXISTS idx_sub_cue_timers_is_active ON sub_cue_timers(is_active);

-- Enable RLS
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;

-- RLS Policy - allow authenticated users to access sub_cue_timers
DROP POLICY IF EXISTS "Users can view sub_cue_timers for their events" ON sub_cue_timers;
CREATE POLICY "Users can view sub_cue_timers for their events" ON sub_cue_timers
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Function to check if there's an active sub-cue timer for an event
CREATE OR REPLACE FUNCTION has_active_sub_cue_timer_for_event(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM sub_cue_timers 
    WHERE event_id = p_event_id AND is_active = true
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get active sub-cue timer for an event
CREATE OR REPLACE FUNCTION get_active_sub_cue_timer_for_event(p_event_id UUID)
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
    sct.id,
    sct.item_id,
    sct.user_id,
    sct.started_at,
    sct.duration_seconds,
    EXTRACT(EPOCH FROM (NOW() - sct.started_at))::BIGINT as elapsed_seconds,
    GREATEST(0, sct.duration_seconds - EXTRACT(EPOCH FROM (NOW() - sct.started_at))::BIGINT) as remaining_seconds,
    sct.is_active
  FROM sub_cue_timers sct
  WHERE sct.event_id = p_event_id
    AND sct.is_active = true
  ORDER BY sct.started_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to start a sub-cue timer
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(
  p_event_id UUID,
  p_item_id BIGINT,
  p_user_id UUID,
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Stop any existing sub-cue timers for this event
  UPDATE sub_cue_timers 
  SET is_active = false
  WHERE event_id = p_event_id AND is_active = true;
  
  -- Insert new sub-cue timer
  INSERT INTO sub_cue_timers (event_id, item_id, user_id, duration_seconds, started_at, is_active)
  VALUES (p_event_id, p_item_id, p_user_id, p_duration_seconds, NOW(), true);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to stop sub-cue timer
CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(
  p_event_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE sub_cue_timers 
  SET is_active = false
  WHERE event_id = p_event_id AND is_active = true;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to expire completed sub-cue timers (set is_active = false when time is up)
CREATE OR REPLACE FUNCTION expire_completed_sub_cue_timers()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE sub_cue_timers 
  SET is_active = false
  WHERE is_active = true 
    AND (EXTRACT(EPOCH FROM (NOW() - started_at))::BIGINT) >= duration_seconds;
  
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL ON sub_cue_timers TO authenticated;
GRANT EXECUTE ON FUNCTION has_active_sub_cue_timer_for_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_sub_cue_timer_for_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION start_sub_cue_timer_for_event(UUID, BIGINT, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_sub_cue_timer_for_event(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION expire_completed_sub_cue_timers() TO authenticated;

SELECT 'Sub-cue timers setup complete!' as status;
