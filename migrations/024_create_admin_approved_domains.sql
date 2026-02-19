CREATE TABLE IF NOT EXISTS public.admin_approved_domains (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_approved_domains_domain
  ON public.admin_approved_domains (LOWER(domain));
