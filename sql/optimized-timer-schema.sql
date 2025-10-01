-- Optimized Timer Schema - Single row per event instead of multiple rows
-- This prevents creating new rows every time a timer starts/stops

-- Drop existing tables and functions
DROP TABLE IF EXISTS timer_actions CASCADE;
DROP TABLE IF EXISTS active_timers CASCADE;
DROP FUNCTION IF EXISTS get_active_timer_for_event(UUID);
DROP FUNCTION IF EXISTS stop_all_timers_for_event(UUID, UUID);
DROP FUNCTION IF EXISTS get_recent_timer_actions(UUID);
DROP FUNCTION IF EXISTS cleanup_old_timer_actions();

-- Create optimized active_timers table - ONE ROW PER EVENT
CREATE TABLE active_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE, -- Only one timer per event
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  is_active BOOLEAN DEFAULT false,
  timer_state VARCHAR(20) DEFAULT 'stopped' CHECK (timer_state IN ('loaded', 'running', 'stopped')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_active_timers_event_id ON active_timers(event_id);
CREATE INDEX idx_active_timers_is_active ON active_timers(is_active);
CREATE INDEX idx_active_timers_timer_state ON active_timers(timer_state);

-- Create sub_cue_timers table for indented items
CREATE TABLE sub_cue_timers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  is_active BOOLEAN DEFAULT false,
  timer_state VARCHAR(20) DEFAULT 'stopped' CHECK (timer_state IN ('loaded', 'running', 'stopped')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, item_id) -- Only one sub-cue timer per item per event
);

-- Create indexes for sub_cue_timers
CREATE INDEX idx_sub_cue_timers_event_id ON sub_cue_timers(event_id);
CREATE INDEX idx_sub_cue_timers_item_id ON sub_cue_timers(item_id);
CREATE INDEX idx_sub_cue_timers_is_active ON sub_cue_timers(is_active);
CREATE INDEX idx_sub_cue_timers_timer_state ON sub_cue_timers(timer_state);

-- Enable RLS
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view active timers for their events" ON active_timers
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert/update active timers for their events" ON active_timers
  FOR ALL USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Enable RLS for sub_cue_timers
ALTER TABLE sub_cue_timers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sub_cue_timers
CREATE POLICY "Users can view sub-cue timers for their events" ON sub_cue_timers
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert/update sub-cue timers for their events" ON sub_cue_timers
  FOR ALL USING (
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

-- Function to get current active timer for an event (including loaded but not started)
CREATE OR REPLACE FUNCTION get_active_timer_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  elapsed_seconds BIGINT,
  remaining_seconds BIGINT,
  is_active BOOLEAN,
  timer_state VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.id,
    at.item_id,
    at.user_id,
    at.started_at,
    at.duration_seconds,
    CASE 
      WHEN at.timer_state = 'running' AND at.started_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (NOW() - at.started_at))::BIGINT 
      ELSE 0 
    END as elapsed_seconds,
    CASE 
      WHEN at.timer_state = 'running' AND at.started_at IS NOT NULL AND at.duration_seconds IS NOT NULL
      THEN GREATEST(0, at.duration_seconds - EXTRACT(EPOCH FROM (NOW() - at.started_at))::BIGINT)
      ELSE 0 
    END as remaining_seconds,
    at.is_active,
    at.timer_state
  FROM active_timers at
  WHERE at.event_id = p_event_id
    AND at.timer_state IN ('loaded', 'running');
END;
$$ LANGUAGE plpgsql;

-- Function to load CUE (set loaded but not started)
CREATE OR REPLACE FUNCTION load_cue_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO active_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NULL, p_duration_seconds, false, 'loaded')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    started_at = NULL,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = false,
    timer_state = 'loaded',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to start timer (upsert - insert or update)
CREATE OR REPLACE FUNCTION start_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO active_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NOW(), p_duration_seconds, true, 'running')
  ON CONFLICT (event_id) 
  DO UPDATE SET
    item_id = EXCLUDED.item_id,
    user_id = EXCLUDED.user_id,
    started_at = EXCLUDED.started_at,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = EXCLUDED.is_active,
    timer_state = 'running',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to stop timer
CREATE OR REPLACE FUNCTION stop_timer_for_event(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE active_timers 
  SET is_active = false, timer_state = 'stopped', updated_at = NOW()
  WHERE event_id = p_event_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get active sub-cue timers for an event
CREATE OR REPLACE FUNCTION get_active_sub_cue_timers_for_event(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  item_id BIGINT,
  user_id UUID,
  started_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  elapsed_seconds BIGINT,
  remaining_seconds BIGINT,
  is_active BOOLEAN,
  timer_state VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sct.id,
    sct.item_id,
    sct.user_id,
    sct.started_at,
    sct.duration_seconds,
    CASE 
      WHEN sct.timer_state = 'running' AND sct.started_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (NOW() - sct.started_at))::BIGINT 
      ELSE 0 
    END as elapsed_seconds,
    CASE 
      WHEN sct.timer_state = 'running' AND sct.started_at IS NOT NULL AND sct.duration_seconds IS NOT NULL
      THEN GREATEST(0, sct.duration_seconds - EXTRACT(EPOCH FROM (NOW() - sct.started_at))::BIGINT)
      ELSE 0 
    END as remaining_seconds,
    sct.is_active,
    sct.timer_state
  FROM sub_cue_timers sct
  WHERE sct.event_id = p_event_id
    AND sct.timer_state IN ('loaded', 'running');
END;
$$ LANGUAGE plpgsql;

-- Function to start sub-cue timer
CREATE OR REPLACE FUNCTION start_sub_cue_timer_for_event(
  p_event_id UUID, 
  p_item_id BIGINT, 
  p_user_id UUID, 
  p_duration_seconds INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO sub_cue_timers (event_id, item_id, user_id, started_at, duration_seconds, is_active, timer_state)
  VALUES (p_event_id, p_item_id, p_user_id, NOW(), p_duration_seconds, true, 'running')
  ON CONFLICT (event_id, item_id) 
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    started_at = EXCLUDED.started_at,
    duration_seconds = EXCLUDED.duration_seconds,
    is_active = EXCLUDED.is_active,
    timer_state = 'running',
    updated_at = NOW();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to stop sub-cue timer
CREATE OR REPLACE FUNCTION stop_sub_cue_timer_for_event(p_event_id UUID, p_item_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE sub_cue_timers 
  SET is_active = false, timer_state = 'stopped', updated_at = NOW()
  WHERE event_id = p_event_id AND item_id = p_item_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create timer_actions table for real-time notifications
CREATE TABLE timer_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action_type VARCHAR(50) NOT NULL, -- 'LOAD_CUE', 'START_TIMER', 'STOP_TIMER', 'ADJUST_TIME', 'STATE_CHANGE'
  item_id BIGINT,
  duration_seconds INTEGER,
  timer_state VARCHAR(20), -- 'loaded', 'running', 'stopped'
  action_timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_timer_actions_event_id ON timer_actions(event_id);
CREATE INDEX idx_timer_actions_timestamp ON timer_actions(action_timestamp);

-- Enable RLS
ALTER TABLE timer_actions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view timer actions for their events" ON timer_actions
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert timer actions for their events" ON timer_actions
  FOR INSERT WITH CHECK (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Function to clean up old timer actions
CREATE OR REPLACE FUNCTION cleanup_old_timer_actions()
RETURNS void AS $$
BEGIN
  DELETE FROM timer_actions 
  WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
