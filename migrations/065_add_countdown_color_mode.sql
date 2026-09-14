-- Primary countdown color mode for Clock / Fullscreen Timer (and shared countdown UIs).
-- Run on the same Neon database as Railway NEON_DATABASE_URL.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS countdown_color_mode TEXT NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.app_settings.countdown_color_mode IS
  'Global primary countdown color: standard (#10b981), white (#ffffff), or bolderGreen (#39FF14). Yellow/red warning thresholds unchanged.';
