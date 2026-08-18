-- Per-event display/follower sync is stored in calendar_events.schedule_data.displaySyncEnabled
-- (boolean; omitted or true = sync allowed, false = follower pages stop polling until re-enabled).
-- No schema change required — JSON field on existing schedule_data.

COMMENT ON TABLE public.calendar_events IS
  'Calendar events; schedule_data may include displaySyncEnabled (bool) for Green Room / Photo / display follower sync.';
