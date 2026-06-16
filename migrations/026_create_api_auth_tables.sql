-- API authentication: users, sessions, and integration tokens (Companion, vMix, backup scripts).
-- Run on Neon before enabling REQUIRE_API_AUTH on Railway.

CREATE TABLE IF NOT EXISTS public.api_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_users_email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.api_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.api_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT api_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_sessions_user_id ON public.api_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_api_sessions_expires_at ON public.api_sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.api_integration_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  event_id UUID,
  created_by UUID REFERENCES public.api_users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT api_integration_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_integration_tokens_prefix ON public.api_integration_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_api_integration_tokens_event_id ON public.api_integration_tokens(event_id);
