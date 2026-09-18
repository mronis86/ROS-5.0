-- Cue Cards: per-event web slide decks + per-slide comments (Scripts Follow–style types)

CREATE TABLE IF NOT EXISTS public.cue_card_decks (
  event_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Cue Cards',
  slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  cue_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS public.cue_card_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  slide_id TEXT NOT NULL,
  comment_text TEXT NOT NULL DEFAULT '',
  comment_type VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
  author TEXT NOT NULL DEFAULT 'Unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cue_card_comments_type_check
    CHECK (comment_type IN ('GENERAL', 'CUE', 'AUDIO', 'GFX', 'VIDEO', 'LIGHTING'))
);

CREATE INDEX IF NOT EXISTS idx_cue_card_comments_event
  ON public.cue_card_comments (event_id);

CREATE INDEX IF NOT EXISTS idx_cue_card_comments_slide
  ON public.cue_card_comments (event_id, slide_id);

COMMENT ON TABLE public.cue_card_decks IS 'Web-built cue card slide decks keyed by event';
COMMENT ON TABLE public.cue_card_comments IS 'Per-slide comments for Cue Cards (same types as Scripts Follow)';
