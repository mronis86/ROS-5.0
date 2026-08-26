-- Hour-level training blocks (full-day blocks remain in training_blocked_dates).

CREATE TABLE IF NOT EXISTS public.training_blocked_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date DATE NOT NULL,
  hour INTEGER NOT NULL CHECK (hour >= 9 AND hour <= 16),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (block_date, hour)
);

CREATE INDEX IF NOT EXISTS idx_training_blocked_hours_date
  ON public.training_blocked_hours (block_date);
