/**
 * PowerPoint Mode 2 — ROS drives a Windows PowerPoint machine.
 * Manifest + heartbeat + queued web commands. Mode 1 stills stay in powerpoint-stills.js.
 */

const crypto = require('crypto');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { userCanAccessEvent } = require('./api-auth');
const { ensureEventCueFilesSchema, isBucketConfigured, getS3, getBucketConfig } = require('./event-cue-files');

const SIGNED_URL_TTL_SEC = 60 * 60;
const CONNECTED_STALE_MS = 20 * 1000;
const VALID_COMMANDS = new Set(['next', 'prev', 'goto', 'start', 'end']);

const DDL = `
  CREATE TABLE IF NOT EXISTS public.ppt_playback_sessions (
    event_id TEXT PRIMARY KEY,
    connected BOOLEAN NOT NULL DEFAULT false,
    last_seen TIMESTAMPTZ,
    deck_name TEXT NOT NULL DEFAULT '',
    slide_count INTEGER NOT NULL DEFAULT 0,
    slideshow_active BOOLEAN NOT NULL DEFAULT false,
    current_index INTEGER,
    current_item_id BIGINT,
    current_file_id TEXT,
    cache_ok INTEGER NOT NULL DEFAULT 0,
    cache_total INTEGER NOT NULL DEFAULT 0,
    last_command TEXT,
    last_command_id TEXT,
    last_error TEXT,
    queued_command JSONB,
    helper_mode TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS helper_mode TEXT NOT NULL DEFAULT '';
`;

function denyIfNoEventAccess(req, res, eventId) {
  if (req.auth && !userCanAccessEvent(req.auth, eventId)) {
    res.status(403).json({ error: 'You do not have access to this event.' });
    return true;
  }
  return false;
}

function isPptAssetName(name) {
  return /\.pptx?$/i.test(String(name || '').trim());
}

function parseScheduleItems(raw) {
  let items = raw;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  return Array.isArray(items) ? items : [];
}

function itemHasPpt(item) {
  if (!item || typeof item !== 'object') return false;
  return !!(item.hasPPT ?? item.has_ppt);
}

function sessionConnected(row) {
  if (!row || !row.connected || !row.last_seen) return false;
  return Date.now() - new Date(row.last_seen).getTime() <= CONNECTED_STALE_MS;
}

function normalizeHelperMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'follow' || mode === 'playback' ? mode : '';
}

function mapLoadedCue(cue) {
  return {
    itemId: cue?.itemId ?? null,
    cueLabel: cue?.cueLabel || '',
    segmentName: cue?.segmentName || '',
    timerState: cue?.timerState || null,
    hasPPT: !!cue?.hasPPT,
  };
}

function mapSession(row, loadedCue = null) {
  const cue = mapLoadedCue(loadedCue);
  const helperMode = normalizeHelperMode(row?.helper_mode);
  if (!row) {
    return {
      connected: false,
      helperMode: '',
      lastSeen: null,
      deckName: '',
      slideCount: 0,
      slideshowActive: false,
      currentIndex: null,
      currentItemId: null,
      currentFileId: null,
      cacheOk: 0,
      cacheTotal: 0,
      lastCommand: null,
      lastCommandId: null,
      lastError: null,
      queuedCommand: null,
      loadedItemId: cue.itemId,
      loadedCue: cue,
    };
  }
  const playbackLive = sessionConnected(row) && helperMode !== 'follow';
  return {
    connected: playbackLive,
    helperMode,
    lastSeen: row.last_seen || null,
    deckName: row.deck_name || '',
    slideCount: Number(row.slide_count) || 0,
    slideshowActive: !!row.slideshow_active && playbackLive,
    currentIndex: row.current_index != null ? Number(row.current_index) : null,
    currentItemId: row.current_item_id != null ? Number(row.current_item_id) : null,
    currentFileId: row.current_file_id || null,
    cacheOk: Number(row.cache_ok) || 0,
    cacheTotal: Number(row.cache_total) || 0,
    lastCommand: row.last_command || null,
    lastCommandId: row.last_command_id || null,
    lastError: row.last_error || null,
    queuedCommand: row.queued_command || null,
    loadedItemId: cue.itemId,
    loadedCue: cue,
  };
}

async function ensurePowerpointPlaybackSchema(pool) {
  await pool.query(DDL);
}

async function loadHasPptMap(pool, eventId) {
  const r = await pool.query(
    'SELECT schedule_items FROM public.run_of_show_data WHERE event_id = $1 LIMIT 1',
    [eventId]
  );
  const map = new Map();
  for (const item of parseScheduleItems(r.rows[0]?.schedule_items)) {
    const id = Number(item?.id);
    if (!Number.isFinite(id)) continue;
    map.set(id, itemHasPpt(item));
  }
  return map;
}

