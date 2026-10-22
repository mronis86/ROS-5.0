/**
 * PowerPoint stills + slide→cue bindings.
 * The helper uploads stills and reports the live slide; the web app owns mappings.
 */

const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { userCanAccessEvent } = require('./api-auth');

const CONNECTED_STALE_MS = 20 * 1000;
const SIGNED_URL_TTL_SEC = 60 * 60;
const MAX_STILL_BYTES = 2 * 1024 * 1024;
const VALID_ACTIONS = new Set(['none', 'load', 'load_start', 'start', 'stop']);

const DDL = `
  CREATE TABLE IF NOT EXISTS public.ppt_sessions (
    event_id TEXT PRIMARY KEY,
    deck_name TEXT NOT NULL DEFAULT '',
    slide_count INTEGER NOT NULL DEFAULT 0,
    connected BOOLEAN NOT NULL DEFAULT false,
    slideshow_active BOOLEAN NOT NULL DEFAULT false,
    current_slide_id TEXT,
    current_index INTEGER,
    last_seen TIMESTAMPTZ,
    last_fired_slide_id TEXT,
    last_action TEXT,
    last_item_id BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS public.ppt_slides (
    event_id TEXT NOT NULL,
    ppt_slide_id TEXT NOT NULL,
    slide_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    object_key TEXT,
    preview_data TEXT,
    mime_type TEXT DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, ppt_slide_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ppt_slides_event_index
    ON public.ppt_slides (event_id, slide_index);
  CREATE TABLE IF NOT EXISTS public.ppt_slide_bindings (
    event_id TEXT NOT NULL,
    ppt_slide_id TEXT NOT NULL,
    item_id BIGINT,
    action TEXT NOT NULL DEFAULT 'none'
      CHECK (action IN ('none', 'load', 'load_start', 'start', 'stop')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, ppt_slide_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ppt_slide_bindings_event
    ON public.ppt_slide_bindings (event_id);
`;

function denyIfNoEventAccess(req, res, eventId) {
  if (req.auth && !userCanAccessEvent(req.auth, eventId)) {
    res.status(403).json({ error: 'You do not have access to this event.' });
    return true;
  }
  return false;
}

function decodeStillBase64(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  const b64 = match ? match[2] : trimmed;
  const mime = match ? match[1] : 'image/jpeg';
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return null;
  return { buffer: buf, mimeType: mime || 'image/jpeg' };
}

function sessionConnected(row) {
  if (!row) return false;
  if (!row.connected) return false;
  if (!row.last_seen) return false;
  return Date.now() - new Date(row.last_seen).getTime() <= CONNECTED_STALE_MS;
}

function mapSession(row) {
  if (!row) {
    return {
      eventId: null,
      deckName: '',
      slideCount: 0,
      connected: false,
      slideshowActive: false,
      currentSlideId: null,
      currentIndex: null,
      lastSeen: null,
      lastFiredSlideId: null,
      lastAction: null,
      lastItemId: null,
    };
  }
  return {
    eventId: row.event_id,
    deckName: row.deck_name || '',
    slideCount: Number(row.slide_count) || 0,
    connected: sessionConnected(row),
    slideshowActive: !!row.slideshow_active && sessionConnected(row),
    currentSlideId: row.current_slide_id || null,
    currentIndex: row.current_index != null ? Number(row.current_index) : null,
    lastSeen: row.last_seen || null,
    lastFiredSlideId: row.last_fired_slide_id || null,
    lastAction: row.last_action || null,
    lastItemId: row.last_item_id != null ? Number(row.last_item_id) : null,
  };
}

function mapBinding(row) {
  if (!row) return { itemId: null, action: 'none' };
  return {
    itemId: row.item_id != null ? Number(row.item_id) : null,
    action: VALID_ACTIONS.has(row.action) ? row.action : 'none',
  };
}

let actionCheckReady = false;
async function ensurePowerpointSchema(pool) {
  await pool.query(DDL);
  if (actionCheckReady) return;
  try {
    await pool.query(`
      ALTER TABLE public.ppt_slide_bindings
        DROP CONSTRAINT IF EXISTS ppt_slide_bindings_action_check
    `);
    await pool.query(`
      ALTER TABLE public.ppt_slide_bindings
        ADD CONSTRAINT ppt_slide_bindings_action_check
        CHECK (action IN ('none', 'load', 'load_start', 'start', 'stop'))
    `);
    actionCheckReady = true;
  } catch (err) {
    if (String(err.message || '').includes('already exists')) {
      actionCheckReady = true;
    } else {
      console.warn('[powerpoint] action check:', err.message || err);
    }
  }
}

