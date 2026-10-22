-- PowerPoint stills + per-slide cue/timer bindings for the ROS PPT bridge.
CREATE TABLE IF NOT EXISTS public.ppt_sessions (
  event_id TEXT PRIMARY KEY,
  deck_name TEXT NOT NULL DEFAULT '',
  slide_count INTEGER NOT NULL DEFAULT 0,
  connected BOOLEAN NOT NULL DEFAULT false,
  slideshow_active BOOLEAN NOT NULL DEFAULT false,
  current_slide_id TEXT,
  current_index INTEGER,
  last_seen TIMESTAMPTZ,
  last_fired_slide_id TEXT,
  last_action TEXT,
  last_item_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ppt_slides (
  event_id TEXT NOT NULL,
  ppt_slide_id TEXT NOT NULL,
  slide_index INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  object_key TEXT,
  preview_data TEXT,
  mime_type TEXT DEFAULT 'image/jpeg',
  width INTEGER,
  height INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, ppt_slide_id)
);

CREATE INDEX IF NOT EXISTS idx_ppt_slides_event_index
  ON public.ppt_slides (event_id, slide_index);

CREATE TABLE IF NOT EXISTS public.ppt_slide_bindings (
  event_id TEXT NOT NULL,
  ppt_slide_id TEXT NOT NULL,
  item_id BIGINT,
  action TEXT NOT NULL DEFAULT 'none'
    CHECK (action IN ('none', 'load', 'load_start', 'start')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, ppt_slide_id)
);

CREATE INDEX IF NOT EXISTS idx_ppt_slide_bindings_event
  ON public.ppt_slide_bindings (event_id);
