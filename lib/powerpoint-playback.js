/**
 * PowerPoint Mode 2 — ROS drives a Windows PowerPoint machine.
 * Manifest + heartbeat + queued web commands. Mode 1 stills stay in powerpoint-stills.js.
 */

const crypto = require('crypto');
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { userCanAccessEvent } = require('./api-auth');
const { ensureEventCueFilesSchema, isBucketConfigured, getS3, getBucketConfig } = require('./event-cue-files');
const { sanitizeVdoViewUrl, normalizeLiveCaptureSource } = require('./vdo-ninja');
const { normalizeCacheFiles, listPendingDeckUpdates } = require('./ppt-pending-updates');

const SIGNED_URL_TTL_SEC = 60 * 60;
const CONNECTED_STALE_MS = 20 * 1000;
const LIVE_CAPTURE_STALE_MS = 25 * 1000;
const RETENTION_MONTHS = 1;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VALID_COMMANDS = new Set([
  'next',
  'prev',
  'goto',
  'start',
  'end',
  'open',
  'resume',
  'sync',
  'clear-previews',
]);

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
    live_capture_url TEXT NOT NULL DEFAULT '',
    live_capture_active BOOLEAN NOT NULL DEFAULT false,
    live_capture_source TEXT NOT NULL DEFAULT '',
    live_capture_last_seen TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS helper_mode TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS live_capture_url TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS live_capture_active BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS live_capture_source TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS live_capture_last_seen TIMESTAMPTZ;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS cache_files JSONB;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS clock_auto_push BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS clock_suppress_item_id BIGINT;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS cue_follow_auto BOOLEAN NOT NULL DEFAULT true;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS live_path TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS open_match TEXT NOT NULL DEFAULT '';
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS open_stale BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE public.ppt_playback_sessions
    ADD COLUMN IF NOT EXISTS selected_day INTEGER NOT NULL DEFAULT 1;
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
  CREATE INDEX IF NOT EXISTS idx_ppt_playback_previews_event_file
    ON public.ppt_playback_previews (event_id, file_id);
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

function itemDayNumber(item) {
  const n = Number(item?.day ?? item?.dayNumber ?? item?.day_number);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function scheduleDayMap(items) {
  const map = new Map();
  for (const item of parseScheduleItems(items)) {
    const id = Number(item?.id);
    if (!Number.isFinite(id) || map.has(id)) continue;
    map.set(id, itemDayNumber(item));
  }
  return map;
}

function calendarShowDay(eventDate, numberOfDays, now = new Date()) {
  const raw = String(eventDate || '').slice(0, 10);
  const parts = raw.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const start = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayIndex = Math.round((today - start) / 86400000);
  if (dayIndex < 0 || dayIndex >= days) return null;
  return dayIndex + 1;
}

async function loadEventDayMeta(pool, eventId) {
  const empty = { eventDate: '', numberOfDays: 1 };
  try {
    const r = await pool.query(
      `SELECT date::text AS date, schedule_data
       FROM public.calendar_events
       WHERE id::text = $1
       LIMIT 1`,
      [eventId]
    );
    const row = r.rows[0];
    if (!row) return empty;
    const sd = row.schedule_data && typeof row.schedule_data === 'object' ? row.schedule_data : {};
    return {
      eventDate: String(row.date || '').slice(0, 10),
      numberOfDays: Math.max(1, Math.floor(Number(sd.numberOfDays || sd.number_of_days) || 1)),
    };
  } catch {
    return empty;
  }
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
    day: itemDayNumber(cue),
  };
}

function liveCaptureFresh(row) {
  if (!row?.live_capture_last_seen) return false;
  return Date.now() - new Date(row.live_capture_last_seen).getTime() <= LIVE_CAPTURE_STALE_MS;
}

