-- Admin backup config: Google Drive weekly backup settings (single row)
-- Run this migration on Neon (same DB as Railway NEON_DATABASE_URL) to enable the Admin backup section.

CREATE TABLE IF NOT EXISTS public.admin_backup_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  gdrive_enabled BOOLEAN NOT NULL DEFAULT false,
  gdrive_folder_id TEXT,
  gdrive_last_run_at TIMESTAMPTZ,
  gdrive_last_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.admin_backup_config (id, gdrive_enabled, gdrive_folder_id, updated_at)
VALUES (1, false, NULL, NOW())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.admin_backup_config IS 'Single-row config for admin features e.g. Google Drive weekly backup';
