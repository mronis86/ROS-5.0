-- Backup table for Run of Show data
-- This table stores snapshots of run of show data every 5 minutes

CREATE TABLE IF NOT EXISTS run_of_show_backups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  backup_name VARCHAR(255) NOT NULL, -- e.g., "Auto Backup - 2024-01-15 14:30"
  backup_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  schedule_data JSONB NOT NULL, -- The complete schedule data
  custom_columns_data JSONB, -- Custom columns data
  event_data JSONB, -- Event metadata at time of backup
  backup_type VARCHAR(50) DEFAULT 'auto', -- 'auto' or 'manual'
  event_name VARCHAR(255), -- Event name for easier filtering
  event_date DATE, -- Event date for easier filtering
  event_location VARCHAR(255), -- Event location for easier filtering
  schedule_items_count INTEGER DEFAULT 0, -- Count of schedule items for quick reference
  custom_columns_count INTEGER DEFAULT 0, -- Count of custom columns for quick reference
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying by event_id and timestamp
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_id 
ON run_of_show_backups(event_id);

CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_timestamp 
ON run_of_show_backups(backup_timestamp DESC);

-- Index for querying by event_id and timestamp together
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_timestamp 
ON run_of_show_backups(event_id, backup_timestamp DESC);

-- Indexes for filtering and searching
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_name 
ON run_of_show_backups(event_name);

CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_date 
ON run_of_show_backups(event_date);

CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_location 
ON run_of_show_backups(event_location);

CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_backup_type 
ON run_of_show_backups(backup_type);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_name_date 
ON run_of_show_backups(event_name, event_date, backup_timestamp DESC);

-- Unique constraint to ensure only one backup per event per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_of_show_backups_event_date_unique 
ON run_of_show_backups(event_id, event_date);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_run_of_show_backups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_run_of_show_backups_updated_at ON run_of_show_backups;
CREATE TRIGGER trigger_update_run_of_show_backups_updated_at
  BEFORE UPDATE ON run_of_show_backups
  FOR EACH ROW
  EXECUTE FUNCTION update_run_of_show_backups_updated_at();

-- RLS (Row Level Security) policies
ALTER TABLE run_of_show_backups ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view backups for events they have access to
CREATE POLICY "Users can view backups for accessible events" ON run_of_show_backups
  FOR SELECT USING (
    event_id IN (
      SELECT id FROM calendar_events 
      WHERE created_by = auth.uid()
    )
  );

-- Policy: Users can create backups for events they can edit
CREATE POLICY "Users can create backups for editable events" ON run_of_show_backups
  FOR INSERT WITH CHECK (
    event_id IN (
      SELECT id FROM calendar_events 
      WHERE created_by = auth.uid()
    )
  );

-- Policy: Users can update their own backups
CREATE POLICY "Users can update their own backups" ON run_of_show_backups
  FOR UPDATE USING (created_by = auth.uid());

-- Policy: Users can delete their own backups
CREATE POLICY "Users can delete their own backups" ON run_of_show_backups
  FOR DELETE USING (created_by = auth.uid());