async function upsertSession(pool, eventId, patch) {
  await pool.query(
    `INSERT INTO public.ppt_sessions (
       event_id, deck_name, slide_count, connected, slideshow_active,
       current_slide_id, current_index, last_seen, last_fired_slide_id,
       last_action, last_item_id, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (event_id) DO UPDATE SET
       deck_name = COALESCE(EXCLUDED.deck_name, ppt_sessions.deck_name),
       slide_count = COALESCE(EXCLUDED.slide_count, ppt_sessions.slide_count),
       connected = EXCLUDED.connected,
       slideshow_active = EXCLUDED.slideshow_active,
       current_slide_id = EXCLUDED.current_slide_id,
       current_index = EXCLUDED.current_index,
       last_seen = EXCLUDED.last_seen,
       last_fired_slide_id = COALESCE(EXCLUDED.last_fired_slide_id, ppt_sessions.last_fired_slide_id),
       last_action = COALESCE(EXCLUDED.last_action, ppt_sessions.last_action),
       last_item_id = COALESCE(EXCLUDED.last_item_id, ppt_sessions.last_item_id),
       updated_at = NOW()`,
    [
      eventId,
      patch.deckName != null ? String(patch.deckName) : '',
      patch.slideCount != null ? Number(patch.slideCount) : 0,
      patch.connected !== false,
      !!patch.slideshowActive,
      patch.currentSlideId != null ? String(patch.currentSlideId) : null,
      patch.currentIndex != null ? Number(patch.currentIndex) : null,
      patch.lastSeen || new Date().toISOString(),
      patch.lastFiredSlideId != null ? String(patch.lastFiredSlideId) : null,
      patch.lastAction != null ? String(patch.lastAction) : null,
      patch.lastItemId != null ? Number(patch.lastItemId) : null,
    ]
  );
}

async function deleteS3KeySafe(getS3, getBucketConfig, key) {
  if (!key) return;
  const s3 = getS3();
  if (!s3) return;
  try {
    const { bucket } = getBucketConfig();
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.warn('[powerpoint] S3 delete failed:', key, err.message || err);
  }
}

async function stopCurrentTimer(pool, eventId, itemId, deps) {
  const { broadcastUpdate } = deps;
  const before = await pool.query(
    'SELECT * FROM active_timers WHERE event_id = $1 AND item_id = $2',
    [eventId, itemId]
  );
  await pool.query(
    `UPDATE active_timers
     SET is_running = false, is_active = false, timer_state = 'stopped', updated_at = NOW()
     WHERE event_id = $1 AND item_id = $2`,
    [eventId, itemId]
  );
  try {
    await pool.query('UPDATE sub_cue_timers SET is_running = false, updated_at = NOW() WHERE event_id = $1', [
      eventId,
    ]);
  } catch {
    /* table may vary */
  }
  if (before.rows[0]?.is_running) {
    const timer = before.rows[0];
    const startedAt = new Date(timer.started_at);
    if (startedAt.getUTCFullYear() < 2090) {
      const actualSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      const overtimeMinutes = Math.round((actualSeconds - (timer.duration_seconds || 0)) / 60);
      if (Math.abs(overtimeMinutes) >= 1) {
        await pool.query(
          `INSERT INTO overtime_minutes (event_id, item_id, overtime_minutes, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (event_id, item_id)
           DO UPDATE SET overtime_minutes = EXCLUDED.overtime_minutes, updated_at = NOW()`,
          [eventId, itemId, overtimeMinutes]
        );
        if (broadcastUpdate) {
          broadcastUpdate(eventId, 'overtimeUpdate', {
            event_id: eventId,
            item_id: itemId,
            overtimeMinutes,
          });
        }
      }
    }
  }
  const after = await pool.query(
    'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [eventId]
  );
  if (broadcastUpdate) {
    broadcastUpdate(eventId, 'timerStopped', after.rows[0] || { event_id: eventId, item_id: itemId });
  }
}

