/**
 * Extended Event Controls — Neon table `extended_event_data` keyed by event_id.
 * Keeps specialty module payloads (e.g. Civics Bee) out of run_of_show_data.settings.
 */

const KNOWN_MODULES = new Set(['civicsBee']);

let schemaReady = false;

function normalizeModules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => typeof m === 'string' && KNOWN_MODULES.has(m));
}

function parseModuleData(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function ensureExtendedEventDataSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS extended_event_data (
      event_id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      modules JSONB NOT NULL DEFAULT '[]'::jsonb,
      module_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_extended_event_data_enabled
      ON extended_event_data (enabled)
      WHERE enabled = TRUE
  `);
  schemaReady = true;
}

function rowToConfig(row) {
  if (!row) return { enabled: false, modules: [], moduleData: {} };
  return {
    enabled: row.enabled === true,
    modules: normalizeModules(
      typeof row.modules === 'string' ? JSON.parse(row.modules) : row.modules
    ),
    moduleData: parseModuleData(row.module_data),
  };
}

async function loadExtendEventControls(pool, eventId) {
  if (!eventId) return { enabled: false, modules: [], moduleData: {} };
  await ensureExtendedEventDataSchema(pool);
  const result = await pool.query(
    `SELECT event_id, enabled, modules, module_data, updated_at
     FROM extended_event_data
     WHERE event_id = $1
     LIMIT 1`,
    [String(eventId)]
  );
  return rowToConfig(result.rows[0]);
}

async function loadExtendEventControlsMap(pool, eventIds) {
  await ensureExtendedEventDataSchema(pool);
  const ids = (eventIds || []).map((id) => String(id)).filter(Boolean);
  const map = new Map();
  if (!ids.length) return map;
  const result = await pool.query(
    `SELECT event_id, enabled, modules, module_data
     FROM extended_event_data
     WHERE event_id = ANY($1::text[])`,
    [ids]
  );
  for (const row of result.rows) {
    map.set(String(row.event_id), rowToConfig(row));
  }
  return map;
}

async function assertCalendarEventExists(pool, calendarEventId) {
  const existing = await pool.query(
    `SELECT id FROM calendar_events
     WHERE id::text = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [String(calendarEventId)]
  );
  return existing.rows.length > 0;
}

async function setExtendEventControls(pool, calendarEventId, { enabled, modules }) {
  await ensureExtendedEventDataSchema(pool);
  const id = String(calendarEventId);
  if (!(await assertCalendarEventExists(pool, id))) {
    return { ok: false, status: 404, error: 'Calendar event not found' };
  }

  const nextModules = normalizeModules(modules);
  const nextEnabled = enabled === true;

  const updated = await pool.query(
    `INSERT INTO extended_event_data (event_id, enabled, modules, module_data, updated_at)
     VALUES ($1, $2, $3::jsonb, '{}'::jsonb, NOW())
     ON CONFLICT (event_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       modules = EXCLUDED.modules,
       updated_at = NOW()
     RETURNING event_id, enabled, modules, module_data`,
    [id, nextEnabled, JSON.stringify(nextModules)]
  );

  return {
    ok: true,
    config: rowToConfig(updated.rows[0]),
  };
}

async function saveExtendModuleData(pool, eventId, moduleKey, payload) {
  await ensureExtendedEventDataSchema(pool);
  const id = String(eventId);
  if (!KNOWN_MODULES.has(moduleKey)) {
    return { ok: false, status: 400, error: `Unknown module: ${moduleKey}` };
  }
  if (!(await assertCalendarEventExists(pool, id))) {
    return { ok: false, status: 404, error: 'Calendar event not found' };
  }

  const existing = await pool.query(
    `SELECT module_data, enabled, modules FROM extended_event_data WHERE event_id = $1 LIMIT 1`,
    [id]
  );
  const prev = parseModuleData(existing.rows[0]?.module_data);
  const nextData = { ...prev, [moduleKey]: payload };

  const updated = await pool.query(
    `INSERT INTO extended_event_data (event_id, enabled, modules, module_data, updated_at)
     VALUES ($1, COALESCE($2, FALSE), COALESCE($3::jsonb, '[]'::jsonb), $4::jsonb, NOW())
     ON CONFLICT (event_id) DO UPDATE SET
       module_data = EXCLUDED.module_data,
       updated_at = NOW()
     RETURNING event_id, enabled, modules, module_data`,
    [
      id,
      existing.rows[0]?.enabled === true,
      JSON.stringify(normalizeModules(existing.rows[0]?.modules)),
      JSON.stringify(nextData),
    ]
  );

  return { ok: true, config: rowToConfig(updated.rows[0]) };
}

module.exports = {
  KNOWN_MODULES,
  ensureExtendedEventDataSchema,
  loadExtendEventControls,
  loadExtendEventControlsMap,
  setExtendEventControls,
  saveExtendModuleData,
  normalizeModules,
};
