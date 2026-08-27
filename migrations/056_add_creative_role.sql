-- Creative role: signed-in users with Content Review + read-only Run of Show viewer.
-- Run on Neon after migration 048 (is_comms).

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS is_creative BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_api_user_access_creative
  ON public.api_user_access (is_creative)
  WHERE is_creative = TRUE;

COMMENT ON COLUMN public.api_user_access.is_creative IS
  'When true (and not admin), user is routed to Creative UI (event list, content review viewer, ROS viewer)';
