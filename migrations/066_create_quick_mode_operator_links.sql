-- Stable public Quick Mode operator links: same token forever; access gated by expires_at.
-- Anyone with the token can operate timers for that Quick Mode session until expiry.

CREATE TABLE IF NOT EXISTS public.api_quick_mode_operator_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  token_raw TEXT NOT NULL,
  created_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_qm_operator_links_token_hash
  ON public.api_quick_mode_operator_links (token_hash);

CREATE INDEX IF NOT EXISTS idx_api_qm_operator_links_expires
  ON public.api_quick_mode_operator_links (expires_at);
