-- Auto-set Run of Show shot type from speakers (global admin toggle).
-- Default false so existing shows are unchanged until an admin opts in.
-- Run on the same Neon database as Railway NEON_DATABASE_URL.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS auto_shot_type_from_speakers BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_settings.auto_shot_type_from_speakers IS
  'When true, saving speakers on a cue sets shotType: single Podium speaker → Podium; otherwise N-Shot from named speaker count (1–7).';