function cueLabelFromItem(item, itemId) {
  const raw = item?.customFields?.cue ?? item?.custom_fields?.cue ?? '';
  const text = String(raw || '').trim();
  if (text) {
    return /^CUE\s+/i.test(text) ? text.replace(/^CUE\s+/i, 'CUE ') : `CUE ${text}`;
  }
  return itemId != null ? `Item ${itemId}` : '';
}

async function loadLoadedCue(pool, eventId) {
  let itemId = null;
  let timerState = null;
  try {
    const r = await pool.query(
      `SELECT item_id, timer_state, is_running, is_active, cue_is
       FROM public.active_timers
       WHERE event_id = $1 AND (timer_state IN ('loaded', 'running') OR is_active = true)
       ORDER BY updated_at DESC LIMIT 1`,
      [eventId]
    );
    const row = r.rows[0];
    if (row?.item_id != null && Number.isFinite(Number(row.item_id))) {
      itemId = Number(row.item_id);
      if (row.is_running === true || row.timer_state === 'running') timerState = 'running';
      else if (row.timer_state === 'loaded' || row.is_active === true) timerState = 'loaded';
    }
  } catch {
    itemId = null;
  }
  if (itemId == null) {
    return { itemId: null, cueLabel: '', segmentName: '', timerState: null, hasPPT: false };
  }
  const hasPptMap = await loadHasPptMap(pool, eventId);
  const ros = await pool.query(
    'SELECT schedule_items FROM public.run_of_show_data WHERE event_id = $1 LIMIT 1',
    [eventId]
  );
  const item = parseScheduleItems(ros.rows[0]?.schedule_items).find((row) => Number(row?.id) === itemId);
  return {
    itemId,
    cueLabel: cueLabelFromItem(item, itemId) || String(itemId),
    segmentName: String(item?.segmentName || item?.segment_name || '').trim(),
    timerState,
    hasPPT: !!hasPptMap.get(itemId),
  };
}

