-- Admin-pushed "please refresh" notice. Deploys do not show the banner until Admin notifies.
-- Railway also ADD COLUMN IF NOT EXISTS this on app_settings reads/writes.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS refresh_notice_version TEXT;
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS refresh_notice_date TEXT;
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS refresh_notice_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS refresh_notice_at TIMESTAMPTZ;
