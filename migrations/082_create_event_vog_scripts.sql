-- VOG (Voice of God) scripts + ElevenLabs voice per cue.
-- Kept out of run_of_show_data.schedule_items so the main ROS blob stays lean.
-- Audio files are not stored here — preview/download stay ephemeral via ElevenLabs.

CREATE TABLE IF NOT EXISTS public.event_vog_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  schedule_item_id BIGINT NOT NULL,
  vog_text TEXT NOT NULL DEFAULT '',
  voice_id TEXT NOT NULL DEFAULT '',
  voice_name TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_vog_scripts_event_item_unique UNIQUE (event_id, schedule_item_id)
);

CREATE INDEX IF NOT EXISTS idx_event_vog_scripts_event
  ON public.event_vog_scripts (event_id);

CREATE INDEX IF NOT EXISTS idx_event_vog_scripts_event_updated
  ON public.event_vog_scripts (event_id, updated_at DESC);

COMMENT ON TABLE public.event_vog_scripts IS
  'Per-cue VOG script text and ElevenLabs voice; audio is generated on demand, not stored';
