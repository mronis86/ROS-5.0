-- Add optional Google service account JSON (can be set from Admin instead of env var)
ALTER TABLE public.admin_backup_config
  ADD COLUMN IF NOT EXISTS gdrive_service_account_json TEXT;

COMMENT ON COLUMN public.admin_backup_config.gdrive_service_account_json IS 'Optional: Google Drive API credentials JSON. If set, used for backup; else GOOGLE_SERVICE_ACCOUNT_JSON env var. Never exposed by API.';
