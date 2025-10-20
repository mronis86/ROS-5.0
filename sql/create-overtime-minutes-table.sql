-- Create overtime_minutes table for tracking schedule item overtime
-- Similar to completed_cues, this provides persistent storage separate from schedule_items JSON

CREATE TABLE IF NOT EXISTS overtime_minutes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  overtime_minutes NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, item_id) -- Only one overtime record per item per event
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_overtime_minutes_event_id ON overtime_minutes(event_id);
CREATE INDEX IF NOT EXISTS idx_overtime_minutes_item_id ON overtime_minutes(item_id);
CREATE INDEX IF NOT EXISTS idx_overtime_minutes_updated_at ON overtime_minutes(updated_at);

-- Enable RLS (Row Level Security)
ALTER TABLE overtime_minutes ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your auth requirements)
CREATE POLICY "Allow all operations on overtime_minutes" ON overtime_minutes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON overtime_minutes TO authenticated;
GRANT ALL ON overtime_minutes TO anon;

