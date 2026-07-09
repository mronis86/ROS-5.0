/**
 * Global app settings stored in Neon (single-row app_settings table).
 */

const VALID_LOGO_VARIANTS = new Set(['default', 'sinor']);

const APP_SETTINGS_DDL = `
  CREATE TABLE IF NOT EXISTS public.app_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    logo_variant_id TEXT NOT NULL DEFAULT 'default' CHECK (logo_variant_id IN ('default', 'sinor')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
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

async function readAppSettingsRow(pool) {
  const r = await pool.query(
    'SELECT logo_variant_id, updated_at FROM public.app_settings WHERE id = 1'
  );
  if (r.rows.length === 0) {
    return { logoVariantId: 'default', updatedAt: null };
  }
  const row = r.rows[0];
  return {
    logoVariantId: normalizeLogoVariantId(row.logo_variant_id),
    updatedAt: row.updated_at || null,
  };
}

function registerAppSettingsRoutes(app, pool, { requireAdminAccess }) {
  app.get('/api/app-settings', async (req, res) => {
    try {
      const settings = await readAppSettingsRow(pool);
      res.json({
        logoVariantId: settings.logoVariantId,
        updatedAt: settings.updatedAt,
        needsMigration: false,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({
          logoVariantId: 'default',
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
        updatedAt: settings.updatedAt,
        needsMigration: false,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({
          logoVariantId: 'default',
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
    const logoVariantId = normalizeLogoVariantId(req.body?.logoVariantId);
    if (!VALID_LOGO_VARIANTS.has(logoVariantId)) {
      return res.status(400).json({ error: 'logoVariantId must be default or sinor' });
    }
    try {
      await pool.query(
        `INSERT INTO public.app_settings (id, logo_variant_id, updated_at)
         VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE
         SET logo_variant_id = EXCLUDED.logo_variant_id,
             updated_at = NOW()`,
        [logoVariantId]
      );
      const settings = await readAppSettingsRow(pool);
      res.json({
        logoVariantId: settings.logoVariantId,
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
};
