-- Exclusive auto-backup lease: only one active saver per event at a time.
-- Heartbeat must stay fresh (~12 min) or another user may claim.

CREATE TABLE IF NOT EXISTS public.auto_backup_lease (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT,
  interval_minutes INTEGER NOT NULL DEFAULT 10,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_backup_lease_heartbeat
  ON public.auto_backup_lease (heartbeat_at DESC);

COMMENT ON TABLE public.auto_backup_lease IS
  'At most one auto-backup owner per event; stale heartbeats free the lease for others.';