async function loadCueRow(pool, eventId, itemId, cueIs, durationSeconds, deps) {
  await pool.query(
    `INSERT INTO active_timers (
       event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running,
       started_at, last_loaded_cue_id, cue_is, duration_seconds, elapsed_seconds, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'loaded', true, false, '2099-12-31T23:59:59.999Z', $2, $6, $7, 0, NOW(), NOW())
     ON CONFLICT (event_id)
     DO UPDATE SET
       item_id = $2,
       user_id = $3,
       user_name = $4,
       user_role = $5,
       timer_state = 'loaded',
       is_active = true,
       is_running = false,
       started_at = '2099-12-31T23:59:59.999Z',
       last_loaded_cue_id = $2,
       cue_is = $6,
       duration_seconds = $7,
       elapsed_seconds = 0,
       updated_at = NOW()`,
    [eventId, itemId, 'powerpoint-bridge', 'PowerPoint Bridge', 'OPERATOR', cueIs, durationSeconds]
  );
  const result = await pool.query(
    'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [eventId]
  );
  if (deps.broadcastTimerUpdated) deps.broadcastTimerUpdated(eventId, result.rows[0]);
  return result.rows[0];
}

async function startCueRow(pool, eventId, itemId, deps) {
  await pool.query(
    `UPDATE active_timers
     SET is_active = true, is_running = true, timer_state = 'running', started_at = NOW(), updated_at = NOW()
     WHERE event_id = $1 AND item_id = $2`,
    [eventId, itemId]
  );
  const result = await pool.query(
    'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [eventId]
  );
  if (deps.broadcastTimerUpdated) deps.broadcastTimerUpdated(eventId, result.rows[0]);
  return result.rows[0];
}

function cueLabelFromItem(item, itemId) {
  const raw = item?.customFields?.cue ?? item?.custom_fields?.cue;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  return `CUE ${itemId}`;
}

async function applyPptBinding(pool, eventId, binding, deps) {
  const action = VALID_ACTIONS.has(binding?.action) ? binding.action : 'none';
  const itemId = parseInt(binding?.item_id, 10);

  if (action === 'stop') {
    const current = await pool.query('SELECT * FROM active_timers WHERE event_id = $1 LIMIT 1', [eventId]);
    const currentRow = current.rows[0];
    const stopId =
      currentRow?.item_id != null && Number.isFinite(parseInt(currentRow.item_id, 10))
        ? parseInt(currentRow.item_id, 10)
        : Number.isFinite(itemId)
          ? itemId
          : null;
    if (!Number.isFinite(stopId)) {
      return { fired: false, reason: 'no-running-timer', action };
    }
    if (typeof deps.clearSyncState === 'function') {
      try {
        deps.clearSyncState(eventId);
      } catch (err) {
        console.warn('[powerpoint] clearSyncState:', err.message || err);
      }
    }
    await stopCurrentTimer(pool, eventId, stopId, deps);
    return { fired: true, action, itemId: stopId };
  }

  if (action === 'none' || !Number.isFinite(itemId)) {
    return { fired: false, reason: 'no-binding', action };
  }

  if (typeof deps.clearSyncState === 'function') {
    try {
      deps.clearSyncState(eventId);
    } catch (err) {
      console.warn('[powerpoint] clearSyncState:', err.message || err);
    }
  }

  const ros = await pool.query('SELECT schedule_items FROM run_of_show_data WHERE event_id = $1', [eventId]);
  let items = ros.rows[0]?.schedule_items;
  if (typeof items === 'string') items = JSON.parse(items || '[]');
  if (!Array.isArray(items)) items = [];
  const item = items.find((row) => String(row?.id) === String(itemId));
  const cueIs = cueLabelFromItem(item, itemId);
  const durationSeconds = await deps.resolveCueDurationSeconds(eventId, itemId, null);

  const current = await pool.query('SELECT * FROM active_timers WHERE event_id = $1 LIMIT 1', [eventId]);
  const currentRow = current.rows[0];
  const sameItem = currentRow && String(currentRow.item_id) === String(itemId);
  const alreadyRunning =
    sameItem && currentRow.is_running === true && currentRow.timer_state === 'running';
  const alreadyLoaded = sameItem && currentRow.timer_state === 'loaded' && currentRow.is_running !== true;

  const needsLoad = action === 'load' || action === 'load_start' || action === 'start';
  const needsStart = action === 'load_start' || action === 'start';

  if (needsLoad && currentRow && !sameItem) {
    await stopCurrentTimer(pool, eventId, parseInt(currentRow.item_id, 10), deps);
  }

  if (needsLoad && !alreadyRunning && (!sameItem || !alreadyLoaded)) {
    await loadCueRow(pool, eventId, itemId, cueIs, durationSeconds, deps);
  }

  if (needsStart && !alreadyRunning) {
    if (!sameItem || currentRow?.timer_state !== 'loaded') {
      await loadCueRow(pool, eventId, itemId, cueIs, durationSeconds, deps);
    }
    await startCueRow(pool, eventId, itemId, deps);
  }

  return { fired: true, action, itemId, cueIs };
}

