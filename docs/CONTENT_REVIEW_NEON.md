# Content Review — Neon database

Content Review approval state (creative / ROS per cue), stream URL, and creative PDF URL are stored in Neon when the table exists.

## One-time setup

In the [Neon SQL Editor](https://console.neon.tech), run:

`migrations/025_create_content_review_data.sql`

## Table: `content_review_data`

| Column | Purpose |
|--------|---------|
| `event_id` | Primary key (matches calendar event) |
| `reviews` | JSON map: `item_id` → `{ creative: { status, note, ... }, ros: { ... } }` |
| `stream_url` | Optional live stream embed URL |
| `creative_pdf_url` | Optional creative deck / PDF embed URL |
| `active_stage` | `creative` or `ros` |
| `side_rail_width_px` | Review panel width preference |

## API

- `GET /api/content-review/:eventId`
- `PUT /api/content-review/:eventId`

If the table is missing, the API returns **503** with a message to run the migration.

## App behavior

- On load, the Content Review page reads Neon first, then falls back to browser `localStorage` and migrates local data to Neon on the next save.
- Changes auto-save to Neon (~900ms debounce) and still cache in `localStorage` for resilience.
