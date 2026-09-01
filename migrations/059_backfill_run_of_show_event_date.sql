-- Backfill blank run_of_show_data.event_date from calendar_events (event list source of truth).

UPDATE run_of_show_data AS ros
SET event_date = ce.date,
    updated_at = NOW()
FROM calendar_events AS ce
WHERE ce.id::text = ros.event_id::text
  AND ce.deleted_at IS NULL
  AND ce.date IS NOT NULL
  AND TRIM(ce.date::text) <> ''
  AND (ros.event_date IS NULL OR TRIM(ros.event_date::text) = '');
