-- Global Pre-Flight checklist template (Admin-managed).
-- Enabled rows are copied into each event/day checklist on first open.

CREATE TABLE IF NOT EXISTS public.preflight_checklist_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preflight_template_section_order
  ON public.preflight_checklist_template (section, sort_order);

COMMENT ON TABLE public.preflight_checklist_template IS
  'Admin-managed standard Pre-Flight items; enabled items seed each event/day checklist';
