/**
 * Global app settings stored in Neon (single-row app_settings table).
 */

const VALID_LOGO_VARIANTS = new Set(['default', 'sinor']);
const VALID_GREEN_ROOM_LAYOUTS = new Set(['classic', 'ros']);
const VALID_COUNTDOWN_COLOR_MODES = new Set(['standard', 'white', 'bolderGreen']);
const VALID_OVERTIME_SIGNS = new Set(['minus', 'plus']);

const APP_SETTINGS_DDL = `
  CREATE TABLE IF NOT EXISTS public.app_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    logo_variant_id TEXT NOT NULL DEFAULT 'default' CHECK (logo_variant_id IN ('default', 'sinor')),
    green_room_layout_id TEXT NOT NULL DEFAULT 'classic',
    countdown_color_mode TEXT NOT NULL DEFAULT 'standard',
    hide_fullscreen_timer_option BOOLEAN NOT NULL DEFAULT false,
    auto_shot_type_from_speakers BOOLEAN NOT NULL DEFAULT false,
    show_live_sync_status_badge BOOLEAN NOT NULL DEFAULT false,
    overtime_sign TEXT NOT NULL DEFAULT 'minus',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS green_room_layout_id TEXT NOT NULL DEFAULT 'classic';
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS countdown_color_mode TEXT NOT NULL DEFAULT 'standard';
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS hide_fullscreen_timer_option BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS auto_shot_type_from_speakers BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS show_live_sync_status_badge BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS overtime_sign TEXT NOT NULL DEFAULT 'minus';
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS refresh_notice_version TEXT;
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS refresh_notice_date TEXT;
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS refresh_notice_seq INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS refresh_notice_at TIMESTAMPTZ;
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

function normalizeCountdownColorModeId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return VALID_COUNTDOWN_COLOR_MODES.has(id) ? id : 'standard';
}

function normalizeHideFullscreenTimerOption(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeAutoShotTypeFromSpeakers(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeShowLiveSyncStatusBadge(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeOvertimeSignId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return VALID_OVERTIME_SIGNS.has(id) ? id : 'minus';
}

function isMissingGreenRoomColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('green_room_layout_id');
}

function isMissingCountdownColorColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('countdown_color_mode');
}

function isMissingHideFullscreenTimerColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('hide_fullscreen_timer_option');
}

function isMissingAutoShotTypeFromSpeakersColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('auto_shot_type_from_speakers');
}

function isMissingShowLiveSyncStatusBadgeColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('show_live_sync_status_badge');
}

function isMissingOvertimeSignColumnError(err) {
  const msg = err?.message || '';
  return err?.code === '42703' || msg.includes('overtime_sign');
}

function isMissingRefreshNoticeColumnError(err) {
  const msg = err?.message || '';
  return (
    err?.code === '42703' &&
    /refresh_notice_(version|date|seq|at)/i.test(msg)
  );
}

function normalizeRefreshNotice(value) {
  if (value == null || value === false) {
    return { version: '', date: '', seq: 0, at: null };
  }
  if (typeof value === 'string') {
    const version = value.trim();
    return version ? { version, date: '', seq: 0, at: null } : { version: '', date: '', seq: 0, at: null };
  }
  if (typeof value !== 'object') {
    return { version: '', date: '', seq: 0, at: null };
  }
  const version = String(value.version || '').trim();
  if (!version) return { version: '', date: '', seq: 0, at: null };
  return {
    version,
    date: String(value.date || '').trim(),
    seq: Number(value.seq) || 0,
    at: value.at || null,
  };
}

function refreshNoticePayload(notice) {
  if (!notice?.version) return null;
  return {
    version: notice.version,
    date: notice.date || '',
    seq: Number(notice.seq) || 0,
    at: notice.at || null,
  };
}

async function ensureGreenRoomLayoutColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS green_room_layout_id TEXT NOT NULL DEFAULT 'classic'`
  );
}

async function ensureCountdownColorModeColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS countdown_color_mode TEXT NOT NULL DEFAULT 'standard'`
  );
}

async function ensureHideFullscreenTimerColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS hide_fullscreen_timer_option BOOLEAN NOT NULL DEFAULT false`
  );
}

async function ensureAutoShotTypeFromSpeakersColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS auto_shot_type_from_speakers BOOLEAN NOT NULL DEFAULT false`
  );
}

async function ensureShowLiveSyncStatusBadgeColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS show_live_sync_status_badge BOOLEAN NOT NULL DEFAULT false`
  );
}

async function ensureOvertimeSignColumn(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS overtime_sign TEXT NOT NULL DEFAULT 'minus'`
  );
}

async function ensureRefreshNoticeColumns(pool) {
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS refresh_notice_version TEXT`
  );
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS refresh_notice_date TEXT`
  );
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS refresh_notice_seq INTEGER NOT NULL DEFAULT 0`
  );
  await pool.query(
    `ALTER TABLE public.app_settings
     ADD COLUMN IF NOT EXISTS refresh_notice_at TIMESTAMPTZ`
  );
}

