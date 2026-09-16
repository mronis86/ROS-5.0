-- Hide Fullscreen Timer option in the Run of Show Display Mode modal (global).
-- Run on the same Neon database as Railway NEON_DATABASE_URL.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS hide_fullscreen_timer_option BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.hide_fullscreen_timer_option IS
  'When true, hide the Fullscreen Timer choice in Select Display Mode (Clock remains).';
