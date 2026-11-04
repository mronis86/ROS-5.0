/**
 * Feature Updates changelog (Admin-editable JSON document in Neon).
 */

const crypto = require('crypto');

const FEATURE_UPDATES_DDL = `
  CREATE TABLE IF NOT EXISTS public.feature_updates (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    document JSONB NOT NULL DEFAULT '{"months":[]}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT,
    updated_by_name TEXT
  );
  INSERT INTO public.feature_updates (id, document, updated_at)
  VALUES (1, '{"months":[]}'::jsonb, NOW())
  ON CONFLICT (id) DO NOTHING;
`;

function isMissingTableError(err) {
  const msg = err?.message || '';
  return err?.code === '42P01' || (msg.includes('feature_updates') && (msg.includes('does not exist') || msg.includes("doesn't exist")));
}

function newId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  if (!title) return null;
  const detail = String(raw.detail || '').trim();
  const forWho = String(raw.forWho || raw.for_who || '').trim();
  return {
    id: String(raw.id || newId('item')),
    title,
    ...(detail ? { detail } : {}),
    ...(forWho ? { forWho } : {}),
  };
}

function normalizeWeek(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = String(raw.label || '').trim() || 'Week';
  const rangeLabel = String(raw.rangeLabel || raw.range_label || '').trim();
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter(Boolean)
    : [];
  return {
    id: String(raw.id || newId('week')),
    label,
    rangeLabel,
    items,
  };
}

function normalizeMonth(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = String(raw.label || '').trim();
  if (!label) return null;
  const weeks = Array.isArray(raw.weeks)
    ? raw.weeks.map(normalizeWeek).filter(Boolean)
    : [];
  const emptyMessage = String(raw.emptyMessage || raw.empty_message || '').trim();
  return {
    id: String(raw.id || newId('month')),
    label,
    weeks,
    ...(emptyMessage ? { emptyMessage } : {}),
  };
}

function normalizeDocument(raw) {
  const months = Array.isArray(raw?.months)
    ? raw.months.map(normalizeMonth).filter(Boolean)
    : [];
  return { months };
}

async function ensureFeatureUpdatesTable(pool) {
  await pool.query(FEATURE_UPDATES_DDL);
}

async function readFeatureUpdatesRow(pool) {
  await ensureFeatureUpdatesTable(pool);
  const result = await pool.query(
    'SELECT document, updated_at, updated_by, updated_by_name FROM public.feature_updates WHERE id = 1'
  );
  if (!result.rows.length) {
    return {
      document: { months: [] },
      updatedAt: null,
      updatedBy: null,
      updatedByName: null,
    };
  }
  const row = result.rows[0];
  return {
    document: normalizeDocument(row.document || {}),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
  };
}

function registerFeatureUpdatesRoutes(app, pool, { requireAdminAccess }) {
  app.get('/api/feature-updates', async (req, res) => {
    try {
      const row = await readFeatureUpdatesRow(pool);
      res.json({
        ...row.document,
        updatedAt: row.updatedAt,
        updatedByName: row.updatedByName,
        empty: !row.document.months.length,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({ months: [], updatedAt: null, empty: true, needsMigration: true });
      }
      console.error('[feature-updates GET]', err);
      res.status(500).json({ error: err.message || 'Failed to load feature updates' });
    }
  });

  app.put('/api/admin/feature-updates', async (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    try {
      const document = normalizeDocument(req.body || {});
      await ensureFeatureUpdatesTable(pool);
      const result = await pool.query(
        `INSERT INTO public.feature_updates (id, document, updated_at, updated_by, updated_by_name)
         VALUES (1, $1::jsonb, NOW(), $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET document = EXCLUDED.document,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by,
             updated_by_name = EXCLUDED.updated_by_name
         RETURNING document, updated_at, updated_by, updated_by_name`,
        [
          JSON.stringify(document),
          req.auth?.userId || null,
          req.auth?.fullName || req.auth?.email || 'Admin',
        ]
      );
      const row = result.rows[0];
      res.json({
        ...normalizeDocument(row.document || {}),
        updatedAt: row.updated_at || null,
        updatedByName: row.updated_by_name || null,
        empty: false,
      });
    } catch (err) {
      console.error('[feature-updates PUT]', err);
      res.status(500).json({ error: err.message || 'Failed to save feature updates' });
    }
  });
}

module.exports = {
  registerFeatureUpdatesRoutes,
  normalizeDocument,
  FEATURE_UPDATES_DDL,
};
