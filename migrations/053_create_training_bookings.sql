-- Training booking: hourly Mon–Fri 9–5 slots; one booking per slot; admin day block-outs.

CREATE TABLE IF NOT EXISTS public.training_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_training_bookings_starts_at
  ON public.training_bookings (starts_at);

-- Allow multiple people to book the same hour (drop exclusive unique index if present).
DROP INDEX IF EXISTS public.idx_training_bookings_starts_at_active;

CREATE TABLE IF NOT EXISTS public.training_blocked_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date DATE NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_blocked_dates_date
  ON public.training_blocked_dates (block_date);
