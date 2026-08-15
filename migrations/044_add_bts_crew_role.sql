-- BTS Crew role: same platform capabilities as Event Manager, distinct label.
-- Used to gate Pre-Flight / Show Checklist. Run on Neon after migration 043.

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS is_bts_crew BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_api_user_access_bts_crew
  ON public.api_user_access (is_bts_crew)
  WHERE is_bts_crew = TRUE;

COMMENT ON COLUMN public.api_user_access.is_bts_crew IS
  'When true (and not admin), user is BTS Crew: Event Manager–level access + Pre-Flight checklist';
