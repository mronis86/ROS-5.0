-- Soft-delete for calendar events: remove from calendar UI without wiping ROS / timer data.
-- Run on the same Neon database as Railway NEON_DATABASE_URL.
-- The API also applies this on startup via ensureCalendarSoftDeleteSchema().

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted_at
  ON public.calendar_events (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.calendar_events.deleted_at IS
  'When set, event is hidden from the calendar. Run of Show and related rows are kept until an admin permanently purges.';
