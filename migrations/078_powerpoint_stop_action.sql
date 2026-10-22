-- Allow a PowerPoint slide to stop the running clock.
ALTER TABLE public.ppt_slide_bindings
  DROP CONSTRAINT IF EXISTS ppt_slide_bindings_action_check;

ALTER TABLE public.ppt_slide_bindings
  ADD CONSTRAINT ppt_slide_bindings_action_check
  CHECK (action IN ('none', 'load', 'load_start', 'start', 'stop'));
