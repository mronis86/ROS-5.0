-- Passwordless access requests: portal link for status + post-approval password setup.
-- Run on Neon after migration 027.

ALTER TABLE public.api_user_access
  ALTER COLUMN neon_user_id DROP NOT NULL;

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_token_hash TEXT;

ALTER TABLE public.api_user_access
  DROP CONSTRAINT IF EXISTS api_user_access_neon_user_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_user_access_neon_user_id_unique
  ON public.api_user_access (neon_user_id)
  WHERE neon_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_user_access_portal_token_hash
  ON public.api_user_access (portal_token_hash)
  WHERE portal_token_hash IS NOT NULL;
