-- Show Live sync status badge in the top app header (after logo text).
-- Run on the same Neon database as Railway NEON_DATABASE_URL.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS show_live_sync_status_badge BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.show_live_sync_status_badge IS
  'When true, show Live / Sync issue badge in the top header after the brand title (Run of Show).';
