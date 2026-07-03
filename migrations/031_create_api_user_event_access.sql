-- Per-user event access restrictions (empty = unrestricted / all events).
-- Run on Neon after migration 027.

CREATE TABLE IF NOT EXISTS public.api_user_event_access (
  access_id UUID NOT NULL REFERENCES public.api_user_access(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (access_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_api_user_event_access_event_id
  ON public.api_user_event_access (event_id);