async function buildManifest(pool, eventId) {
  await ensureEventCueFilesSchema(pool);
  const [filesRes, hasPptMap] = await Promise.all([
    pool.query(
      `SELECT * FROM public.event_cue_files
       WHERE event_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [eventId]
    ),
    loadHasPptMap(pool, eventId),
  ]);

  const preferredByItem = new Set();
  const assets = [];
  for (const row of filesRes.rows || []) {
    if (!isPptAssetName(row.original_name)) continue;
    const itemId = Number(row.item_id);
    const preferred = Number.isFinite(itemId) && !preferredByItem.has(itemId);
    if (preferred) preferredByItem.add(itemId);

    let downloadUrl = null;
    if (isBucketConfigured() && row.object_key) {
      try {
        const s3 = getS3();
        const { bucket } = getBucketConfig();
        downloadUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: row.object_key }),
          { expiresIn: SIGNED_URL_TTL_SEC }
        );
      } catch (err) {
        console.warn('[powerpoint-playback] signed URL failed:', err.message || err);
      }
    }

    assets.push({
      fileId: String(row.id),
      itemId: Number.isFinite(itemId) ? itemId : null,
      originalName: row.original_name,
      mimeType: row.mime_type || null,
      sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      createdAt: row.created_at,
      hasPPT: Number.isFinite(itemId) ? !!hasPptMap.get(itemId) : false,
      preferred,
      downloadUrl,
    });
  }

  return {
    eventId,
    assets,
    cuesWithPpt: [...hasPptMap.entries()].filter(([, flagged]) => flagged).map(([id]) => id),
    retentionHint: 'Cue files expire 4 months after upload. Recapture / re-upload to keep a current set.',
  };
}

async function loadPlaybackPayload(pool, eventId) {
  await ensurePowerpointPlaybackSchema(pool);
  const [sessionRes, loadedCue] = await Promise.all([
    pool.query('SELECT * FROM public.ppt_playback_sessions WHERE event_id = $1', [eventId]),
    loadLoadedCue(pool, eventId),
  ]);
  return { session: mapSession(sessionRes.rows[0], loadedCue) };
}

function registerPowerpointPlaybackRoutes(app, deps) {
  const { pool, broadcastUpdate } = deps;

  app.get('/api/powerpoint/:eventId/playback/manifest', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      const manifest = await buildManifest(pool, eventId);
      res.json(manifest);
    } catch (err) {
      console.error('[powerpoint-playback] manifest failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load playback manifest' });
    }
  });

  app.get('/api/powerpoint/:eventId/playback', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      res.json(await loadPlaybackPayload(pool, eventId));
    } catch (err) {
      console.error('[powerpoint-playback] GET failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load playback status' });
    }
  });

  app.post('/api/powerpoint/:eventId/playback/live', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);

      const body = req.body || {};
      const helperMode = normalizeHelperMode(body.helperMode || body.helper_mode) || 'playback';
      if (helperMode === 'follow') {
        await pool.query(
          `INSERT INTO public.ppt_playback_sessions (event_id, connected, last_seen, helper_mode, updated_at)
           VALUES ($1,false,NOW(),'follow',NOW())
           ON CONFLICT (event_id) DO UPDATE SET
             connected = false,
             last_seen = NOW(),
             helper_mode = 'follow',
             updated_at = NOW()`,
          [eventId]
        );
        const payload = await loadPlaybackPayload(pool, eventId);
        if (broadcastUpdate) broadcastUpdate(eventId, 'pptPlaybackStatus', payload);
        return res.json(payload);
      }

      const consumedId = body.lastCommandId || body.last_command_id || null;
      const existing = await pool.query(
        'SELECT queued_command FROM public.ppt_playback_sessions WHERE event_id = $1',
        [eventId]
      );
      const queued = existing.rows[0]?.queued_command || null;
      const clearQueue = consumedId && queued && String(queued.id) === String(consumedId);

      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (
           event_id, connected, last_seen, deck_name, slide_count, slideshow_active,
           current_index, current_item_id, current_file_id, cache_ok, cache_total,
           last_command, last_command_id, last_error, helper_mode, updated_at
         ) VALUES ($1,true,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'playback',NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           connected = true,
           last_seen = NOW(),
           helper_mode = 'playback',
           deck_name = COALESCE(EXCLUDED.deck_name, ppt_playback_sessions.deck_name),
           slide_count = COALESCE(EXCLUDED.slide_count, ppt_playback_sessions.slide_count),
           slideshow_active = EXCLUDED.slideshow_active,
           current_index = EXCLUDED.current_index,
           current_item_id = EXCLUDED.current_item_id,
           current_file_id = EXCLUDED.current_file_id,
           cache_ok = COALESCE(EXCLUDED.cache_ok, ppt_playback_sessions.cache_ok),
           cache_total = COALESCE(EXCLUDED.cache_total, ppt_playback_sessions.cache_total),
           last_command = COALESCE(EXCLUDED.last_command, ppt_playback_sessions.last_command),
           last_command_id = COALESCE(EXCLUDED.last_command_id, ppt_playback_sessions.last_command_id),
           last_error = EXCLUDED.last_error,
           queued_command = CASE WHEN $13 THEN NULL ELSE ppt_playback_sessions.queued_command END,
           updated_at = NOW()`,
        [
          eventId,
          body.deckName != null ? String(body.deckName) : '',
          body.slideCount != null ? Number(body.slideCount) || 0 : 0,
          body.slideshowActive === true || body.slideshow_active === true,
          body.currentIndex != null && Number.isFinite(Number(body.currentIndex))
            ? Number(body.currentIndex)
            : null,
          body.currentItemId != null && Number.isFinite(Number(body.currentItemId))
            ? Number(body.currentItemId)
            : null,
          body.currentFileId != null ? String(body.currentFileId) : null,
          body.cacheOk != null ? Number(body.cacheOk) || 0 : 0,
          body.cacheTotal != null ? Number(body.cacheTotal) || 0 : 0,
          body.lastCommand != null ? String(body.lastCommand) : null,
          consumedId,
          body.lastError != null ? String(body.lastError) : '',
          clearQueue,
        ]
      );

      const payload = await loadPlaybackPayload(pool, eventId);
      if (broadcastUpdate) broadcastUpdate(eventId, 'pptPlaybackStatus', payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint-playback] live failed:', err);
      res.status(500).json({ error: err.message || 'Failed to report playback status' });
    }
  });

  app.post('/api/powerpoint/:eventId/playback/command', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);

      const action = String(req.body?.action || '').trim().toLowerCase();
      if (!VALID_COMMANDS.has(action)) {
        return res.status(400).json({ error: 'action must be next, prev, goto, start, or end' });
      }
      const slideIndexRaw = req.body?.slideIndex ?? req.body?.slide_index;
      const slideIndex =
        slideIndexRaw != null && Number.isFinite(Number(slideIndexRaw))
          ? Number(slideIndexRaw)
          : null;
      if (action === 'goto' && !(slideIndex > 0)) {
        return res.status(400).json({ error: 'goto requires slideIndex >= 1' });
      }

      const command = {
        id: crypto.randomUUID(),
        action,
        slideIndex,
        createdAt: new Date().toISOString(),
      };

      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (event_id, queued_command, updated_at)
         VALUES ($1,$2::jsonb,NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           queued_command = EXCLUDED.queued_command,
           updated_at = NOW()`,
        [eventId, JSON.stringify(command)]
      );

      if (broadcastUpdate) broadcastUpdate(eventId, 'pptPlaybackCommand', command);
      const payload = await loadPlaybackPayload(pool, eventId);
      res.json({ ok: true, command, ...payload });
    } catch (err) {
      console.error('[powerpoint-playback] command failed:', err);
      res.status(500).json({ error: err.message || 'Failed to queue playback command' });
    }
  });
}

module.exports = {
  ensurePowerpointPlaybackSchema,
  registerPowerpointPlaybackRoutes,
  isPptAssetName,
  CONNECTED_STALE_MS,
};
