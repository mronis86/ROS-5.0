/**
 * Event Board API helpers — per-event non-timed workspace assets + notes.
 */
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

const BOARD_ZONES = new Set(['agenda', 'powerpoint', 'display']);
const BOARD_MAX_FILE_BYTES = 50 * 1024 * 1024;
const BOARD_URL_TTL_SEC = 60 * 60;
const BOARD_EXPIRE_MONTHS = 4;

function boardFileExt(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function boardZoneAllowed(zone, file) {
  if (!file || !BOARD_ZONES.has(zone)) return false;
  const ext = boardFileExt(file.originalname || '');
  const mime = String(file.mimetype || '').toLowerCase();
  if (zone === 'agenda') {
    return (
      ['pdf', 'doc', 'docx', 'txt', 'xlsx', 'xls'].includes(ext) ||
      mime === 'application/pdf' ||
      mime === 'text/plain' ||
      mime.includes('word') ||
      mime.includes('sheet') ||
      mime.includes('excel')
    );
  }
  if (zone === 'powerpoint') {
    return (
      ['ppt', 'pptx', 'pdf'].includes(ext) ||
      mime.includes('presentation') ||
      mime.includes('powerpoint') ||
      mime === 'application/pdf'
    );
  }
  // display
  return (
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'mp4', 'mov', 'webm'].includes(ext) ||
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime === 'application/pdf'
  );
}

