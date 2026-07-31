-- Catering notes (also bootstrapped in api-server.js).

CREATE TABLE IF NOT EXISTS public.catering_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'break', 'plating', 'meal', 'other')),
  content TEXT NOT NULL,
  schedule_item_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catering_notes_event_created
  ON public.catering_notes (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catering_notes_item
  ON public.catering_notes (event_id, schedule_item_id)
  WHERE schedule_item_id IS NOT NULL;
