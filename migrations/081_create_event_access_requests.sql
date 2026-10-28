-- User-initiated requests to join a selected event (restricted allowlist users).
-- Railway also creates this table at API startup via ensureEventAccessRequestsSchema.

CREATE TABLE IF NOT EXISTS public.api_event_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id UUID NOT NULL REFERENCES public.api_user_access(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_event_access_requests_pending
  ON public.api_event_access_requests (access_id, event_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_api_event_access_requests_status
  ON public.api_event_access_requests (status, created_at);

CREATE INDEX IF NOT EXISTS idx_api_event_access_requests_event
  ON public.api_event_access_requests (event_id);
