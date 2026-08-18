-- Green Room display layout (classic video vs ROS-styled portrait).
-- Run on the same Neon database as Railway NEON_DATABASE_URL.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS green_room_layout_id TEXT NOT NULL DEFAULT 'classic';

COMMENT ON COLUMN public.app_settings.green_room_layout_id IS
  'Global Green Room layout: classic (video 9:16) or ros (slate portrait matching other pages)';
