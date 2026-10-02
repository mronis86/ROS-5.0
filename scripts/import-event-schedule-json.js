/**
 * Import japan-event-restore.json into production (one event only).
 *
 *   set PROD_DATABASE_URL=postgresql://...  (development AFTER revert to _old_)
 *   node scripts/import-event-schedule-json.js          # dry run
 *   set APPLY=1
 *   node scripts/import-event-schedule-json.js          # write
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const EVENT_ID =
  process.env.EVENT_ID || '0ebaf0be-c12b-41e0-9f04-9ec6db3bd9b6';
const PROD_URL = process.env.PROD_DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const IMPORT_PATH =
  process.env.IMPORT_PATH ||
  path.join(process.cwd(), 'japan-event-restore.json');
const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';

function noteStats(scheduleItems) {
  const items = Array.isArray(scheduleItems) ? scheduleItems : [];
  let rowsWithNotes = 0;
  let notesChars = 0;
  for (const item of items) {
    const n = item && item.notes != null ? String(item.notes) : '';
    if (n.trim()) {
      rowsWithNotes += 1;
      notesChars += n.length;
    }
  }
  return { itemCount: items.length, rowsWithNotes, notesChars };
}

async function main() {
  if (!PROD_URL) {
    console.error('Set PROD_DATABASE_URL to development (after revert)');
    process.exit(1);
  }
  if (!fs.existsSync(IMPORT_PATH)) {
    console.error('Missing file:', IMPORT_PATH);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(IMPORT_PATH, 'utf8'));
  if (payload.event_id !== EVENT_ID) {
    console.error('File event_id mismatch', payload.event_id, 'vs', EVENT_ID);
    process.exit(1);
  }

  const fileStats = noteStats(payload.schedule_items);
  console.log('File:', IMPORT_PATH, 'source_updated_at:', payload.source_updated_at, fileStats);

  const pool = new Pool({
    connectionString: PROD_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const cur = await pool.query(
      `SELECT updated_at, version, schedule_items
       FROM run_of_show_data WHERE event_id = $1 LIMIT 1`,
      [EVENT_ID]
    );
    if (!cur.rows.length) {
      console.error('No production row for', EVENT_ID);
      process.exit(1);
    }

    console.log('Target now:', cur.rows[0].updated_at, noteStats(cur.rows[0].schedule_items));
    console.log(APPLY ? 'Mode: APPLY' : 'Mode: DRY RUN');

    if (!APPLY) {
      console.log('\nRe-run with APPLY=1 to write this event only.');
      return;
    }

    if (fileStats.rowsWithNotes < 1) {
      console.error('Abort: file has no notes');
      process.exit(1);
    }

    const upd = await pool.query(
      `UPDATE run_of_show_data
       SET schedule_items = $1::jsonb,
           custom_columns = $2::jsonb,
           updated_at = NOW(),
           last_change_at = NOW(),
           version = COALESCE(version, 0) + 1
       WHERE event_id = $3
       RETURNING updated_at, version`,
      [
        JSON.stringify(payload.schedule_items ?? []),
        JSON.stringify(payload.custom_columns ?? []),
        EVENT_ID,
      ]
    );

    const verify = await pool.query(
      `SELECT schedule_items FROM run_of_show_data WHERE event_id = $1`,
      [EVENT_ID]
    );
    console.log('Updated:', upd.rows[0]);
    console.log('Verify:', noteStats(verify.rows[0].schedule_items));
    console.log('Done. Hard-refresh ROS.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
