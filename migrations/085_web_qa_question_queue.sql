-- Showcase / select queue for live web Q&A questions.

ALTER TABLE public.event_web_qa_questions
  ADD COLUMN IF NOT EXISTS is_queued BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_queue
  ON public.event_web_qa_questions (event_id, is_queued, sort_order ASC)
  WHERE is_queued = TRUE;

COMMENT ON COLUMN public.event_web_qa_questions.is_queued IS
  'Selected for the live showcase queue (future on-screen display)';
COMMENT ON COLUMN public.event_web_qa_questions.sort_order IS
  '1-based order when is_queued; otherwise unused / 0';
