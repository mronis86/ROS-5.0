-- Live web polls: config + option counters + ballots + soft Neon inbox.
-- Surfaces read results_snapshot (or option vote_count); drain commits inbox → ballots/counters.
-- One audience QR/session per event (event_web_poll_sessions).

CREATE TABLE IF NOT EXISTS public.event_web_poll_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_poll_sessions_token
  ON public.event_web_poll_sessions (public_token);

CREATE TABLE IF NOT EXISTS public.event_web_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  poll_type TEXT NOT NULL
    CHECK (poll_type IN ('single', 'multi', 'yesno', 'rating', 'ranked')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'finalizing', 'final')),
  cue_item_id BIGINT,
  received_count INT NOT NULL DEFAULT 0,
  counted_count INT NOT NULL DEFAULT 0,
  results_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_web_polls_event
  ON public.event_web_polls (event_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_polls_token
  ON public.event_web_polls (public_token);

CREATE TABLE IF NOT EXISTS public.event_web_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.event_web_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  vote_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_web_poll_options_poll
  ON public.event_web_poll_options (poll_id, sort_order ASC);

CREATE TABLE IF NOT EXISTS public.event_web_poll_ballots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.event_web_polls(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_event_web_poll_ballots_poll
  ON public.event_web_poll_ballots (poll_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.event_web_poll_votes_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.event_web_polls(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_web_poll_inbox_pending
  ON public.event_web_poll_votes_inbox (poll_id, created_at ASC)
  WHERE processed_at IS NULL;

COMMENT ON TABLE public.event_web_polls IS
  'Web polls: lifecycle + received/counted + results_snapshot for surface reads';
COMMENT ON TABLE public.event_web_poll_options IS
  'Poll choices with committed vote_count (drain updates)';
COMMENT ON TABLE public.event_web_poll_ballots IS
  'One ballot per voter_key (IP) per poll — report source of truth';
COMMENT ON TABLE public.event_web_poll_votes_inbox IS
  'Soft v1 Neon inbox; Redis can replace this hot path later';

-- Admin toggle: neon (soft) | redis (full B when Railway Redis is configured)
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS poll_inbox_backend TEXT NOT NULL DEFAULT 'neon'
    CHECK (poll_inbox_backend IN ('neon', 'redis'));
