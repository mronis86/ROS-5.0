-- Pre-Flight / Show Checklist: per-event items cloned from a default template.
-- Run on Neon after migration 044.

CREATE TABLE IF NOT EXISTS public.preflight_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  is_checked BOOLEAN NOT NULL DEFAULT FALSE,
  checked_by_user_id TEXT,
  checked_by_name TEXT,
  checked_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preflight_checklist_event_section
  ON public.preflight_checklist_items (event_id, section, sort_order);

CREATE INDEX IF NOT EXISTS idx_preflight_checklist_event_checked
  ON public.preflight_checklist_items (event_id, is_checked);

COMMENT ON TABLE public.preflight_checklist_items IS
  'Pre-Flight / Show Checklist rows per event (Lighting, Audio, Broadcast, Media Playback)';
