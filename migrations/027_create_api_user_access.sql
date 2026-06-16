-- User access requests for Neon Auth sign-ups (admin approval required).
-- Run on Neon after migration 026.

CREATE TABLE IF NOT EXISTS public.api_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  neon_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  notes TEXT,
  CONSTRAINT api_user_access_neon_user_id_unique UNIQUE (neon_user_id),
  CONSTRAINT api_user_access_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_api_user_access_status ON public.api_user_access(status);
