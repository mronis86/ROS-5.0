-- Per-event link: this ROS cue opens this script (and optionally jumps to a line).
CREATE TABLE IF NOT EXISTS public.script_cue_bindings (
  event_id TEXT NOT NULL,
  item_id BIGINT NOT NULL,
  script_id UUID NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  jump_line INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_script_cue_bindings_script
  ON public.script_cue_bindings (script_id);
