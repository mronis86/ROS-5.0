-- Producer role: Event Manager–equivalent rights + exclusive Speaker Manager page.
-- Run on Neon after migration 056 (is_creative).

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS is_producer BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_api_user_access_producer
  ON public.api_user_access (is_producer)
  WHERE is_producer = TRUE;

COMMENT ON COLUMN public.api_user_access.is_producer IS
  'When true, user has Event Manager–level ops plus access to the global Speaker Manager page';
