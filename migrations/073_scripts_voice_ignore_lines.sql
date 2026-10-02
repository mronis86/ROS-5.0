-- Lines marked "Ignore for voice" in Scripts Follow (0-based line indexes).
-- Shown in the script, skipped by teleprompter speech matching.

ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS voice_ignore_lines INTEGER[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN public.scripts.voice_ignore_lines IS
  '0-based script line indexes ignored by voice auto-scroll matching';
