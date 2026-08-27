-- Cue label → PDF page map for Content Review auto-scroll (e.g. { "CUE1": 3, "CUE2": 7 }).

ALTER TABLE public.content_review_data
  ADD COLUMN IF NOT EXISTS creative_cue_pages JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.content_review_data.creative_cue_pages IS
  'Map of normalized cue labels (CUE1) to 1-based PDF page numbers for Content Review sync';