function mapLiveCapture(row) {
  const viewUrl = sanitizeVdoViewUrl(row?.live_capture_url || '');
  const active = !!row?.live_capture_active && !!viewUrl && liveCaptureFresh(row);
  return {
    liveCaptureUrl: viewUrl,
    liveCaptureActive: active,
    liveCaptureSource: row?.live_capture_source === 'camera' ? 'camera' : viewUrl ? 'screen' : '',
  };
}

function mapSession(row, loadedCue = null) {
  const cue = mapLoadedCue(loadedCue);
  const helperMode = normalizeHelperMode(row?.helper_mode);
  const capture = mapLiveCapture(row);
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
      clockAutoPush: false,
      clockSuppressItemId: null,
      cueFollowAuto: true,
      livePath: '',
      openMatch: '',
      openStale: false,
      ...capture,
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
    clockAutoPush: !!row.clock_auto_push,
    clockSuppressItemId:
      row.clock_suppress_item_id != null ? Number(row.clock_suppress_item_id) : null,
    cueFollowAuto: row.cue_follow_auto !== false,
    livePath: row.live_path || '',
    openMatch: String(row.open_match || '').trim().toLowerCase(),
    openStale: !!row.open_stale,
    ...capture,
  };
}

function namespacedPreviewId(fileId, pptSlideId) {
  const id = String(pptSlideId || '').trim();
  const fid = String(fileId || '').trim();
  if (!id) return '';
  if (!fid) return id;
  const prefix = `${fid}::`;
  return id.startsWith(prefix) ? id : `${prefix}${id}`;
}

function previewStamp(updatedAt) {
  const ms = updatedAt ? new Date(updatedAt).getTime() : 0;
  return Number.isFinite(ms) && ms > 0 ? String(ms) : String(Date.now());
}

function mapPreviewRow(eventId, row) {
  const pptSlideId = String(row.ppt_slide_id);
  return {
    pptSlideId,
    slideIndex: Number(row.slide_index),
    title: row.title || '',
    hasImage: !!(row.object_key || row.preview_data),
    imageUrl: `/api/powerpoint/${encodeURIComponent(eventId)}/playback/previews/${encodeURIComponent(pptSlideId)}/image?v=${previewStamp(row.updated_at)}`,
    width: row.width != null ? Number(row.width) : 480,
    height: row.height != null ? Number(row.height) : 270,
    fileId: row.file_id ? String(row.file_id) : null,
    updatedAt: row.updated_at || null,
  };
}

