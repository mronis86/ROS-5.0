-- Single on-air / ACTIVE question for live web Q&A (vMix active CSV + Select/Reader).

ALTER TABLE public.event_web_qa_questions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one active question per event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_qa_questions_one_active
  ON public.event_web_qa_questions (event_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_active
  ON public.event_web_qa_questions (event_id, is_active)
  WHERE is_active = TRUE;

COMMENT ON COLUMN public.event_web_qa_questions.is_active IS
  'On-air question for graphics / Reader; only one per event. Mark Done before activating another.';