async function loadDeckPayload(pool, eventId, deps) {
  await ensurePowerpointSchema(pool);
  const [sessionRes, slidesRes, bindsRes] = await Promise.all([
    pool.query('SELECT * FROM public.ppt_sessions WHERE event_id = $1', [eventId]),
    pool.query('SELECT * FROM public.ppt_slides WHERE event_id = $1 ORDER BY slide_index ASC', [eventId]),
    pool.query('SELECT * FROM public.ppt_slide_bindings WHERE event_id = $1', [eventId]),
  ]);
  const bindMap = new Map((bindsRes.rows || []).map((row) => [String(row.ppt_slide_id), row]));
  const slides = await Promise.all(
    (slidesRes.rows || []).map(async (row) => {
      const imageUrl = `/api/powerpoint/${encodeURIComponent(eventId)}/stills/${encodeURIComponent(row.ppt_slide_id)}/image`;
      let signedUrl = null;
      if (row.object_key && deps.isBucketConfigured() && deps.getS3) {
        try {
          const s3 = deps.getS3();
          const { bucket } = deps.getBucketConfig();
          signedUrl = await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: bucket, Key: row.object_key }),
            { expiresIn: SIGNED_URL_TTL_SEC }
          );
        } catch (err) {
          console.warn('[powerpoint] signed URL failed:', err.message || err);
        }
      }
      return {
        pptSlideId: String(row.ppt_slide_id),
        slideIndex: Number(row.slide_index),
        title: row.title || '',
        imageUrl,
        signedUrl,
        hasImage: Boolean(row.object_key || row.preview_data),
        width: row.width != null ? Number(row.width) : null,
        height: row.height != null ? Number(row.height) : null,
        binding: mapBinding(bindMap.get(String(row.ppt_slide_id))),
      };
    })
  );
  return {
    session: mapSession(sessionRes.rows[0]),
    slides,
  };
}

