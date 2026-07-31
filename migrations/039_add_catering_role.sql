-- Catering role: signed-in users who only see catering event list / compressed ROS.
-- Run on Neon after migration 038.

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS is_catering BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_api_user_access_catering
  ON public.api_user_access (is_catering)
  WHERE is_catering = TRUE;

COMMENT ON COLUMN public.api_user_access.is_catering IS
  'When true (and not admin), user is routed to catering UI with assigned events only';