async function ensureEventBoardSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.event_board_data (
      event_id TEXT PRIMARY KEY,
      av_notes TEXT NOT NULL DEFAULT '',
      agenda_text TEXT NOT NULL DEFAULT '',
      agenda_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      updated_by_name TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.event_board_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      zone TEXT NOT NULL
        CHECK (zone IN ('agenda', 'powerpoint', 'display')),
      object_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      extracted_text TEXT,
      uploaded_by TEXT,
      uploaded_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_board_assets_event_zone
      ON public.event_board_assets (event_id, zone, created_at DESC)
  `);
}

async function extractTextFromBuffer(buf, originalName, mimeType) {
  const name = String(originalName || '').toLowerCase();
  const mime = String(mimeType || '');
  const isPdf = name.endsWith('.pdf') || mime === 'application/pdf';
  const isDocx =
    name.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isTxt = name.endsWith('.txt') || mime === 'text/plain';
  const isExcel =
    /\.(xlsx|xls)$/i.test(name) ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel';

  if (isTxt) return buf.toString('utf8');
  if (isPdf) {
    const data = await pdf(buf);
    return data.text || '';
  }
  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }
  if (isExcel) {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const lines = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      if (wb.SheetNames.length > 1) {
        lines.push(`[Sheet: ${sheetName}]`, '');
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      for (const row of rows) {
        const cells = (Array.isArray(row) ? row : []).map((c) => String(c ?? '').trim());
        if (cells.every((c) => !c)) {
          lines.push('');
          continue;
        }
        lines.push(cells.join('\t'));
      }
      lines.push('');
    }
    return lines.join('\n');
  }
  throw new Error('Unsupported format for text extraction. Use PDF, Word (.docx), Excel, or TXT.');
}

function registerEventBoardRoutes(app, {
  pool,
  userCanAccessEvent,
  isBucketConfigured,
  getS3,
  getBucketConfig,
  safeOriginalName,
  multer,
}) {
  const boardUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BOARD_MAX_FILE_BYTES },
  });

  async function requireBoardAccess(req, res, eventId) {
    if (!eventId) {
      res.status(400).json({ error: 'eventId is required' });
      return false;
    }
    if (req.auth && !userCanAccessEvent(req.auth, eventId)) {
      res.status(403).json({ error: 'Forbidden' });
      return false;
    }
    return true;
  }

  function editorOnly(req, res) {
    const role = String(req.headers['x-ros-role'] || req.auth?.role || '').toUpperCase();
    if (role && role !== 'EDITOR' && !req.auth?.isAdmin && !req.auth?.isEventManager) {
      res.status(403).json({ error: 'Only EDITORs can change Event Board content.' });
      return false;
    }
    return true;
  }

  app.get('/api/event-board/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      await ensureEventBoardSchema(pool);
      const dataRes = await pool.query(
        `SELECT event_id, av_notes, agenda_text, agenda_items, updated_at, updated_by, updated_by_name
         FROM public.event_board_data WHERE event_id = $1 LIMIT 1`,
        [eventId]
      );
      const assetsRes = await pool.query(
        `SELECT id, event_id, zone, original_name, mime_type, size_bytes, extracted_text,
                uploaded_by, uploaded_by_name, created_at, expires_at
         FROM public.event_board_assets
         WHERE event_id = $1
         ORDER BY created_at DESC`,
        [eventId]
      );
      const row = dataRes.rows[0] || null;
      res.json({
        event_id: eventId,
        av_notes: row?.av_notes || '',
        agenda_text: row?.agenda_text || '',
        agenda_items: Array.isArray(row?.agenda_items) ? row.agenda_items : [],
        updated_at: row?.updated_at || null,
        updated_by: row?.updated_by || null,
        updated_by_name: row?.updated_by_name || null,
        assets: assetsRes.rows,
      });
    } catch (error) {
      console.error('event-board GET error:', error);
      res.status(500).json({ error: error.message || 'Failed to load event board' });
    }
  });

  app.put('/api/event-board/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!editorOnly(req, res)) return;
      await ensureEventBoardSchema(pool);
      const avNotes = typeof req.body?.av_notes === 'string' ? req.body.av_notes : '';
      const agendaText = typeof req.body?.agenda_text === 'string' ? req.body.agenda_text : '';
      const agendaItems = Array.isArray(req.body?.agenda_items) ? req.body.agenda_items : [];
      const auth = req.auth || {};
      const updatedBy = auth.userId || auth.email || auth.accessId || null;
      const updatedByName = auth.fullName || auth.email || auth.userId || null;
      const result = await pool.query(
        `INSERT INTO public.event_board_data (
           event_id, av_notes, agenda_text, agenda_items, updated_at, updated_by, updated_by_name
         ) VALUES ($1,$2,$3,$4::jsonb,NOW(),$5,$6)
         ON CONFLICT (event_id) DO UPDATE SET
           av_notes = EXCLUDED.av_notes,
           agenda_text = EXCLUDED.agenda_text,
           agenda_items = EXCLUDED.agenda_items,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name
         RETURNING *`,
        [eventId, avNotes, agendaText, JSON.stringify(agendaItems), updatedBy, updatedByName]
      );
      res.json(result.rows[0]);
    } catch (error) {
      console.error('event-board PUT error:', error);
      res.status(500).json({ error: error.message || 'Failed to save event board' });
    }
  });

  app.post(
    '/api/event-board/:eventId/assets',
    (req, res, next) => {
      boardUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const msg = err.message || 'Upload failed';
        const status = /file too large/i.test(msg) ? 413 : 400;
        return res.status(status).json({
          error:
            status === 413
              ? `File is too large. Max size is ${Math.round(BOARD_MAX_FILE_BYTES / (1024 * 1024))} MB.`
              : msg,
        });
      });
    },
    async (req, res) => {
      try {
        const { eventId } = req.params;
        if (!(await requireBoardAccess(req, res, eventId))) return;
        if (!editorOnly(req, res)) return;
        if (!isBucketConfigured()) {
          return res.status(503).json({
            error: 'Platform file storage is not configured yet.',
          });
        }
        const zone = String(req.body?.zone || req.query?.zone || '').trim();
        if (!BOARD_ZONES.has(zone)) {
          return res.status(400).json({ error: 'zone must be agenda, powerpoint, or display' });
        }
        if (!req.file?.buffer || !boardZoneAllowed(zone, req.file)) {
          return res.status(400).json({ error: 'No file uploaded or unsupported file type for this zone.' });
        }

        await ensureEventBoardSchema(pool);
        const originalName = safeOriginalName(req.file.originalname || 'board-file');
        const fileId = crypto.randomUUID();
        const objectKey = `event-board/${eventId}/${zone}/${fileId}/${originalName}`;
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime());
        expiresAt.setMonth(expiresAt.getMonth() + BOARD_EXPIRE_MONTHS);
        const auth = req.auth || {};
        const uploaderId = auth.userId || auth.email || auth.accessId || null;
        const uploaderName = auth.fullName || auth.email || auth.userId || null;

        const s3 = getS3();
        const { bucket } = getBucketConfig();
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: req.file.buffer,
            ContentType: req.file.mimetype || 'application/octet-stream',
          })
        );

        let extractedText = null;
        if (zone === 'agenda') {
          try {
            extractedText = await extractTextFromBuffer(
              req.file.buffer,
              originalName,
              req.file.mimetype
            );
          } catch {
            extractedText = null;
          }
        }

        const insert = await pool.query(
          `INSERT INTO public.event_board_assets (
             id, event_id, zone, object_key, original_name, mime_type, size_bytes,
             extracted_text, uploaded_by, uploaded_by_name, created_at, expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id, event_id, zone, original_name, mime_type, size_bytes, extracted_text,
                     uploaded_by, uploaded_by_name, created_at, expires_at`,
          [
            fileId,
            eventId,
            zone,
            objectKey,
            originalName,
            req.file.mimetype || null,
            req.file.size || req.file.buffer.length,
            extractedText,
            uploaderId,
            uploaderName,
            createdAt.toISOString(),
            expiresAt.toISOString(),
          ]
        );

        if (zone === 'agenda' && extractedText) {
          await pool.query(
            `INSERT INTO public.event_board_data (event_id, agenda_text, updated_at, updated_by, updated_by_name)
             VALUES ($1,$2,NOW(),$3,$4)
             ON CONFLICT (event_id) DO UPDATE SET
               agenda_text = CASE
                 WHEN TRIM(COALESCE(public.event_board_data.agenda_text, '')) = '' THEN EXCLUDED.agenda_text
                 ELSE public.event_board_data.agenda_text
               END,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by,
               updated_by_name = EXCLUDED.updated_by_name`,
            [eventId, extractedText, uploaderId, uploaderName]
          );
        }

        res.status(201).json(insert.rows[0]);
      } catch (error) {
        console.error('event-board upload error:', error);
        res.status(500).json({ error: error.message || 'Failed to upload board asset' });
      }
    }
  );

  app.get('/api/event-board/:eventId/assets/:assetId/url', async (req, res) => {
    try {
      const { eventId, assetId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!isBucketConfigured()) {
        return res.status(503).json({ error: 'Platform file storage is not configured yet.' });
      }
      await ensureEventBoardSchema(pool);
      const result = await pool.query(
        `SELECT * FROM public.event_board_assets WHERE id = $1 AND event_id = $2 LIMIT 1`,
        [assetId, eventId]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Asset not found' });
      const s3 = getS3();
      const { bucket } = getBucketConfig();
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: row.object_key }),
        { expiresIn: BOARD_URL_TTL_SEC }
      );
      res.json({
        url,
        original_name: row.original_name,
        mime_type: row.mime_type,
        expires_in: BOARD_URL_TTL_SEC,
      });
    } catch (error) {
      console.error('event-board asset url error:', error);
      res.status(500).json({ error: error.message || 'Failed to get asset URL' });
    }
  });

  app.post('/api/event-board/:eventId/assets/:assetId/apply-text', async (req, res) => {
    try {
      const { eventId, assetId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!editorOnly(req, res)) return;
      await ensureEventBoardSchema(pool);
      const result = await pool.query(
        `SELECT extracted_text FROM public.event_board_assets WHERE id = $1 AND event_id = $2 LIMIT 1`,
        [assetId, eventId]
      );
      const text = result.rows[0]?.extracted_text;
      if (!text) {
        return res.status(400).json({ error: 'No extracted text available for this file.' });
      }
      const auth = req.auth || {};
      const updatedBy = auth.userId || auth.email || auth.accessId || null;
      const updatedByName = auth.fullName || auth.email || auth.userId || null;
      const saved = await pool.query(
        `INSERT INTO public.event_board_data (event_id, agenda_text, updated_at, updated_by, updated_by_name)
         VALUES ($1,$2,NOW(),$3,$4)
         ON CONFLICT (event_id) DO UPDATE SET
           agenda_text = EXCLUDED.agenda_text,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name
         RETURNING *`,
        [eventId, text, updatedBy, updatedByName]
      );
      res.json(saved.rows[0]);
    } catch (error) {
      console.error('event-board apply-text error:', error);
      res.status(500).json({ error: error.message || 'Failed to apply extracted text' });
    }
  });

  app.delete('/api/event-board/:eventId/assets/:assetId', async (req, res) => {
    try {
      const { eventId, assetId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!editorOnly(req, res)) return;
      await ensureEventBoardSchema(pool);
      const result = await pool.query(
        `DELETE FROM public.event_board_assets WHERE id = $1 AND event_id = $2 RETURNING *`,
        [assetId, eventId]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Asset not found' });
      if (isBucketConfigured() && row.object_key) {
        try {
          const s3 = getS3();
          const { bucket } = getBucketConfig();
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: row.object_key }));
        } catch (e) {
          console.warn('event-board S3 delete warning:', e.message || e);
        }
      }
      res.json({ ok: true, id: assetId });
    } catch (error) {
      console.error('event-board delete error:', error);
      res.status(500).json({ error: error.message || 'Failed to delete asset' });
    }
  });

  return { ensureEventBoardSchema };
}

module.exports = {
  registerEventBoardRoutes,
  ensureEventBoardSchema,
  BOARD_ZONES,
};