async function ensureAppSettingsColumns(pool) {
  await ensureGreenRoomLayoutColumn(pool);
  await ensureCountdownColorModeColumn(pool);
  await ensureHideFullscreenTimerColumn(pool);
  await ensureAutoShotTypeFromSpeakersColumn(pool);
  await ensureShowLiveSyncStatusBadgeColumn(pool);
  await ensureOvertimeSignColumn(pool);
  await ensureRefreshNoticeColumns(pool);
}

async function readAppSettingsRow(pool) {
  try {
    const r = await pool.query(
      `SELECT logo_variant_id, green_room_layout_id, countdown_color_mode,
              hide_fullscreen_timer_option, auto_shot_type_from_speakers,
              show_live_sync_status_badge, overtime_sign,
              refresh_notice_version, refresh_notice_date, refresh_notice_seq, refresh_notice_at,
              updated_at
       FROM public.app_settings WHERE id = 1`
    );
    if (r.rows.length === 0) {
      return {
        logoVariantId: 'default',
        greenRoomLayoutId: 'classic',
        countdownColorModeId: 'standard',
        hideFullscreenTimerOption: false,
        autoShotTypeFromSpeakers: false,
        showLiveSyncStatusBadge: false,
        overtimeSignId: 'minus',
        refreshNotice: { version: '', date: '', seq: 0, at: null },
        updatedAt: null,
      };
    }
    const row = r.rows[0];
    return {
      logoVariantId: normalizeLogoVariantId(row.logo_variant_id),
      greenRoomLayoutId: normalizeGreenRoomLayoutId(row.green_room_layout_id),
      countdownColorModeId: normalizeCountdownColorModeId(row.countdown_color_mode),
      hideFullscreenTimerOption: normalizeHideFullscreenTimerOption(row.hide_fullscreen_timer_option),
      autoShotTypeFromSpeakers: normalizeAutoShotTypeFromSpeakers(row.auto_shot_type_from_speakers),
      showLiveSyncStatusBadge: normalizeShowLiveSyncStatusBadge(row.show_live_sync_status_badge),
      overtimeSignId: normalizeOvertimeSignId(row.overtime_sign),
      refreshNotice: normalizeRefreshNotice({
        version: row.refresh_notice_version,
        date: row.refresh_notice_date,
        seq: row.refresh_notice_seq,
        at: row.refresh_notice_at,
      }),
      updatedAt: row.updated_at || null,
    };
  } catch (err) {
    if (
      isMissingGreenRoomColumnError(err) ||
      isMissingCountdownColorColumnError(err) ||
      isMissingHideFullscreenTimerColumnError(err) ||
      isMissingAutoShotTypeFromSpeakersColumnError(err) ||
      isMissingShowLiveSyncStatusBadgeColumnError(err) ||
      isMissingOvertimeSignColumnError(err) ||
      isMissingRefreshNoticeColumnError(err)
    ) {
      await ensureAppSettingsColumns(pool);
      return readAppSettingsRow(pool);
    }
    throw err;
  }
}

function settingsPayload(settings) {
  return {
    logoVariantId: settings.logoVariantId,
    greenRoomLayoutId: settings.greenRoomLayoutId,
    countdownColorModeId: settings.countdownColorModeId,
    hideFullscreenTimerOption: !!settings.hideFullscreenTimerOption,
    autoShotTypeFromSpeakers: !!settings.autoShotTypeFromSpeakers,
    showLiveSyncStatusBadge: !!settings.showLiveSyncStatusBadge,
    overtimeSignId: settings.overtimeSignId || 'minus',
    refreshNotice: refreshNoticePayload(settings.refreshNotice),
    updatedAt: settings.updatedAt,
    needsMigration: false,
  };
}

