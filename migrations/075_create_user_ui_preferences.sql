-- Per-account UI preferences (e.g. ROS column filter/order) stored in Neon.

CREATE TABLE IF NOT EXISTS public.user_ui_preferences (
  user_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ui_preferences_updated_at
  ON public.user_ui_preferences (updated_at DESC);

COMMENT ON TABLE public.user_ui_preferences IS
  'Account-level UI preferences (JSON). Follows the user across devices.';
