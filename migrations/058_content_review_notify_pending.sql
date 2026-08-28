-- Debounced content review digest emails (one row per assignee; timer resets on activity).

CREATE TABLE IF NOT EXISTS public.content_review_notify_pending (
  access_id UUID PRIMARY KEY REFERENCES public.api_user_access(id) ON DELETE CASCADE,
  notify_after TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_review_notify_pending_due
  ON public.content_review_notify_pending (notify_after);

COMMENT ON TABLE public.content_review_notify_pending IS
  'Assignees waiting for a debounced content review digest email (notify_after resets on each change).';
