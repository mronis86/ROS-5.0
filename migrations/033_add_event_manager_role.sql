-- Event manager role: can approve/reject access requests without full admin privileges.
-- Run on Neon after migration 032.

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS is_event_manager BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_api_user_access_event_manager
  ON public.api_user_access (is_event_manager)
  WHERE is_event_manager = TRUE;
