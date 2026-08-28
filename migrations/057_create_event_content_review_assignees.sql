-- Per-event content review assignees (typically 1–2 creative, 1–2 production reviewers).

CREATE TABLE IF NOT EXISTS public.event_content_review_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  access_id UUID NOT NULL REFERENCES public.api_user_access(id) ON DELETE CASCADE,
  assignee_role TEXT NOT NULL CHECK (assignee_role IN ('creative', 'production')),
  assigned_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
  notify_on_change BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_content_review_assignees_unique_user UNIQUE (event_id, access_id)
);

CREATE INDEX IF NOT EXISTS idx_event_cr_assignees_event
  ON public.event_content_review_assignees (event_id);

CREATE INDEX IF NOT EXISTS idx_event_cr_assignees_access
  ON public.event_content_review_assignees (access_id);

CREATE INDEX IF NOT EXISTS idx_event_cr_assignees_event_role
  ON public.event_content_review_assignees (event_id, assignee_role);

COMMENT ON TABLE public.event_content_review_assignees IS
  'Per-event content review assignees (typically 1–2 creative, 1–2 production).';
