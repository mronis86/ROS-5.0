-- Per-event Event Board workspace (General Meeting / Hollow Square non-timed shows).

CREATE TABLE IF NOT EXISTS public.event_board_data (
  event_id TEXT PRIMARY KEY,
  av_notes TEXT NOT NULL DEFAULT '',
  agenda_text TEXT NOT NULL DEFAULT '',
  agenda_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  updated_by_name TEXT
);

CREATE TABLE IF NOT EXISTS public.event_board_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  zone TEXT NOT NULL
    CHECK (zone IN ('agenda', 'powerpoint', 'display')),
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  extracted_text TEXT,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_board_assets_event_zone
  ON public.event_board_assets (event_id, zone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_board_assets_expires
  ON public.event_board_assets (expires_at);

COMMENT ON TABLE public.event_board_data IS
  'Event Board notes + parsed agenda text for non-timed meetings';
COMMENT ON TABLE public.event_board_assets IS
  'Uploaded agenda / PowerPoint / display files for Event Board workspaces';
