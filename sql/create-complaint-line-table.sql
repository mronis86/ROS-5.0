-- Complaint Line notes (Event Managers / Admins). Also bootstrapped in api-server.js.

CREATE TABLE IF NOT EXISTS public.complaint_line_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  category TEXT NOT NULL DEFAULT 'complaint'
    CHECK (category IN ('complaint', 'technical', 'client', 'other')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaint_line_event_created
  ON public.complaint_line_notes (event_id, created_at DESC);

COMMENT ON TABLE public.complaint_line_notes IS
  'Event Manager / Admin complaint-line notes for post-show reports';
