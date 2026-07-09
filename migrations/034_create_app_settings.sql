-- Global app settings (single row): header logo variant, etc.
-- Run on the same Neon database as Railway NEON_DATABASE_URL.

CREATE TABLE IF NOT EXISTS public.app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  logo_variant_id TEXT NOT NULL DEFAULT 'default' CHECK (logo_variant_id IN ('default', 'sinor')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_settings (id, logo_variant_id, updated_at)
VALUES (1, 'default', NOW())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.app_settings IS 'Single-row global app settings (e.g. header logo variant for all users)';
