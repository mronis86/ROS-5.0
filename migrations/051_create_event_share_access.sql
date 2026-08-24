-- Per-event share-access tokens: invite approved users to add an event to their allowlist.
-- Empty api_user_event_access = unrestricted (all events); share redeem only appends when restricted.

CREATE TABLE IF NOT EXISTS public.api_event_share_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  token_raw TEXT,
  created_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_event_share_tokens_event_id
  ON public.api_event_share_tokens (event_id);

CREATE INDEX IF NOT EXISTS idx_api_event_share_tokens_active
  ON public.api_event_share_tokens (event_id)
  WHERE revoked_at IS NULL;
