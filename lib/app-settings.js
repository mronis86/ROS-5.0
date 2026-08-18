/**
 * Global app settings stored in Neon (single-row app_settings table).
 */

const VALID_LOGO_VARIANTS = new Set(['default', 'sinor']);
const VALID_GREEN_ROOM_LAYOUTS = new Set(['classic', 'ros']);

const APP_SETTINGS_DDL = `
  CREATE TABLE IF NOT EXISTS public.app_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    logo_variant_id TEXT NOT NULL DEFAULT 'default' CHECK (logo_variant_id IN ('default', 'sinor')),
    green_room_layout_id TEXT NOT NULL DEFAULT 'classic',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS green_room_layout_id TEXT NOT NULL DEFAULT 'classic';
  INSERT INTO public.app_settings (id, logo_variant_id, updated_at)
  VALUES (1, 'default', NOW())
  ON CONFLICT (id) DO NOTHING;
`;

function isMissingTableError(err) {
  const msg = err?.message || '';
  return err?.code === '42P01' || (msg.includes('app_settings') && (msg.includes('does not exist') || msg.includes("doesn't exist")));
}

function normalizeLogoVariantId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return VALID_LOGO_VARIANTS.has(id) ? id : 'default';
}

function normalizeGreenRoomLayoutId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return VALID_GREEN_ROOM_LAYOUTS.has(id) ? id : 'classic';
}

function isMissingGreenRoomColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('green_room_layout_id');
}

async function ensureGreenRoomLayoutColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS green_room_layout_id TEXT NOT NULL DEFAULT 'classic'`
  );
}

async function readAppSettingsRow(pool) {
  try {
    const r = await pool.query(
      'SELECT logo_variant_id, green_room_layout_id, updated_at FROM public.app_settings WHERE id = 1'
    );
    if (r.rows.length === 0) {
      return { logoVariantId: 'default', greenRoomLayoutId: 'classic', updatedAt: null };
    }
    const row = r.rows[0];
    return {
      logoVariantId: normalizeLogoVariantId(row.logo_variant_id),
      greenRoomLayoutId: normalizeGreenRoomLayoutId(row.green_room_layout_id),
      updatedAt: row.updated_at || null,
    };
  } catch (err) {
    if (isMissingGreenRoomColumnError(err)) {
      await ensureGreenRoomLayoutColumn(pool);
      return readAppSettingsRow(pool);
    }
    throw err;
  }
}

function registerAppSettingsRoutes(app, pool, { requireAdminAccess }) {
  app.get('/api/app-settings', async (req, res) => {
    try {
      const settings = await readAppSettingsRow(pool);
      res.json({
        logoVariantId: settings.logoVariantId,
        greenRoomLayoutId: settings.greenRoomLayoutId,
        updatedAt: settings.updatedAt,
        needsMigration: false,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({
          logoVariantId: 'default',
          greenRoomLayoutId: 'classic',
          updatedAt: null,
          needsMigration: true,
        });
      }
      console.error('[app-settings GET] error:', err);
      res.status(500).json({ error: err.message || 'Failed to load app settings' });
    }
  });

  app.get('/api/admin/app-settings', async (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    try {
      const settings = await readAppSettingsRow(pool);
      res.json({
        logoVariantId: settings.logoVariantId,
        greenRoomLayoutId: settings.greenRoomLayoutId,
        updatedAt: settings.updatedAt,
        needsMigration: false,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({
          logoVariantId: 'default',
          greenRoomLayoutId: 'classic',
          updatedAt: null,
          needsMigration: true,
        });
      }
      console.error('[admin app-settings GET] error:', err);
      res.status(500).json({ error: err.message || 'Failed to load app settings' });
    }
  });

  app.put('/api/admin/app-settings', async (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    const hasLogo = req.body?.logoVariantId != null;
    const hasGreenRoom = req.body?.greenRoomLayoutId != null;
    if (hasLogo && !VALID_LOGO_VARIANTS.has(String(req.body.logoVariantId || '').trim())) {
      return res.status(400).json({ error: 'logoVariantId must be default or sinor' });
    }
    if (hasGreenRoom && !VALID_GREEN_ROOM_LAYOUTS.has(String(req.body.greenRoomLayoutId || '').trim())) {
      return res.status(400).json({ error: 'greenRoomLayoutId must be classic or ros' });
    }
    try {
      await ensureGreenRoomLayoutColumn(pool);
      const current = await readAppSettingsRow(pool);
      const nextLogo = hasLogo ? normalizeLogoVariantId(req.body.logoVariantId) : current.logoVariantId;
      const nextGreen = hasGreenRoom
        ? normalizeGreenRoomLayoutId(req.body.greenRoomLayoutId)
        : current.greenRoomLayoutId;
      await pool.query(
        `INSERT INTO public.app_settings (id, logo_variant_id, green_room_layout_id, updated_at)
         VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE
         SET logo_variant_id = EXCLUDED.logo_variant_id,
             green_room_layout_id = EXCLUDED.green_room_layout_id,
             updated_at = NOW()`,
        [nextLogo, nextGreen]
      );
      const settings = await readAppSettingsRow(pool);
      res.json({
        logoVariantId: settings.logoVariantId,
        greenRoomLayoutId: settings.greenRoomLayoutId,
        updatedAt: settings.updatedAt,
        needsMigration: false,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.status(503).json({
          error: 'Table app_settings does not exist. Run migration 034 on the same Neon database your API uses.',
          needsMigration: true,
        });
      }
      console.error('[admin app-settings PUT] error:', err);
      res.status(500).json({ error: err.message || 'Failed to save app settings' });
    }
  });

  app.post('/api/admin/app-settings/sync-table', async (req, res) => {
    if (!requireAdminAccess(req, res)) return;
    try {
      await pool.query(APP_SETTINGS_DDL);
      const settings = await readAppSettingsRow(pool);
      res.json({
        ok: true,
        logoVariantId: settings.logoVariantId,
        greenRoomLayoutId: settings.greenRoomLayoutId,
        updatedAt: settings.updatedAt,
        needsMigration: false,
      });
    } catch (err) {
      console.error('[admin app-settings sync-table] error:', err);
      res.status(500).json({ error: err.message || 'Failed to sync app_settings table' });
    }
  });
}

module.exports = {
  registerAppSettingsRoutes,
  VALID_LOGO_VARIANTS,
  VALID_GREEN_ROOM_LAYOUTS,
};