function clockPayloadFromPlayback(eventId, payload) {
  const session = payload?.session;
  if (!session?.clockAutoPush) return null;
  const cue = session.loadedCue;
  const itemId = cue?.itemId ?? session.currentItemId ?? null;
  const suppressId = session.clockSuppressItemId;
  if (suppressId != null && itemId != null && Number(suppressId) === Number(itemId)) {
    return { eventId, enabled: false, timestamp: Date.now() };
  }
  const pptCue = !!(
    cue?.hasPPT &&
    (cue.timerState === 'loaded' || cue.timerState === 'running')
  );
  const liveCaptureUrl = sanitizeVdoViewUrl(session.liveCaptureUrl);
  const liveCaptureActive = !!(session.liveCaptureActive && liveCaptureUrl);
  const idx = session.currentIndex;
  const slide = (payload.previews || []).find(
    (row) => row.slideIndex === idx && row.hasImage && row.imageUrl
  );
  const imageUrl = slide?.imageUrl || '';
  if (!pptCue || (!liveCaptureActive && !imageUrl)) {
    return { eventId, enabled: false, timestamp: Date.now() };
  }
  return {
    eventId,
    enabled: true,
    imageUrl,
    liveCaptureUrl,
    liveCaptureActive,
    slideIndex: idx ?? null,
    deckName: session.deckName || '',
    itemId,
    auto: true,
    timestamp: Date.now(),
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

function scheduleOrderMap(items) {
  const map = new Map();
  let index = 0;
  for (const item of parseScheduleItems(items)) {
    const id = Number(item?.id);
    if (!Number.isFinite(id) || map.has(id)) continue;
    map.set(id, index);
    index += 1;
  }
  return map;
}

function compareByScheduleOrder(order, aItemId, bItemId) {
  const a = Number.isFinite(aItemId) && order.has(aItemId) ? order.get(aItemId) : Number.POSITIVE_INFINITY;
  const b = Number.isFinite(bItemId) && order.has(bItemId) ? order.get(bItemId) : Number.POSITIVE_INFINITY;
  if (a !== b) return a - b;
  return (Number(aItemId) || 0) - (Number(bItemId) || 0);
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
    return { itemId: null, cueLabel: '', segmentName: '', timerState: null, hasPPT: false, day: 1 };
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
    day: itemDayNumber(item),
  };
}

async function buildManifest(pool, eventId) {
  await ensureEventCueFilesSchema(pool);
  const [filesRes, hasPptMap, ros] = await Promise.all([
    pool.query(
      `SELECT * FROM public.event_cue_files
       WHERE event_id = $1 AND expires_at > NOW()
       ORDER BY COALESCE(preferred_at, created_at) DESC, created_at DESC`,
      [eventId]
    ),
    loadHasPptMap(pool, eventId),
    pool.query('SELECT schedule_items FROM public.run_of_show_data WHERE event_id = $1 LIMIT 1', [eventId]),
  ]);

  const preferredByItem = new Set();
  const dayByItem = scheduleDayMap(ros.rows[0]?.schedule_items);
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
      day: Number.isFinite(itemId) ? dayByItem.get(itemId) || 1 : 1,
    });
  }

  const order = scheduleOrderMap(ros.rows[0]?.schedule_items);
  assets.sort((a, b) => compareByScheduleOrder(order, a.itemId, b.itemId));

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

async function loadPlaybackPreviewCatalog(pool, eventId, fileId) {
  await ensurePowerpointPlaybackSchema(pool);
  const wanted = String(fileId || '').trim();
  const rows = await pool.query(
    `SELECT ppt_slide_id, slide_index, title, object_key, preview_data, width, height, file_id, updated_at
     FROM public.ppt_playback_previews
     WHERE event_id = $1
     ORDER BY slide_index ASC, updated_at DESC`,
    [eventId]
  );
  const files = {};
  for (const row of rows.rows || []) {
    const fid = String(row.file_id || '').trim();
    if (!fid) continue;
    if (wanted && fid !== wanted) continue;
    const mapped = mapPreviewRow(eventId, row);
    if (!mapped.hasImage) continue;
    if (!files[fid]) files[fid] = [];
    if (files[fid].some((slide) => slide.slideIndex === mapped.slideIndex)) continue;
    files[fid].push(mapped);
  }
  return files;
}

async function loadPlaybackPreviews(pool, eventId, fileId) {
  const wanted = String(fileId || '').trim();
  if (!wanted) return [];
  const files = await loadPlaybackPreviewCatalog(pool, eventId, wanted);
  return files[wanted] || [];
}

async function loadPreferredPptFiles(pool, eventId) {
  await ensureEventCueFilesSchema(pool);
  const [filesRes, ros] = await Promise.all([
    pool.query(
      `SELECT id, item_id, original_name, size_bytes, created_at, preferred_at
       FROM public.event_cue_files
       WHERE event_id = $1 AND expires_at > NOW()
       ORDER BY COALESCE(preferred_at, created_at) DESC, created_at DESC`,
      [eventId]
    ),
    pool.query('SELECT schedule_items FROM public.run_of_show_data WHERE event_id = $1 LIMIT 1', [eventId]),
  ]);
  const cueLabels = {};
  const dayByItem = scheduleDayMap(ros.rows[0]?.schedule_items);
  for (const item of parseScheduleItems(ros.rows[0]?.schedule_items)) {
    const id = Number(item?.id);
    if (!Number.isFinite(id)) continue;
    cueLabels[id] = cueLabelFromItem(item, id);
  }
  const preferred = [];
  const seen = new Set();
  for (const row of filesRes.rows || []) {
    if (!isPptAssetName(row.original_name)) continue;
    const itemId = Number(row.item_id);
    if (!Number.isFinite(itemId) || seen.has(itemId)) continue;
    seen.add(itemId);
    preferred.push({
      itemId,
      fileId: String(row.id),
      originalName: row.original_name,
      sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      cueLabel: cueLabels[itemId] || `CUE ${itemId}`,
      day: dayByItem.get(itemId) || 1,
    });
  }
  const order = scheduleOrderMap(ros.rows[0]?.schedule_items);
  preferred.sort((a, b) => compareByScheduleOrder(order, a.itemId, b.itemId));
  return { preferred, cueLabels };
}