function registerPowerpointRoutes(app, deps) {
  const {
    pool,
    isBucketConfigured,
    getS3,
    getBucketConfig,
    broadcastUpdate,
    broadcastTimerUpdated,
    resolveCueDurationSeconds,
    clearSyncState,
  } = deps;

  const fireDeps = {
    resolveCueDurationSeconds,
    broadcastUpdate,
    broadcastTimerUpdated,
    clearSyncState,
  };

  app.get('/api/powerpoint/:eventId', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      const payload = await loadDeckPayload(pool, eventId, { isBucketConfigured, getS3, getBucketConfig });
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint] GET failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load PowerPoint deck' });
    }
  });

  app.post('/api/powerpoint/:eventId/stills', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointSchema(pool);

      const body = req.body || {};
      const incoming = Array.isArray(body.slides) ? body.slides : [];
      if (!incoming.length) {
        return res.status(400).json({ error: 'slides[] required' });
      }

      const keepIds = [];
      for (const slide of incoming) {
        const pptSlideId = String(slide.pptSlideId || slide.ppt_slide_id || slide.id || '').trim();
        const slideIndex = parseInt(slide.slideIndex ?? slide.slide_index ?? slide.index, 10);
        if (!pptSlideId || !Number.isFinite(slideIndex)) continue;
        keepIds.push(pptSlideId);

        const title = String(slide.title || '').trim();
        const decoded = decodeStillBase64(slide.imageBase64 || slide.image_base64 || '');
        if (decoded && decoded.buffer.length > MAX_STILL_BYTES) {
          return res.status(413).json({ error: `Still for slide ${slideIndex} is too large (max 2 MB).` });
        }

        const existing = await pool.query(
          'SELECT object_key FROM public.ppt_slides WHERE event_id = $1 AND ppt_slide_id = $2',
          [eventId, pptSlideId]
        );
        let objectKey = existing.rows[0]?.object_key || null;
        let previewData = null;

        if (decoded) {
          if (isBucketConfigured()) {
            const s3 = getS3();
            const { bucket } = getBucketConfig();
            const nextKey = `powerpoint-stills/${eventId}/${pptSlideId}.jpg`;
            await s3.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: nextKey,
                Body: decoded.buffer,
                ContentType: decoded.mimeType || 'image/jpeg',
              })
            );
            if (objectKey && objectKey !== nextKey) {
              await deleteS3KeySafe(getS3, getBucketConfig, objectKey);
            }
            objectKey = nextKey;
          } else {
            previewData = decoded.buffer.toString('base64');
          }
        }

        await pool.query(
          `INSERT INTO public.ppt_slides (
             event_id, ppt_slide_id, slide_index, title, object_key, preview_data,
             mime_type, width, height, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (event_id, ppt_slide_id) DO UPDATE SET
             slide_index = EXCLUDED.slide_index,
             title = EXCLUDED.title,
             object_key = COALESCE(EXCLUDED.object_key, ppt_slides.object_key),
             preview_data = COALESCE(EXCLUDED.preview_data, ppt_slides.preview_data),
             mime_type = COALESCE(EXCLUDED.mime_type, ppt_slides.mime_type),
             width = COALESCE(EXCLUDED.width, ppt_slides.width),
             height = COALESCE(EXCLUDED.height, ppt_slides.height),
             updated_at = NOW()`,
          [
            eventId,
            pptSlideId,
            slideIndex,
            title,
            objectKey,
            previewData,
            decoded?.mimeType || 'image/jpeg',
            slide.width != null ? parseInt(slide.width, 10) : null,
            slide.height != null ? parseInt(slide.height, 10) : null,
          ]
        );
      }

      if (keepIds.length) {
        const orphans = await pool.query(
          `SELECT ppt_slide_id, object_key FROM public.ppt_slides
           WHERE event_id = $1 AND NOT (ppt_slide_id = ANY($2::text[]))`,
          [eventId, keepIds]
        );
        for (const row of orphans.rows || []) {
          await deleteS3KeySafe(getS3, getBucketConfig, row.object_key);
        }
        await pool.query(
          `DELETE FROM public.ppt_slides
           WHERE event_id = $1 AND NOT (ppt_slide_id = ANY($2::text[]))`,
          [eventId, keepIds]
        );
        await pool.query(
          `DELETE FROM public.ppt_slide_bindings
           WHERE event_id = $1 AND NOT (ppt_slide_id = ANY($2::text[]))`,
          [eventId, keepIds]
        );
      }

      await upsertSession(pool, eventId, {
        deckName: body.deckName || body.deck_name || '',
        slideCount: keepIds.length,
        connected: true,
        slideshowActive: false,
        currentSlideId: null,
        currentIndex: null,
      });

      const payload = await loadDeckPayload(pool, eventId, { isBucketConfigured, getS3, getBucketConfig });
      if (broadcastUpdate) broadcastUpdate(eventId, 'pptDeckUpdated', payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint] stills upload failed:', err);
      res.status(500).json({ error: err.message || 'Failed to save stills' });
    }
  });

  app.get('/api/powerpoint/:eventId/stills/:slideId/image', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      const slideId = String(req.params.slideId || '').trim();
      if (!eventId || !slideId) return res.status(400).json({ error: 'eventId and slideId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointSchema(pool);
      const r = await pool.query(
        'SELECT * FROM public.ppt_slides WHERE event_id = $1 AND ppt_slide_id = $2',
        [eventId, slideId]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Still not found' });

      if (row.object_key && isBucketConfigured()) {
        const s3 = getS3();
        const { bucket } = getBucketConfig();
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: row.object_key }),
          { expiresIn: SIGNED_URL_TTL_SEC }
        );
        return res.redirect(302, url);
      }
      if (row.preview_data) {
        const buf = Buffer.from(row.preview_data, 'base64');
        res.setHeader('Content-Type', row.mime_type || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.send(buf);
      }
      return res.status(404).json({ error: 'No image stored for this slide' });
    } catch (err) {
      console.error('[powerpoint] still image failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load still' });
    }
  });

  app.put('/api/powerpoint/:eventId/bindings', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointSchema(pool);

      const incoming = Array.isArray(req.body?.bindings) ? req.body.bindings : [];
      for (const bind of incoming) {
        const pptSlideId = String(bind.pptSlideId || bind.ppt_slide_id || '').trim();
        if (!pptSlideId) continue;
        const action = VALID_ACTIONS.has(bind.action) ? bind.action : 'none';
        const rawId = bind.itemId ?? bind.item_id;
        const itemId = rawId == null || rawId === '' ? null : parseInt(rawId, 10);
        await pool.query(
          `INSERT INTO public.ppt_slide_bindings (event_id, ppt_slide_id, item_id, action, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (event_id, ppt_slide_id) DO UPDATE SET
             item_id = EXCLUDED.item_id,
             action = EXCLUDED.action,
             updated_at = NOW()`,
          [eventId, pptSlideId, Number.isFinite(itemId) ? itemId : null, action]
        );
      }

      const payload = await loadDeckPayload(pool, eventId, { isBucketConfigured, getS3, getBucketConfig });
      if (broadcastUpdate) broadcastUpdate(eventId, 'pptDeckUpdated', payload);
      res.json(payload);
    } catch (err) {
      console.error('[powerpoint] bindings save failed:', err);
      res.status(500).json({ error: err.message || 'Failed to save bindings' });
    }
  });

  app.post('/api/powerpoint/:eventId/live', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensurePowerpointSchema(pool);

      const body = req.body || {};
      const slideshowActive = body.slideshowActive === true || body.slideshow_active === true;
      const pptSlideId = body.pptSlideId || body.ppt_slide_id || body.currentSlideId || null;
      const slideIndex = body.slideIndex ?? body.slide_index ?? body.currentIndex ?? null;
      const deckName = body.deckName || body.deck_name;
      const slideCount = body.slideCount ?? body.slide_count;

      const existing = await pool.query('SELECT * FROM public.ppt_sessions WHERE event_id = $1', [eventId]);
      const prev = existing.rows[0];
      const nextId = pptSlideId != null && String(pptSlideId).trim() ? String(pptSlideId).trim() : null;
      const slideChanged = slideshowActive && nextId && nextId !== String(prev?.last_fired_slide_id || '');

      let fireResult = { fired: false, reason: 'no-change' };
      if (slideChanged) {
        const bindRes = await pool.query(
          'SELECT * FROM public.ppt_slide_bindings WHERE event_id = $1 AND ppt_slide_id = $2',
          [eventId, nextId]
        );
        fireResult = await applyPptBinding(pool, eventId, bindRes.rows[0], fireDeps);
      }

      await upsertSession(pool, eventId, {
        deckName: deckName != null ? deckName : prev?.deck_name || '',
        slideCount: slideCount != null ? slideCount : prev?.slide_count || 0,
        connected: true,
        slideshowActive,
        currentSlideId: nextId,
        currentIndex: slideIndex != null && Number.isFinite(Number(slideIndex)) ? Number(slideIndex) : null,
        lastFiredSlideId: slideChanged ? nextId : undefined,
        lastAction: fireResult.fired ? fireResult.action : undefined,
        lastItemId: fireResult.fired ? fireResult.itemId : undefined,
      });

      const live = {
        eventId,
        slideshowActive,
        pptSlideId: nextId,
        slideIndex: slideIndex != null ? Number(slideIndex) : null,
        fired: !!fireResult.fired,
        action: fireResult.action || null,
        itemId: fireResult.itemId || null,
        reason: fireResult.reason || null,
      };
      if (broadcastUpdate) broadcastUpdate(eventId, 'pptSlideLive', live);
      res.json(live);
    } catch (err) {
      console.error('[powerpoint] live report failed:', err);
      res.status(500).json({ error: err.message || 'Failed to report live slide' });
    }
  });
}

module.exports = {
  ensurePowerpointSchema,
  registerPowerpointRoutes,
  CONNECTED_STALE_MS,
};
