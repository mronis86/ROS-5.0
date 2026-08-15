-- Per-day Pre-Flight checklist for multi-day events.
-- Run on Neon after migration 045 (or rely on API startup sync).

ALTER TABLE public.preflight_checklist_items
  ADD COLUMN IF NOT EXISTS day INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_preflight_checklist_event_day
  ON public.preflight_checklist_items (event_id, day, sort_order);

COMMENT ON COLUMN public.preflight_checklist_items.day IS
  'Show day number (1-based). Each day has its own checklist state.';
