-- Programmable operator countdown (one row per event) — sent to Clock / FS / Photo on command.

CREATE TABLE IF NOT EXISTS operator_countdowns (
  event_id UUID PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'Operator Timer',
  duration_seconds INTEGER NOT NULL DEFAULT 300 CHECK (duration_seconds > 0),
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_running BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  sent_by TEXT,
  sent_by_name TEXT,
  sent_by_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_countdowns_active
  ON operator_countdowns (event_id)
  WHERE is_active = true AND is_running = true;
