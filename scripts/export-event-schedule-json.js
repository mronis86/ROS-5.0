/**
 * Export one event's schedule_items + custom_columns to a local JSON file.
 *
 *   set DATABASE_URL=postgresql://...   (restored branch that HAS the notes)
 *   node scripts/export-event-schedule-json.js
 *
 * Writes: ./japan-event-restore.json (or EXPORT_PATH)
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const EVENT_ID =
  process.env.EVENT_ID || '0ebaf0be-c12b-41e0-9f04-9ec6db3bd9b6';
const DATABASE_URL = process.env.DATABASE_URL || process.env.RECOVER_DATABASE_URL;
const EXPORT_PATH =
  process.env.EXPORT_PATH ||
  path.join(process.cwd(), 'japan-event-restore.json');

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
  if (!DATABASE_URL) {
    console.error('Set DATABASE_URL to the restored branch connection string');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { rows } = await pool.query(
      `SELECT event_id, schedule_items, custom_columns, updated_at, version
       FROM run_of_show_data
       WHERE event_id = $1
       LIMIT 1`,
      [EVENT_ID]
    );
    if (!rows.length) {
      console.error('No row for', EVENT_ID);
      process.exit(1);
    }

    const row = rows[0];
    const stats = noteStats(row.schedule_items);
    console.log('Exported from updated_at:', row.updated_at, stats);

    if (stats.rowsWithNotes < 1) {
      console.error('Abort: this DB has no notes — wrong branch/URL');
      process.exit(1);
    }

    const payload = {
      event_id: row.event_id,
      source_updated_at: row.updated_at,
      exported_at: new Date().toISOString(),
      schedule_items: row.schedule_items,
      custom_columns: row.custom_columns,
      stats,
    };

    fs.writeFileSync(EXPORT_PATH, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Wrote', EXPORT_PATH);
    console.log('Next: revert development to the _old_ backup, then run import script.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
