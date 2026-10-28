-- Track PowerPoint files created from a cue PDF (picture-per-page conversion).

ALTER TABLE public.event_cue_files
  ADD COLUMN IF NOT EXISTS converted_from_id UUID;
