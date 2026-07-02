-- Keep portal magic-link token so approval emails reuse the same URL as the request email.
-- Run on Neon after migration 029.

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS portal_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_user_access_portal_token
  ON public.api_user_access (portal_token)
  WHERE portal_token IS NOT NULL;
