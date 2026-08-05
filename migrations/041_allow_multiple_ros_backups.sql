-- Allow multiple run-of-show backups per event per day (auto snapshots + manuals).
-- Previously a unique (event_id, event_date) index caused every backup to overwrite the day's only row.

DROP INDEX IF EXISTS public.idx_run_of_show_backups_unique_event_date;
DROP INDEX IF EXISTS public.idx_run_of_show_backups_event_date_unique;

COMMENT ON TABLE public.run_of_show_backups IS
  'Run of show schedule backups. Multiple rows per event/day allowed; auto backups are pruned by the API.';
