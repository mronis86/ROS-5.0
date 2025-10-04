-- ===========================================
-- RUN OF SHOW BACKUPS TABLE
-- ===========================================
-- This table stores backups of run of show data for each event
-- One backup per event per day (auto-updated)

CREATE TABLE IF NOT EXISTS run_of_show_backups (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Event identification
  event_id VARCHAR(255) NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  event_date DATE NOT NULL,
  event_location VARCHAR(255),
  
  -- Backup metadata
  backup_name VARCHAR(255) NOT NULL,
  backup_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  backup_type VARCHAR(20) NOT NULL CHECK (backup_type IN ('auto', 'manual')),
  
  -- Backup data (JSON)
  schedule_data JSONB NOT NULL DEFAULT '[]',
  custom_columns_data JSONB NOT NULL DEFAULT '[]',
  event_data JSONB NOT NULL DEFAULT '{}',
  
  -- Statistics
  schedule_items_count INTEGER DEFAULT 0,
  custom_columns_count INTEGER DEFAULT 0,
  
  -- User tracking
  created_by VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255),
  created_by_role VARCHAR(50) DEFAULT 'VIEWER'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_id ON run_of_show_backups(event_id);
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_date ON run_of_show_backups(event_date);
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_backup_timestamp ON run_of_show_backups(backup_timestamp);
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_backup_type ON run_of_show_backups(backup_type);
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_created_by ON run_of_show_backups(created_by);

-- Unique constraint: one backup per event per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_of_show_backups_unique_event_date 
ON run_of_show_backups(event_id, event_date);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_run_of_show_backups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_run_of_show_backups_updated_at
  BEFORE UPDATE ON run_of_show_backups
  FOR EACH ROW
  EXECUTE FUNCTION update_run_of_show_backups_updated_at();

-- Grant permissions
GRANT ALL ON TABLE run_of_show_backups TO public;
GRANT ALL ON TABLE run_of_show_backups TO authenticated;
GRANT ALL ON TABLE run_of_show_backups TO service_role;
GRANT ALL ON SEQUENCE run_of_show_backups_id_seq TO public;
GRANT ALL ON SEQUENCE run_of_show_backups_id_seq TO authenticated;
GRANT ALL ON SEQUENCE run_of_show_backups_id_seq TO service_role;
