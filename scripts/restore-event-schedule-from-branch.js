/**
 * Copy one event's schedule_items (+ custom_columns) from a Neon recovery
 * branch / timestamp DB into production. Does not touch other events.
 *
 * Usage:
 *   # Dry run (default) — shows note counts only
 *   set RECOVER_DATABASE_URL=postgresql://...recovery...
 *   set PROD_DATABASE_URL=postgresql://...production...
 *   node scripts/restore-event-schedule-from-branch.js
 *
 *   # Actually write to production
 *   set APPLY=1
 *   node scripts/restore-event-schedule-from-branch.js
 *
 * Optional:
 *   set EVENT_ID=0ebaf0be-c12b-41e0-9f04-9ec6db3bd9b6
 */
const { Pool } = require('pg');

const EVENT_ID =
  process.env.EVENT_ID || '0ebaf0be-c12b-41e0-9f04-9ec6db3bd9b6';
const RECOVER_URL = process.env.RECOVER_DATABASE_URL;
const PROD_URL = process.env.PROD_DATABASE_URL || process.env.NEON_DATABASE_URL;
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
  if (!RECOVER_URL) {
    console.error('Missing RECOVER_DATABASE_URL (connection string for the 3:41 recovery branch)');
    process.exit(1);
  }
  if (!PROD_URL) {
    console.error('Missing PROD_DATABASE_URL (or NEON_DATABASE_URL) for production');
    process.exit(1);
  }
  if (RECOVER_URL === PROD_URL) {
    console.error('RECOVER_DATABASE_URL and PROD_DATABASE_URL must be different');
    process.exit(1);
  }

  const recover = new Pool({ connectionString: RECOVER_URL, ssl: { rejectUnauthorized: false } });
  const prod = new Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  try {
    const src = await recover.query(
      `SELECT schedule_items, custom_columns, updated_at, version
       FROM run_of_show_data
       WHERE event_id = $1
       LIMIT 1`,
      [EVENT_ID]
    );
    if (!src.rows.length) {
      console.error('No run_of_show_data row on RECOVERY for', EVENT_ID);
      process.exit(1);
    }

    const dst = await prod.query(
      `SELECT schedule_items, custom_columns, updated_at, version
       FROM run_of_show_data
       WHERE event_id = $1
       LIMIT 1`,
      [EVENT_ID]
    );
    if (!dst.rows.length) {
      console.error('No run_of_show_data row on PRODUCTION for', EVENT_ID);
      process.exit(1);
    }

    const from = src.rows[0];
    const to = dst.rows[0];
    const fromStats = noteStats(from.schedule_items);
    const toStats = noteStats(to.schedule_items);

    console.log('Event:', EVENT_ID);
    console.log('RECOVERY  updated_at:', from.updated_at, fromStats);
    console.log('PRODUCTION updated_at:', to.updated_at, toStats);
    console.log(APPLY ? 'Mode: APPLY (will write production)' : 'Mode: DRY RUN (no write)');

    if (!APPLY) {
      console.log('\nLooks good? Re-run with APPLY=1 to update only this event on production.');
      return;
    }

    if (fromStats.rowsWithNotes < 1) {
      console.error('Abort: recovery snapshot has no notes');
      process.exit(1);
    }

    const upd = await prod.query(
      `UPDATE run_of_show_data
       SET schedule_items = $1::jsonb,
           custom_columns = $2::jsonb,
           updated_at = NOW(),
           last_change_at = NOW(),
           version = COALESCE(version, 0) + 1
       WHERE event_id = $3
       RETURNING updated_at, version`,
      [
        JSON.stringify(from.schedule_items ?? []),
        JSON.stringify(from.custom_columns ?? []),
        EVENT_ID,
      ]
    );

    const verify = await prod.query(
      `SELECT schedule_items, updated_at, version
       FROM run_of_show_data WHERE event_id = $1`,
      [EVENT_ID]
    );
    const vStats = noteStats(verify.rows[0].schedule_items);
    console.log('Updated production:', upd.rows[0]);
    console.log('Verify notes:', vStats);
    console.log('Done. Hard-refresh ROS for this event.');
  } finally {
    await recover.end();
    await prod.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
