-- Comms role: signed-in users who mark cues for recording.
-- Run on Neon after migration 047 (or 043 if BTS/preflight migrations are not applied yet).

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS is_comms BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_api_user_access_comms
  ON public.api_user_access (is_comms)
  WHERE is_comms = TRUE;

COMMENT ON COLUMN public.api_user_access.is_comms IS
  'When true (and not admin), user is routed to Comms UI to mark cues for recording';
