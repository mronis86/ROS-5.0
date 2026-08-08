-- Platform cue asset uploads (Railway Storage Buckets). Auto-delete after expires_at (4 months).

CREATE TABLE IF NOT EXISTS public.event_cue_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_cue_files_event_item
  ON public.event_cue_files (event_id, item_id);

CREATE INDEX IF NOT EXISTS idx_event_cue_files_expires
  ON public.event_cue_files (expires_at);
