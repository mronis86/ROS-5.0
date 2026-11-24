-- Per-poll results / surface styling (saved from Poll Setup; samples lab is the reference UI).
ALTER TABLE public.event_web_polls
  ADD COLUMN IF NOT EXISTS display_style JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.event_web_polls.display_style IS
  'Chart layout, look toggles, color preset, bar style, and surface options for this poll';
