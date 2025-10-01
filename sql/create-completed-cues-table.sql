-- Create completed_cues table to track which rows have been finished
-- This ensures all clients can see which cues are completed

CREATE TABLE IF NOT EXISTS completed_cues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL,
  item_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, item_id) -- Only one completion record per cue per event
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_completed_cues_event_id ON completed_cues(event_id);
CREATE INDEX IF NOT EXISTS idx_completed_cues_item_id ON completed_cues(item_id);
CREATE INDEX IF NOT EXISTS idx_completed_cues_completed_at ON completed_cues(completed_at);

-- Enable RLS
ALTER TABLE completed_cues ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view completed cues for their events" ON completed_cues
  FOR SELECT USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert completed cues for their events" ON completed_cues
  FOR INSERT WITH CHECK (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update completed cues for their events" ON completed_cues
  FOR UPDATE USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete completed cues for their events" ON completed_cues
  FOR DELETE USING (
    event_id::UUID IN (
      SELECT us.event_id::UUID 
      FROM user_sessions us 
      WHERE us.user_id = auth.uid()
    )
  );

-- Function to mark a cue as completed
CREATE OR REPLACE FUNCTION mark_cue_completed(
  p_event_id UUID,
  p_item_id BIGINT,
  p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO completed_cues (event_id, item_id, user_id, completed_at)
  VALUES (p_event_id, p_item_id, p_user_id, NOW())
  ON CONFLICT (event_id, item_id) 
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    completed_at = EXCLUDED.completed_at;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to get all completed cues for an event
CREATE OR REPLACE FUNCTION get_completed_cues_for_event(p_event_id UUID)
RETURNS TABLE (
  item_id BIGINT,
  user_id UUID,
  completed_at TIMESTAMPTZ,
  user_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cc.item_id,
    cc.user_id,
    cc.completed_at,
    'Unknown User' as user_name
  FROM completed_cues cc
  WHERE cc.event_id = p_event_id
  ORDER BY cc.completed_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to clear completed cues for an event (useful for reset)
CREATE OR REPLACE FUNCTION clear_completed_cues_for_event(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM completed_cues WHERE event_id = p_event_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to unmark a cue as completed (if needed)
CREATE OR REPLACE FUNCTION unmark_cue_completed(
  p_event_id UUID,
  p_item_id BIGINT
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM completed_cues 
  WHERE event_id = p_event_id AND item_id = p_item_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
