-- Railway API sessions issued after Neon Auth sign-in (cross-domain exchange).
-- Run on Neon after migrations 026 and 027.

CREATE TABLE IF NOT EXISTS public.api_neon_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  neon_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT api_neon_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_neon_sessions_neon_user_id ON public.api_neon_sessions(neon_user_id);
CREATE INDEX IF NOT EXISTS idx_api_neon_sessions_expires_at ON public.api_neon_sessions(expires_at);
