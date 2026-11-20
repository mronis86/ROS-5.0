-- Live web Q&A: per-event public link + moderated question queue.

CREATE TABLE IF NOT EXISTS public.event_web_qa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_qa_sessions_token
  ON public.event_web_qa_sessions (public_token);

CREATE TABLE IF NOT EXISTS public.event_web_qa_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES public.event_web_qa_sessions(id) ON DELETE CASCADE,
  cue_item_id BIGINT,
  author_name TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'answered', 'rejected', 'archived')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moderated_at TIMESTAMPTZ,
  moderated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_status
  ON public.event_web_qa_questions (event_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_session
  ON public.event_web_qa_questions (session_id, created_at ASC);

COMMENT ON TABLE public.event_web_qa_sessions IS
  'Per-event live web Q&A session (unique public token for QR / audience URL)';
COMMENT ON TABLE public.event_web_qa_questions IS
  'Audience-submitted questions for live web Q&A moderation queue';
