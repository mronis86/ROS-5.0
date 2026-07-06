-- Per-user Production Dashboard access (off by default; admins always have access).
-- Run on Neon after migration 027.

ALTER TABLE public.api_user_access
  ADD COLUMN IF NOT EXISTS dashboard_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.api_user_access.dashboard_enabled IS
  'When true, approved user can open /dashboard and call /api/dashboard/summary. Admins always have access.';
