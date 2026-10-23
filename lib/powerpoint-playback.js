/**
 * PowerPoint Mode 2 — ROS drives a Windows PowerPoint machine.
 * Manifest + heartbeat + queued web commands. Mode 1 stills stay in powerpoint-stills.js.
 */

const crypto = require('crypto');
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { userCanAccessEvent } = require('./api-auth');
const { ensureEventCueFilesSchema, isBucketConfigured, getS3, getBucketConfig } = require('./event-cue-files');

const SIGNED_URL_TTL_SEC = 60 * 60;
const CONNECTED_STALE_MS = 20 * 1000;
const RETENTION_MONTHS = 1;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VALID_COMMANDS = new Set(['next', 'prev', 'goto', 'start', 'end', 'open', 'resume']);

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
  CREATE TABLE IF NOT EXISTS public.ppt_playback_previews (
    event_id TEXT NOT NULL,
    ppt_slide_id TEXT NOT NULL,
    slide_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    object_key TEXT,
    preview_data TEXT,
    mime_type TEXT DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    file_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, ppt_slide_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ppt_playback_previews_event_index
    ON public.ppt_playback_previews (event_id, slide_index);
`;

async function deletePreviewObject(objectKey) {
  if (!objectKey || !isBucketConfigured()) return;
  try {
    const s3 = getS3();
    const { bucket } = getBucketConfig();
    if (!s3 || !bucket) return;
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  } catch (err) {
    console.warn('[powerpoint-playback] S3 delete failed:', objectKey, err.message || err);
  }
}

async function cleanupExpiredPlaybackPreviews(pool) {
  await ensurePowerpointPlaybackSchema(pool);
  const expired = await pool.query(
    `SELECT event_id, ppt_slide_id, object_key
     FROM public.ppt_playback_previews
     WHERE updated_at < NOW() - make_interval(months => $1::int)
     ORDER BY updated_at ASC
     LIMIT 400`,
    [RETENTION_MONTHS]
  );
  if (!expired.rows.length) return { deleted: 0 };
  for (const row of expired.rows) {
    if (row.object_key) await deletePreviewObject(row.object_key);
  }
  await pool.query(
    `DELETE FROM public.ppt_playback_previews
     WHERE updated_at < NOW() - make_interval(months => $1::int)`,
    [RETENTION_MONTHS]
  );
  console.log(`[powerpoint-playback] expired previews cleanup: deleted ${expired.rows.length} slides`);
  return { deleted: expired.rows.length };
}

function startPowerpointPlaybackCleanup(pool) {
  const run = () => {
    cleanupExpiredPlaybackPreviews(pool).catch((err) => {
      console.warn('[powerpoint-playback] preview cleanup error:', err.message || err);
    });
  };
  setTimeout(run, 40 * 1000);
  setInterval(run, CLEANUP_INTERVAL_MS);
}

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

function timerStateFromRow(row) {
  if (!row) return null;
  if (row.is_active === false || String(row.timer_state || '').toLowerCase() === 'stopped') return null;
  if (row.is_running === true || String(row.timer_state || '').toLowerCase() === 'running') return 'running';
  if (String(row.timer_state || '').toLowerCase() === 'loaded' || row.is_active === true) return 'loaded';
  return null;
}

async function loadLoadedCue(pool, eventId) {
  let itemId = null;
  let timerState = null;
  try {
    const r = await pool.query(
      `SELECT item_id, timer_state, is_running, is_active
       FROM public.active_timers
       WHERE event_id = $1
         AND is_active IS NOT FALSE
         AND COALESCE(timer_state, '') <> 'stopped'
       ORDER BY updated_at DESC LIMIT 1`,
      [eventId]
    );
    const row = r.rows[0];
    timerState = timerStateFromRow(row);
    if (timerState && row?.item_id != null && Number.isFinite(Number(row.item_id))) {
      itemId = Number(row.item_id);
    }
  } catch {
    itemId = null;
    timerState = null;
  }
  if (itemId == null || !timerState) {
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

function decodePreviewBase64(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  const b64 = match ? match[2] : trimmed;
  const mime = match ? match[1] : 'image/jpeg';
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return null;
  return { buffer: buf, mimeType: mime || 'image/jpeg' };
}

async function loadPlaybackPreviews(pool, eventId) {
  await ensurePowerpointPlaybackSchema(pool);
  const rows = await pool.query(
    `SELECT ppt_slide_id, slide_index, title, object_key, preview_data, width, height
     FROM public.ppt_playback_previews
     WHERE event_id = $1
     ORDER BY slide_index ASC`,
    [eventId]
  );
  return (rows.rows || []).map((row) => ({
    pptSlideId: row.ppt_slide_id,
    slideIndex: Number(row.slide_index),
    title: row.title || '',
    hasImage: !!(row.object_key || row.preview_data),
    imageUrl: `/api/powerpoint/${encodeURIComponent(eventId)}/playback/previews/${encodeURIComponent(row.ppt_slide_id)}/image`,
    width: row.width != null ? Number(row.width) : 480,
    height: row.height != null ? Number(row.height) : 270,
  }));
}

async function loadPlaybackPayload(pool, eventId) {
  await ensurePowerpointPlaybackSchema(pool);
  const [sessionRes, loadedCue, previews] = await Promise.all([
    pool.query('SELECT * FROM public.ppt_playback_sessions WHERE event_id = $1', [eventId]),
    loadLoadedCue(pool, eventId),
    loadPlaybackPreviews(pool, eventId),
  ]);
  return { session: mapSession(sessionRes.rows[0], loadedCue), previews };
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

  app.post('/api/powerpoint/:eventId/playback/previews', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);

      const incoming = Array.isArray(req.body?.slides) ? req.body.slides : [];
      if (!incoming.length) return res.status(400).json({ error: 'slides[] required' });
      const fileId = req.body?.fileId != null ? String(req.body.fileId) : null;
      const keepIds = [];

      for (const slide of incoming) {
        const pptSlideId = String(slide.pptSlideId || slide.ppt_slide_id || slide.id || '').trim();
        const slideIndex = parseInt(slide.slideIndex ?? slide.slide_index ?? slide.index, 10);
        if (!pptSlideId || !Number.isFinite(slideIndex)) continue;
        keepIds.push(pptSlideId);
        const decoded = decodePreviewBase64(slide.imageBase64 || slide.image_base64 || '');
        if (decoded && decoded.buffer.length > 2 * 1024 * 1024) {
          return res.status(413).json({ error: `Preview for slide ${slideIndex} is too large (max 2 MB).` });
        }
        const existing = await pool.query(
          'SELECT object_key FROM public.ppt_playback_previews WHERE event_id = $1 AND ppt_slide_id = $2',
          [eventId, pptSlideId]
        );
        let objectKey = existing.rows[0]?.object_key || null;
        let previewData = null;
        if (decoded) {
          if (isBucketConfigured()) {
            const s3 = getS3();
            const { bucket } = getBucketConfig();
            const nextKey = `powerpoint-playback/${eventId}/${pptSlideId}.jpg`;
            await s3.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: nextKey,
                Body: decoded.buffer,
                ContentType: decoded.mimeType || 'image/jpeg',
              })
            );
            objectKey = nextKey;
          } else {
            previewData = decoded.buffer.toString('base64');
          }
        }
        await pool.query(
          `INSERT INTO public.ppt_playback_previews (
             event_id, ppt_slide_id, slide_index, title, object_key, preview_data,
             mime_type, width, height, file_id, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (event_id, ppt_slide_id) DO UPDATE SET
             slide_index = EXCLUDED.slide_index,
             title = EXCLUDED.title,
             object_key = COALESCE(EXCLUDED.object_key, ppt_playback_previews.object_key),
             preview_data = COALESCE(EXCLUDED.preview_data, ppt_playback_previews.preview_data),
             mime_type = COALESCE(EXCLUDED.mime_type, ppt_playback_previews.mime_type),
             width = COALESCE(EXCLUDED.width, ppt_playback_previews.width),
             height = COALESCE(EXCLUDED.height, ppt_playback_previews.height),
             file_id = COALESCE(EXCLUDED.file_id, ppt_playback_previews.file_id),
             updated_at = NOW()`,
          [
            eventId,
            pptSlideId,
            slideIndex,
            String(slide.title || '').trim(),
            objectKey,
            previewData,
            decoded?.mimeType || 'image/jpeg',
            slide.width != null ? parseInt(slide.width, 10) : 480,
            slide.height != null ? parseInt(slide.height, 10) : 270,
            fileId,
          ]
        );
      }

      if (keepIds.length) {
        await pool.query(
          `DELETE FROM public.ppt_playback_previews
           WHERE event_id = $1 AND NOT (ppt_slide_id = ANY($2::text[]))`,
          [eventId, keepIds]
        );
      }

      if (req.body?.deckName || keepIds.length) {
        await pool.query(
          `UPDATE public.ppt_playback_sessions
           SET slide_count = COALESCE($2, slide_count),
               deck_name = COALESCE($3, deck_name),
               updated_at = NOW()
           WHERE event_id = $1`,
          [eventId, keepIds.length || null, req.body?.deckName != null ? String(req.body.deckName) : null]
        );
      }

      const payload = await loadPlaybackPayload(pool, eventId);
      if (broadcastUpdate) broadcastUpdate(eventId, 'pptPlaybackStatus', payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint-playback] previews failed:', err);
      res.status(500).json({ error: err.message || 'Failed to save slide previews' });
    }
  });

  app.get('/api/powerpoint/:eventId/playback/previews/:slideId/image', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      const slideId = String(req.params.slideId || '').trim();
      if (!eventId || !slideId) return res.status(400).json({ error: 'eventId and slideId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);
      const r = await pool.query(
        'SELECT * FROM public.ppt_playback_previews WHERE event_id = $1 AND ppt_slide_id = $2',
        [eventId, slideId]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Preview not found' });

      if (row.object_key && isBucketConfigured()) {
        const s3 = getS3();
        const { bucket } = getBucketConfig();
        const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.object_key }));
        res.setHeader('Content-Type', row.mime_type || obj.ContentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        if (obj.Body?.pipe) return obj.Body.pipe(res);
        const chunks = [];
        for await (const chunk of obj.Body) chunks.push(chunk);
        return res.send(Buffer.concat(chunks));
      }
      if (row.preview_data) {
        res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(Buffer.from(row.preview_data, 'base64'));
      }
      return res.status(404).json({ error: 'No image stored for this slide' });
    } catch (err) {
      console.error('[powerpoint-playback] preview image failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load preview' });
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
        return res.status(400).json({ error: 'action must be next, prev, goto, start, end, open, or resume' });
      }
      const slideIndexRaw = req.body?.slideIndex ?? req.body?.slide_index;
      const slideIndex =
        slideIndexRaw != null && Number.isFinite(Number(slideIndexRaw))
          ? Number(slideIndexRaw)
          : null;
      if (action === 'goto' && !(slideIndex > 0)) {
        return res.status(400).json({ error: 'goto requires slideIndex >= 1' });
      }
      const itemIdRaw = req.body?.itemId ?? req.body?.item_id;
      const itemId =
        itemIdRaw != null && Number.isFinite(Number(itemIdRaw)) ? Number(itemIdRaw) : null;
      const fileId = req.body?.fileId != null ? String(req.body.fileId) : req.body?.file_id != null ? String(req.body.file_id) : null;
      if (action === 'open' && itemId == null && !fileId) {
        return res.status(400).json({ error: 'open requires itemId or fileId' });
      }

      const command = {
        id: crypto.randomUUID(),
        action,
        slideIndex,
        itemId,
        fileId,
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
  startPowerpointPlaybackCleanup,
  isPptAssetName,
  CONNECTED_STALE_MS,
  RETENTION_MONTHS,
};
