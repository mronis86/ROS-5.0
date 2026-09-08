-- Event Board: conference setup and food & beverage notes.

ALTER TABLE public.event_board_data
  ADD COLUMN IF NOT EXISTS conference_setup TEXT NOT NULL DEFAULT '';

ALTER TABLE public.event_board_data
  ADD COLUMN IF NOT EXISTS food_beverage TEXT NOT NULL DEFAULT '';
