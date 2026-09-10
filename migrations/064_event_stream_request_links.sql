-- Public Stream Request form links (YouTube channel / Public|Unlisted / share-to).

CREATE TABLE IF NOT EXISTS public.api_event_stream_request_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  token_raw TEXT,
  created_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_event_stream_request_links_event_id
  ON public.api_event_stream_request_links (event_id);

CREATE INDEX IF NOT EXISTS idx_api_event_stream_request_links_active
  ON public.api_event_stream_request_links (event_id)
  WHERE revoked_at IS NULL;