async function loadPlaybackAsset(pool, eventId, fileId) {
  await ensureEventCueFilesSchema(pool);
  const r = await pool.query(
    `SELECT * FROM public.event_cue_files
     WHERE event_id = $1 AND id = $2 AND expires_at > NOW()
     LIMIT 1`,
    [eventId, String(fileId || '')]
  );
  const row = r.rows[0];
  if (!row || !isPptAssetName(row.original_name)) return null;
  let downloadUrl = null;
  if (isBucketConfigured() && row.object_key) {
    const s3 = getS3();
    const { bucket } = getBucketConfig();
    downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: row.object_key }),
      { expiresIn: SIGNED_URL_TTL_SEC }
    );
  }
  return {
    fileId: String(row.id),
    itemId: Number(row.item_id),
    originalName: row.original_name,
    mimeType: row.mime_type || null,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    downloadUrl,
  };
}

function publishPlaybackStatus(broadcastUpdate, eventId, payload) {
  if (!broadcastUpdate) return;
  broadcastUpdate(eventId, 'pptPlaybackStatus', payload);
  const clock = clockPayloadFromPlayback(eventId, payload);
  if (clock) broadcastUpdate(eventId, 'pptClockSync', clock);
}

async function loadPlaybackPayload(pool, eventId) {
  await ensurePowerpointPlaybackSchema(pool);
  const [sessionRes, loadedCue, preferredPack, dayMeta] = await Promise.all([
    pool.query('SELECT * FROM public.ppt_playback_sessions WHERE event_id = $1', [eventId]),
    loadLoadedCue(pool, eventId),
    loadPreferredPptFiles(pool, eventId),
    loadEventDayMeta(pool, eventId),
  ]);
  const session = mapSession(sessionRes.rows[0], loadedCue);
  session.selectedDay = Math.max(1, Math.floor(Number(sessionRes.rows[0]?.selected_day) || 1));
  session.numberOfDays = dayMeta.numberOfDays;
  session.eventDate = dayMeta.eventDate;
  session.calendarDay = calendarShowDay(dayMeta.eventDate, dayMeta.numberOfDays);
  const previews = await loadPlaybackPreviews(pool, eventId, session.currentFileId);
  const cacheFiles = normalizeCacheFiles(sessionRes.rows[0]?.cache_files);
  const pendingUpdates = session.connected
    ? listPendingDeckUpdates({
        preferred: preferredPack.preferred,
        cacheFiles,
        skipItemIds: [session.currentItemId, loadedCue?.itemId],
        cueLabels: preferredPack.cueLabels,
      })
    : [];
  return {
    session,
    previews,
    preferredFiles: preferredPack.preferred,
    pendingUpdates,
  };
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

  app.get('/api/powerpoint/:eventId/playback/asset/:fileId', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      const fileId = String(req.params.fileId || '').trim();
      if (!eventId || !fileId) return res.status(400).json({ error: 'eventId and fileId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      const asset = await loadPlaybackAsset(pool, eventId, fileId);
      if (!asset) return res.status(404).json({ error: 'PowerPoint file not found' });
      res.json(asset);
    } catch (err) {
      console.error('[powerpoint-playback] asset failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load playback asset' });
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

  app.get('/api/powerpoint/:eventId/playback/previews', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      const fileId = req.query?.fileId != null ? String(req.query.fileId).trim() : '';
      const files = await loadPlaybackPreviewCatalog(pool, eventId, fileId);
      if (fileId) return res.json({ fileId, slides: files[fileId] || [] });
      res.json({ files });
    } catch (err) {
      console.error('[powerpoint-playback] preview catalog failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load slide images' });
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
      const fileId = req.body?.fileId != null ? String(req.body.fileId).trim() || null : null;
      const keepIds = [];
      let savedWithImage = 0;

      for (const slide of incoming) {
        const rawId = String(slide.pptSlideId || slide.ppt_slide_id || slide.id || '').trim();
        const pptSlideId = namespacedPreviewId(fileId, rawId);
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
          savedWithImage += 1;
          if (isBucketConfigured()) {
            const s3 = getS3();
            const { bucket } = getBucketConfig();
            const folder = fileId || 'current';
            const nextKey = `powerpoint-playback/${eventId}/${folder}/${rawId}.jpg`;
            await s3.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: nextKey,
                Body: decoded.buffer,
                ContentType: decoded.mimeType || 'image/jpeg',
              })
            );
            if (objectKey && objectKey !== nextKey) await deletePreviewObject(objectKey);
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

      if (keepIds.length && savedWithImage === keepIds.length) {
        if (fileId) {
          await pool.query(
            `DELETE FROM public.ppt_playback_previews
             WHERE event_id = $1 AND file_id = $2 AND NOT (ppt_slide_id = ANY($3::text[]))`,
            [eventId, fileId, keepIds]
          );
        } else {
          await pool.query(
            `DELETE FROM public.ppt_playback_previews
             WHERE event_id = $1 AND file_id IS NULL AND NOT (ppt_slide_id = ANY($2::text[]))`,
            [eventId, keepIds]
          );
        }
      }

      if (req.body?.deckName || keepIds.length) {
        await pool.query(
          `UPDATE public.ppt_playback_sessions
           SET slide_count = COALESCE($2, slide_count),
               deck_name = COALESCE($3, deck_name),
               current_file_id = COALESCE($4, current_file_id),
               updated_at = NOW()
           WHERE event_id = $1`,
          [
            eventId,
            keepIds.length || null,
            req.body?.deckName != null ? String(req.body.deckName) : null,
            fileId,
          ]
        );
      }

      const payload = await loadPlaybackPayload(pool, eventId);
      publishPlaybackStatus(broadcastUpdate, eventId, payload);
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
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
        res.setHeader('ETag', `"${previewStamp(row.updated_at)}"`);
        if (obj.Body?.pipe) return obj.Body.pipe(res);
        const chunks = [];
        for await (const chunk of obj.Body) chunks.push(chunk);
        return res.send(Buffer.concat(chunks));
      }
      if (row.preview_data) {
        res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
        res.setHeader('ETag', `"${previewStamp(row.updated_at)}"`);
        return res.send(Buffer.from(row.preview_data, 'base64'));
      }
      return res.status(404).json({ error: 'No image stored for this slide' });
    } catch (err) {
      console.error('[powerpoint-playback] preview image failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load preview' });
    }
  });

  app.delete('/api/powerpoint/:eventId/playback/previews', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);
      const onlyFileId = req.query?.fileId != null ? String(req.query.fileId).trim() : '';
      const existing = onlyFileId
        ? await pool.query(
            'SELECT object_key FROM public.ppt_playback_previews WHERE event_id = $1 AND file_id = $2',
            [eventId, onlyFileId]
          )
        : await pool.query(
            'SELECT object_key FROM public.ppt_playback_previews WHERE event_id = $1',
            [eventId]
          );
      for (const row of existing.rows || []) {
        if (row.object_key) await deletePreviewObject(row.object_key);
      }
      if (onlyFileId) {
        await pool.query(
          'DELETE FROM public.ppt_playback_previews WHERE event_id = $1 AND file_id = $2',
          [eventId, onlyFileId]
        );
      } else {
        await pool.query('DELETE FROM public.ppt_playback_previews WHERE event_id = $1', [eventId]);
      }
      const payload = await loadPlaybackPayload(pool, eventId);
      publishPlaybackStatus(broadcastUpdate, eventId, payload);
      res.json({ ok: true, cleared: (existing.rows || []).length, ...payload });
    } catch (err) {
      console.error('[powerpoint-playback] clear previews failed:', err);
      res.status(500).json({ error: err.message || 'Failed to clear slide images' });
    }
  });

  app.post('/api/powerpoint/:eventId/playback/clock-auto', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);
      const enabled = req.body?.enabled === true || req.body?.auto === true;
      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (event_id, clock_auto_push, clock_suppress_item_id, updated_at)
         VALUES ($1,$2,CASE WHEN $2 THEN NULL ELSE NULL END,NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           clock_auto_push = EXCLUDED.clock_auto_push,
           clock_suppress_item_id = CASE WHEN EXCLUDED.clock_auto_push THEN NULL ELSE ppt_playback_sessions.clock_suppress_item_id END,
           updated_at = NOW()`,
        [eventId, enabled]
      );
      const payload = await loadPlaybackPayload(pool, eventId);
      publishPlaybackStatus(broadcastUpdate, eventId, payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint-playback] clock-auto failed:', err);
      res.status(500).json({ error: err.message || 'Failed to save auto-push' });
    }
  });

  app.post('/api/powerpoint/:eventId/playback/clock-clear', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);
      const itemIdRaw = req.body?.itemId ?? req.body?.item_id;
      const itemId =
        itemIdRaw != null && Number.isFinite(Number(itemIdRaw)) ? Number(itemIdRaw) : null;
      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (event_id, clock_suppress_item_id, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           clock_suppress_item_id = EXCLUDED.clock_suppress_item_id,
           updated_at = NOW()`,
        [eventId, itemId]
      );
      const payload = await loadPlaybackPayload(pool, eventId);
      if (broadcastUpdate) {
        broadcastUpdate(eventId, 'pptPlaybackStatus', payload);
        broadcastUpdate(eventId, 'pptClockSync', { eventId, enabled: false, timestamp: Date.now() });
      }
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint-playback] clock-clear failed:', err);
      res.status(500).json({ error: err.message || 'Failed to clear clock feed' });
    }
  });

  app.post('/api/powerpoint/:eventId/playback/cue-follow', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);
      const enabled = !(req.body?.enabled === false || req.body?.auto === false);
      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (event_id, cue_follow_auto, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           cue_follow_auto = EXCLUDED.cue_follow_auto,
           updated_at = NOW()`,
        [eventId, enabled]
      );
      const payload = await loadPlaybackPayload(pool, eventId);
      publishPlaybackStatus(broadcastUpdate, eventId, payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint-playback] cue-follow failed:', err);
      res.status(500).json({ error: err.message || 'Failed to save cue follow mode' });
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
        publishPlaybackStatus(broadcastUpdate, eventId, payload);
        return res.json(payload);
      }

      const consumedId = body.lastCommandId || body.last_command_id || null;
      const existing = await pool.query(
        'SELECT queued_command FROM public.ppt_playback_sessions WHERE event_id = $1',
        [eventId]
      );
      const queued = existing.rows[0]?.queued_command || null;
      const clearQueue = consumedId && queued && String(queued.id) === String(consumedId);
      const cacheFiles =
        body.cacheFiles !== undefined || body.cache_files !== undefined
          ? JSON.stringify(normalizeCacheFiles(body.cacheFiles ?? body.cache_files) || [])
          : null;
      const openMatchRaw = String(body.openMatch || body.open_match || '').trim().toLowerCase();
      const openMatch =
        openMatchRaw === 'sync' || openMatchRaw === 'stale' || openMatchRaw === 'unknown'
          ? openMatchRaw
          : '';

      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (
           event_id, connected, last_seen, deck_name, slide_count, slideshow_active,
           current_index, current_item_id, current_file_id, cache_ok, cache_total,
           last_command, last_command_id, last_error, helper_mode, cache_files,
           live_path, open_match, open_stale, selected_day, updated_at
         ) VALUES ($1,true,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'playback',$14::jsonb,$15,$16,$17,$18,NOW())
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
           cache_files = COALESCE(EXCLUDED.cache_files, ppt_playback_sessions.cache_files),
           live_path = EXCLUDED.live_path,
           open_match = EXCLUDED.open_match,
           open_stale = EXCLUDED.open_stale,
           selected_day = EXCLUDED.selected_day,
           clock_suppress_item_id = CASE
             WHEN ppt_playback_sessions.clock_suppress_item_id IS NULL THEN NULL
             WHEN EXCLUDED.current_item_id IS NOT NULL
              AND EXCLUDED.current_item_id IS DISTINCT FROM ppt_playback_sessions.clock_suppress_item_id
             THEN NULL
             ELSE ppt_playback_sessions.clock_suppress_item_id
           END,
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
          cacheFiles,
          body.livePath != null ? String(body.livePath) : body.live_path != null ? String(body.live_path) : '',
          openMatch,
          body.openStale === true || body.open_stale === true,
          body.selectedDay != null && Number.isFinite(Number(body.selectedDay))
            ? Math.max(1, Math.floor(Number(body.selectedDay)))
            : 1,
        ]
      );

      const payload = await loadPlaybackPayload(pool, eventId);
      publishPlaybackStatus(broadcastUpdate, eventId, payload);
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
        return res.status(400).json({ error: 'action must be next, prev, goto, start, end, open, resume, sync, or clear-previews' });
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
      if (action === 'sync' && itemId == null && !fileId) {
        return res.status(400).json({ error: 'sync requires itemId or fileId' });
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

  app.post('/api/powerpoint/:eventId/playback/live-capture', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointPlaybackSchema(pool);

      const body = req.body || {};
      const viewUrl = sanitizeVdoViewUrl(body.viewUrl || body.liveCaptureUrl || body.live_capture_url);
      const active = body.active === true || body.liveCaptureActive === true || body.live_capture_active === true;
      if (active && !viewUrl) {
        return res.status(400).json({ error: 'A VDO.Ninja view URL is required to start live capture' });
      }
      const source = normalizeLiveCaptureSource(body.source || body.liveCaptureSource || body.live_capture_source);

      await pool.query(
        `INSERT INTO public.ppt_playback_sessions (
           event_id, live_capture_url, live_capture_active, live_capture_source, live_capture_last_seen, updated_at
         ) VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           live_capture_url = CASE
             WHEN EXCLUDED.live_capture_url <> '' THEN EXCLUDED.live_capture_url
             ELSE ppt_playback_sessions.live_capture_url
           END,
           live_capture_active = EXCLUDED.live_capture_active,
           live_capture_source = EXCLUDED.live_capture_source,
           live_capture_last_seen = NOW(),
           updated_at = NOW()`,
        [eventId, viewUrl, active, source]
      );

      const payload = await loadPlaybackPayload(pool, eventId);
      publishPlaybackStatus(broadcastUpdate, eventId, payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint-playback] live-capture failed:', err);
      res.status(500).json({ error: err.message || 'Failed to update live capture' });
    }
  });
}

module.exports = {
  ensurePowerpointPlaybackSchema,
  registerPowerpointPlaybackRoutes,
  startPowerpointPlaybackCleanup,
  isPptAssetName,
  listPendingDeckUpdates,
  loadPlaybackPreviewCatalog,
  CONNECTED_STALE_MS,
  RETENTION_MONTHS,
};
