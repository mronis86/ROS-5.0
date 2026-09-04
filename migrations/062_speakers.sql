-- Global speaker directory for Producers / Admins and ROS import.

CREATE TABLE IF NOT EXISTS public.speakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  full_name_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',
  photo_link TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_by_name TEXT,
  CONSTRAINT speakers_full_name_key_unique UNIQUE (full_name_key)
);

CREATE INDEX IF NOT EXISTS idx_speakers_full_name_key
  ON public.speakers (full_name_key);

CREATE INDEX IF NOT EXISTS idx_speakers_name_trgm_fallback
  ON public.speakers (lower(full_name));

COMMENT ON TABLE public.speakers IS
  'Global speaker database; ROS cues import name/title/org/photo by match on full_name_key';