function registerAppSettingsRoutes(app, pool, { requireAdminAccess }) {
  app.get('/api/app-settings', async (req, res) => {
    try {
      const settings = await readAppSettingsRow(pool);
      res.json(settingsPayload(settings));
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({
          logoVariantId: 'default',
          greenRoomLayoutId: 'classic',
          countdownColorModeId: 'standard',
          hideFullscreenTimerOption: false,
          autoShotTypeFromSpeakers: false,
          showLiveSyncStatusBadge: false,
          overtimeSignId: 'minus',
          refreshNotice: null,
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
      res.json(settingsPayload(settings));
    } catch (err) {
      if (isMissingTableError(err)) {
        return res.json({
          logoVariantId: 'default',
          greenRoomLayoutId: 'classic',
          countdownColorModeId: 'standard',
          hideFullscreenTimerOption: false,
          autoShotTypeFromSpeakers: false,
          showLiveSyncStatusBadge: false,
          overtimeSignId: 'minus',
          refreshNotice: null,
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
    const hasCountdown = req.body?.countdownColorModeId != null;
    const hasHideFullscreen = req.body?.hideFullscreenTimerOption != null;
    const hasAutoShotType = req.body?.autoShotTypeFromSpeakers != null;
    const hasShowLiveSyncBadge = req.body?.showLiveSyncStatusBadge != null;
    const hasOvertimeSign = req.body?.overtimeSignId != null;
    const hasRefreshNotice = Object.prototype.hasOwnProperty.call(req.body || {}, 'refreshNotice');
    if (hasLogo && !VALID_LOGO_VARIANTS.has(String(req.body.logoVariantId || '').trim())) {
      return res.status(400).json({ error: 'logoVariantId must be default or sinor' });
    }
    if (hasGreenRoom && !VALID_GREEN_ROOM_LAYOUTS.has(String(req.body.greenRoomLayoutId || '').trim())) {
      return res.status(400).json({ error: 'greenRoomLayoutId must be classic or ros' });
    }
    if (hasCountdown && !VALID_COUNTDOWN_COLOR_MODES.has(String(req.body.countdownColorModeId || '').trim())) {
      return res.status(400).json({ error: 'countdownColorModeId must be standard, white, or bolderGreen' });
    }
    if (hasOvertimeSign && !VALID_OVERTIME_SIGNS.has(String(req.body.overtimeSignId || '').trim())) {
      return res.status(400).json({ error: 'overtimeSignId must be minus or plus' });
    }
    try {
      await ensureAppSettingsColumns(pool);
      const current = await readAppSettingsRow(pool);
      const nextLogo = hasLogo ? normalizeLogoVariantId(req.body.logoVariantId) : current.logoVariantId;
      const nextGreen = hasGreenRoom
        ? normalizeGreenRoomLayoutId(req.body.greenRoomLayoutId)
        : current.greenRoomLayoutId;
      const nextCountdown = hasCountdown
        ? normalizeCountdownColorModeId(req.body.countdownColorModeId)
        : current.countdownColorModeId;
      const nextHideFullscreen = hasHideFullscreen
        ? normalizeHideFullscreenTimerOption(req.body.hideFullscreenTimerOption)
        : current.hideFullscreenTimerOption;
      const nextAutoShotType = hasAutoShotType
        ? normalizeAutoShotTypeFromSpeakers(req.body.autoShotTypeFromSpeakers)
        : current.autoShotTypeFromSpeakers;
      const nextShowLiveSyncBadge = hasShowLiveSyncBadge
        ? normalizeShowLiveSyncStatusBadge(req.body.showLiveSyncStatusBadge)
        : current.showLiveSyncStatusBadge;
      const nextOvertimeSign = hasOvertimeSign
        ? normalizeOvertimeSignId(req.body.overtimeSignId)
        : current.overtimeSignId;
      const nextNotice = hasRefreshNotice
        ? normalizeRefreshNotice(req.body.refreshNotice)
        : current.refreshNotice || { version: '', date: '', seq: 0, at: null };
      const noticeAt = hasRefreshNotice
        ? nextNotice.version
          ? new Date().toISOString()
          : null
        : nextNotice.at || null;
      await pool.query(
        `INSERT INTO public.app_settings (
           id, logo_variant_id, green_room_layout_id, countdown_color_mode,
           hide_fullscreen_timer_option, auto_shot_type_from_speakers,
           show_live_sync_status_badge, overtime_sign,
           refresh_notice_version, refresh_notice_date, refresh_notice_seq, refresh_notice_at,
           updated_at
         )
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (id) DO UPDATE
         SET logo_variant_id = EXCLUDED.logo_variant_id,
             green_room_layout_id = EXCLUDED.green_room_layout_id,
             countdown_color_mode = EXCLUDED.countdown_color_mode,
             hide_fullscreen_timer_option = EXCLUDED.hide_fullscreen_timer_option,
             auto_shot_type_from_speakers = EXCLUDED.auto_shot_type_from_speakers,
             show_live_sync_status_badge = EXCLUDED.show_live_sync_status_badge,
             overtime_sign = EXCLUDED.overtime_sign,
             refresh_notice_version = EXCLUDED.refresh_notice_version,
             refresh_notice_date = EXCLUDED.refresh_notice_date,
             refresh_notice_seq = EXCLUDED.refresh_notice_seq,
             refresh_notice_at = EXCLUDED.refresh_notice_at,
             updated_at = NOW()`,
        [
          nextLogo,
          nextGreen,
          nextCountdown,
          nextHideFullscreen,
          nextAutoShotType,
          nextShowLiveSyncBadge,
          nextOvertimeSign,
          nextNotice.version || null,
          nextNotice.date || null,
          nextNotice.seq || 0,
          noticeAt,
        ]
      );
      const settings = await readAppSettingsRow(pool);
      res.json(settingsPayload(settings));
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
        ...settingsPayload(settings),
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
  VALID_COUNTDOWN_COLOR_MODES,
  VALID_OVERTIME_SIGNS,
};
