-- Soft-cap overflow + optional follow-up email for live web Q&A.

ALTER TABLE public.event_web_qa_questions
  ADD COLUMN IF NOT EXISTS author_email TEXT;

ALTER TABLE public.event_web_qa_questions
  ADD COLUMN IF NOT EXISTS is_overflow BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_overflow
  ON public.event_web_qa_questions (event_id, is_overflow, created_at ASC);

COMMENT ON COLUMN public.event_web_qa_questions.author_email IS
  'Optional follow-up email; required when submitting after the visible soft limit';
COMMENT ON COLUMN public.event_web_qa_questions.is_overflow IS
  'True when submitted after the visible soft limit — stored for report export, hidden from live mod UI';
