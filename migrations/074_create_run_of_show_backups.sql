-- Run of show backups (manual + auto snapshots). Multiple rows per event/day allowed.

CREATE TABLE IF NOT EXISTS public.run_of_show_backups (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  event_id VARCHAR(255) NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  event_date DATE NOT NULL,
  event_location VARCHAR(255),
  backup_name VARCHAR(255) NOT NULL,
  backup_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  backup_type VARCHAR(20) NOT NULL CHECK (backup_type IN ('auto', 'manual')),
  schedule_data JSONB NOT NULL DEFAULT '[]',
  custom_columns_data JSONB NOT NULL DEFAULT '[]',
  event_data JSONB NOT NULL DEFAULT '{}',
  schedule_items_count INTEGER DEFAULT 0,
  custom_columns_count INTEGER DEFAULT 0,
  created_by VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255),
  created_by_role VARCHAR(50) DEFAULT 'VIEWER'
);

CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_event_id ON public.run_of_show_backups(event_id);
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_backup_timestamp ON public.run_of_show_backups(backup_timestamp);
CREATE INDEX IF NOT EXISTS idx_run_of_show_backups_backup_type ON public.run_of_show_backups(backup_type);

-- Legacy unique index blocked multiple snapshots per day
DROP INDEX IF EXISTS public.idx_run_of_show_backups_unique_event_date;
DROP INDEX IF EXISTS public.idx_run_of_show_backups_event_date_unique;

COMMENT ON TABLE public.run_of_show_backups IS
  'Run of show schedule backups. Multiple rows per event/day allowed; auto backups are pruned by the API.';
