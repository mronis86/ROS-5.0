/**
 * Meeting Hub (Event Board) API — per-event non-timed workspace assets + notes.
 * workspaceMode stays "board" in storage; UI label is Meeting Hub.
 */
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { parseBoardAgenda } = require('./board-agenda');
const { annotateBoardAssetVersions, sortCueFilesForDisplay } = require('./cue-file-versions');
const { pdfBufferToPptx, pptxNameFromPdf, isPdfCueFile, MAX_PAGES } = require('./pdf-to-pptx');

const BOARD_ZONES = new Set(['agenda', 'powerpoint', 'display']);
const BOARD_MAX_FILE_BYTES = 50 * 1024 * 1024;
const BOARD_URL_TTL_SEC = 60 * 60;
const BOARD_EXPIRE_MONTHS = 4;
const convertingBoardPdfIds = new Set();

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
  await pool.query(`ALTER TABLE public.event_board_data ADD COLUMN IF NOT EXISTS conference_setup TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE public.event_board_data ADD COLUMN IF NOT EXISTS food_beverage TEXT NOT NULL DEFAULT ''`);
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
  await pool.query(`ALTER TABLE public.event_board_assets ADD COLUMN IF NOT EXISTS preferred_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE public.event_board_assets ADD COLUMN IF NOT EXISTS converted_from_id UUID`);
  await pool.query(`ALTER TABLE public.event_board_data ADD COLUMN IF NOT EXISTS public_token TEXT`);
  await pool.query(`ALTER TABLE public.event_board_data ADD COLUMN IF NOT EXISTS public_control_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_board_assets_event_zone
      ON public.event_board_assets (event_id, zone, created_at DESC)
  `);
}

function mapBoardAssetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    zone: row.zone,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    extracted_text: row.extracted_text || null,
    uploaded_by: row.uploaded_by || null,
    uploaded_by_name: row.uploaded_by_name || null,
    created_at: row.created_at || null,
    expires_at: row.expires_at || null,
    preferred_at: row.preferred_at || null,
    converted_from_id: row.converted_from_id || null,
    object_key: row.object_key,
  };
}

function annotateBoardAssets(rows) {
  const mapped = (rows || []).map(mapBoardAssetRow).filter(Boolean);
  return sortCueFilesForDisplay(annotateBoardAssetVersions(mapped));
}

async function streamS3BodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isPowerpointAsset(name, mime) {
  const n = String(name || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  return (
    n.endsWith('.ppt') ||
    n.endsWith('.pptx') ||
    m.includes('presentation') ||
    m.includes('powerpoint')
  );
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
      res.status(403).json({ error: 'Only EDITORs can change Meeting Hub content.' });
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
        `SELECT event_id, av_notes, agenda_text, agenda_items, conference_setup, food_beverage,
                public_control_enabled, public_token,
                updated_at, updated_by, updated_by_name
         FROM public.event_board_data WHERE event_id = $1 LIMIT 1`,
        [eventId]
      );
      const assetsRes = await pool.query(
        `SELECT id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id
         FROM public.event_board_assets
         WHERE event_id = $1
         ORDER BY created_at DESC`,
        [eventId]
      );
      const row = dataRes.rows[0] || null;
      const assets = annotateBoardAssets(assetsRes.rows).map((asset) => {
        const { object_key, ...publicAsset } = asset;
        return publicAsset;
      });
      res.json({
        event_id: eventId,
        av_notes: row?.av_notes || '',
        agenda_text: row?.agenda_text || '',
        agenda_items: Array.isArray(row?.agenda_items) ? row.agenda_items : [],
        conference_setup: row?.conference_setup || '',
        food_beverage: row?.food_beverage || '',
        public_control_enabled: row?.public_control_enabled === true,
        public_token: row?.public_token || null,
        updated_at: row?.updated_at || null,
        updated_by: row?.updated_by || null,
        updated_by_name: row?.updated_by_name || null,
        assets,
      });
    } catch (error) {
      console.error('event-board GET error:', error);
      res.status(500).json({ error: error.message || 'Failed to load Meeting Hub' });
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
      const conferenceSetup = typeof req.body?.conference_setup === 'string' ? req.body.conference_setup : '';
      const foodBeverage = typeof req.body?.food_beverage === 'string' ? req.body.food_beverage : '';
      const auth = req.auth || {};
      const updatedBy = auth.userId || auth.email || auth.accessId || null;
      const updatedByName = auth.fullName || auth.email || auth.userId || null;
      const result = await pool.query(
        `INSERT INTO public.event_board_data (
           event_id, av_notes, agenda_text, agenda_items, conference_setup, food_beverage,
           updated_at, updated_by, updated_by_name
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW(),$7,$8)
         ON CONFLICT (event_id) DO UPDATE SET
           av_notes = EXCLUDED.av_notes,
           agenda_text = EXCLUDED.agenda_text,
           agenda_items = EXCLUDED.agenda_items,
           conference_setup = EXCLUDED.conference_setup,
           food_beverage = EXCLUDED.food_beverage,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name
         RETURNING *`,
        [eventId, avNotes, agendaText, JSON.stringify(agendaItems), conferenceSetup, foodBeverage, updatedBy, updatedByName]
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
             extracted_text, uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           RETURNING id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                     uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id`,
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
          const simplified = parseBoardAgenda(extractedText);
          const agendaText = simplified.items.length ? simplified.text : extractedText;
          const agendaItems = simplified.items;
          await pool.query(
            `INSERT INTO public.event_board_data (event_id, agenda_text, agenda_items, updated_at, updated_by, updated_by_name)
             VALUES ($1,$2,$3::jsonb,NOW(),$4,$5)
             ON CONFLICT (event_id) DO UPDATE SET
               agenda_text = EXCLUDED.agenda_text,
               agenda_items = EXCLUDED.agenda_items,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by,
               updated_by_name = EXCLUDED.updated_by_name`,
            [eventId, agendaText, JSON.stringify(agendaItems), uploaderId, uploaderName]
          );
        }

        const annotated = annotateBoardAssets([insert.rows[0]]);
        const { object_key, ...publicAsset } = annotated[0] || mapBoardAssetRow(insert.rows[0]);
        res.status(201).json(publicAsset);
      } catch (error) {
        console.error('event-board upload error:', error);
        res.status(500).json({ error: error.message || 'Failed to upload Hub asset' });
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
      const simplified = parseBoardAgenda(text);
      const agendaText = simplified.items.length ? simplified.text : text;
      const auth = req.auth || {};
      const updatedBy = auth.userId || auth.email || auth.accessId || null;
      const updatedByName = auth.fullName || auth.email || auth.userId || null;
      const saved = await pool.query(
        `INSERT INTO public.event_board_data (event_id, agenda_text, agenda_items, updated_at, updated_by, updated_by_name)
         VALUES ($1,$2,$3::jsonb,NOW(),$4,$5)
         ON CONFLICT (event_id) DO UPDATE SET
           agenda_text = EXCLUDED.agenda_text,
           agenda_items = EXCLUDED.agenda_items,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name
         RETURNING *`,
        [eventId, agendaText, JSON.stringify(simplified.items), updatedBy, updatedByName]
      );
      res.json({
        ...saved.rows[0],
        agenda_text: agendaText,
        agenda_items: simplified.items,
      });
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

  /** Mark an older upload as the current version (same base name in the same zone). */
  app.post('/api/event-board/:eventId/assets/:assetId/prefer', async (req, res) => {
    try {
      const { eventId, assetId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!editorOnly(req, res)) return;
      await ensureEventBoardSchema(pool);
      const result = await pool.query(
        `UPDATE public.event_board_assets SET preferred_at = NOW()
         WHERE id = $1 AND event_id = $2
         RETURNING id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                   uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id`,
        [assetId, eventId]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Asset not found' });
      const zoneAssets = await pool.query(
        `SELECT id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id
         FROM public.event_board_assets WHERE event_id = $1 AND zone = $2`,
        [eventId, row.zone]
      );
      const annotated = annotateBoardAssets(zoneAssets.rows).map(({ object_key, ...rest }) => rest);
      res.json({
        ok: true,
        file: annotated.find((a) => a.id === assetId) || null,
        assets: annotated,
      });
    } catch (error) {
      console.error('event-board prefer error:', error);
      res.status(500).json({ error: error.message || 'Could not set current version' });
    }
  });

  /** PDF → PPTX for Meeting Hub PowerPoint zone (same converter as ROS cue files). */
  app.post('/api/event-board/:eventId/assets/:assetId/pdf-to-pptx', async (req, res) => {
    const { eventId, assetId } = req.params;
    try {
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!editorOnly(req, res)) return;
      if (!isBucketConfigured()) {
        return res.status(503).json({ error: 'Platform file storage is not configured.' });
      }
      await ensureEventBoardSchema(pool);
      const r = await pool.query(
        `SELECT * FROM public.event_board_assets WHERE id = $1 AND event_id = $2 LIMIT 1`,
        [assetId, eventId]
      );
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'Asset not found' });
      if (row.zone !== 'powerpoint') {
        return res.status(400).json({ error: 'Only PowerPoint-zone PDFs can be converted.' });
      }
      if (!isPdfCueFile(row.original_name, row.mime_type)) {
        return res.status(400).json({ error: 'Only PDF files can be turned into a PowerPoint of slides.' });
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return res.status(410).json({ error: 'This file has expired.' });
      }
      const force = req.body?.force === true;
      if (!force) {
        const existing = await pool.query(
          `SELECT * FROM public.event_board_assets
           WHERE event_id = $1 AND zone = 'powerpoint' AND converted_from_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [eventId, row.id]
        );
        if (existing.rows[0]) {
          const annotated = annotateBoardAssets([existing.rows[0]]);
          const { object_key, ...publicAsset } = annotated[0] || mapBoardAssetRow(existing.rows[0]);
          return res.json({ file: publicAsset, reused: true, pages: null, totalPages: null });
        }
      }
      if (convertingBoardPdfIds.has(assetId)) {
        return res.status(409).json({ error: 'This PDF is already being converted.' });
      }
      convertingBoardPdfIds.add(assetId);
      req.setTimeout(5 * 60 * 1000);
      res.setTimeout(5 * 60 * 1000);

      const s3 = getS3();
      const { bucket } = getBucketConfig();
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.object_key }));
      const pdfBuffer = await streamS3BodyToBuffer(obj.Body);
      const converted = await pdfBufferToPptx(pdfBuffer, { title: row.original_name });
      const pptxName = pptxNameFromPdf(row.original_name);
      const newId = crypto.randomUUID();
      const objectKey = `event-board/${eventId}/powerpoint/${newId}/${pptxName}`;
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime());
      expiresAt.setMonth(expiresAt.getMonth() + BOARD_EXPIRE_MONTHS);
      const auth = req.auth || {};
      const uploaderId = auth.userId || auth.email || auth.accessId || null;
      const uploaderName = auth.fullName || auth.email || auth.userId || null;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: converted.buffer,
          ContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        })
      );

      const insert = await pool.query(
        `INSERT INTO public.event_board_assets (
           id, event_id, zone, object_key, original_name, mime_type, size_bytes,
           uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id
         ) VALUES ($1,$2,'powerpoint',$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
         RETURNING id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                   uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id`,
        [
          newId,
          eventId,
          objectKey,
          pptxName,
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          converted.buffer.length,
          uploaderId,
          uploaderName,
          createdAt.toISOString(),
          expiresAt.toISOString(),
          row.id,
        ]
      );
      const annotated = annotateBoardAssets([insert.rows[0]]);
      const { object_key, ...publicAsset } = annotated[0] || mapBoardAssetRow(insert.rows[0]);
      res.status(201).json({
        file: publicAsset,
        reused: false,
        pages: converted.pages,
        totalPages: converted.totalPages,
        truncated: converted.truncated,
        maxPages: MAX_PAGES,
      });
    } catch (error) {
      console.error('event-board pdf-to-pptx failed:', error);
      res.status(500).json({ error: error.message || 'Could not create PowerPoint from this PDF.' });
    } finally {
      convertingBoardPdfIds.delete(assetId);
    }
  });

  /**
   * MeetingHub / PPT Bridge: current PowerPoint-zone decks (PPT/PPTX) for an event.
   * Integration tokens with event access can list + get signed download URLs.
   */
  app.get('/api/event-board/:eventId/meeting-hub/decks', async (req, res) => {
    try {
      const { eventId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!isBucketConfigured()) {
        return res.status(503).json({ error: 'Platform file storage is not configured.' });
      }
      await ensureEventBoardSchema(pool);
      const assetsRes = await pool.query(
        `SELECT id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id
         FROM public.event_board_assets
         WHERE event_id = $1 AND zone = 'powerpoint'`,
        [eventId]
      );
      const annotated = annotateBoardAssets(assetsRes.rows);
      const currentDecks = annotated.filter(
        (a) => a.isCurrent !== false && isPowerpointAsset(a.original_name, a.mime_type)
      );
      const s3 = getS3();
      const { bucket } = getBucketConfig();
      const decks = [];
      for (const asset of currentDecks) {
        const full = assetsRes.rows.find((r) => String(r.id) === String(asset.id));
        if (!full?.object_key) continue;
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: full.object_key }),
          { expiresIn: BOARD_URL_TTL_SEC }
        );
        decks.push({
          id: asset.id,
          name: asset.versionedName || asset.original_name,
          original_name: asset.original_name,
          version: asset.version,
          versionCount: asset.versionCount,
          mime_type: asset.mime_type,
          size_bytes: asset.size_bytes,
          converted_from_id: asset.converted_from_id || null,
          url,
          expires_in: BOARD_URL_TTL_SEC,
        });
      }
      res.json({ event_id: eventId, decks, mode: 'meetinghub' });
    } catch (error) {
      console.error('meeting-hub decks error:', error);
      res.status(500).json({ error: error.message || 'Failed to list Meeting Hub decks' });
    }
  });

  /** Enable / rotate public web control token for this Meeting Hub. */
  app.post('/api/event-board/:eventId/public-control', async (req, res) => {
    try {
      const { eventId } = req.params;
      if (!(await requireBoardAccess(req, res, eventId))) return;
      if (!editorOnly(req, res)) return;
      await ensureEventBoardSchema(pool);
      const enabled = req.body?.enabled !== false;
      const rotate = req.body?.rotate === true;
      const existing = await pool.query(
        `SELECT public_token, public_control_enabled FROM public.event_board_data WHERE event_id = $1`,
        [eventId]
      );
      let token = existing.rows[0]?.public_token || null;
      if (enabled && (rotate || !token)) {
        token = crypto.randomBytes(18).toString('base64url');
      }
      if (!enabled) {
        token = existing.rows[0]?.public_token || token;
      }
      const auth = req.auth || {};
      const updatedBy = auth.userId || auth.email || auth.accessId || null;
      const updatedByName = auth.fullName || auth.email || auth.userId || null;
      const saved = await pool.query(
        `INSERT INTO public.event_board_data (
           event_id, public_control_enabled, public_token, updated_at, updated_by, updated_by_name
         ) VALUES ($1,$2,$3,NOW(),$4,$5)
         ON CONFLICT (event_id) DO UPDATE SET
           public_control_enabled = EXCLUDED.public_control_enabled,
           public_token = COALESCE(EXCLUDED.public_token, public.event_board_data.public_token),
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name
         RETURNING event_id, public_control_enabled, public_token`,
        [eventId, enabled, token, updatedBy, updatedByName]
      );
      res.json(saved.rows[0]);
    } catch (error) {
      console.error('event-board public-control error:', error);
      res.status(500).json({ error: error.message || 'Failed to update public control' });
    }
  });

  /** Public Meeting Hub control — agenda + current PPT decks (token in URL). */
  app.get('/api/public/meeting-hub/:token', async (req, res) => {
    try {
      const token = String(req.params.token || '').trim();
      if (!token) return res.status(400).json({ error: 'token required' });
      await ensureEventBoardSchema(pool);
      const dataRes = await pool.query(
        `SELECT event_id, agenda_text, agenda_items, public_control_enabled, public_token
         FROM public.event_board_data
         WHERE public_token = $1 AND public_control_enabled = TRUE
         LIMIT 1`,
        [token]
      );
      const row = dataRes.rows[0];
      if (!row) return res.status(404).json({ error: 'Public Meeting Hub not found or disabled.' });

      const assetsRes = await pool.query(
        `SELECT id, event_id, zone, object_key, original_name, mime_type, size_bytes, extracted_text,
                uploaded_by, uploaded_by_name, created_at, expires_at, preferred_at, converted_from_id
         FROM public.event_board_assets
         WHERE event_id = $1 AND zone = 'powerpoint'`,
        [row.event_id]
      );
      const annotated = annotateBoardAssets(assetsRes.rows);
      const decks = annotated
        .filter((a) => a.isCurrent !== false && isPowerpointAsset(a.original_name, a.mime_type))
        .map(({ object_key, extracted_text, ...rest }) => rest);

      res.json({
        event_id: row.event_id,
        agenda_text: row.agenda_text || '',
        agenda_items: Array.isArray(row.agenda_items) ? row.agenda_items : [],
        decks,
        mode: 'meetinghub',
      });
    } catch (error) {
      console.error('public meeting-hub GET error:', error);
      res.status(500).json({ error: error.message || 'Failed to load public Meeting Hub' });
    }
  });

  app.get('/api/public/meeting-hub/:token/assets/:assetId/url', async (req, res) => {
    try {
      const token = String(req.params.token || '').trim();
      const { assetId } = req.params;
      if (!token) return res.status(400).json({ error: 'token required' });
      if (!isBucketConfigured()) {
        return res.status(503).json({ error: 'Platform file storage is not configured.' });
      }
      await ensureEventBoardSchema(pool);
      const dataRes = await pool.query(
        `SELECT event_id FROM public.event_board_data
         WHERE public_token = $1 AND public_control_enabled = TRUE LIMIT 1`,
        [token]
      );
      const eventId = dataRes.rows[0]?.event_id;
      if (!eventId) return res.status(404).json({ error: 'Public Meeting Hub not found or disabled.' });
      const result = await pool.query(
        `SELECT * FROM public.event_board_assets WHERE id = $1 AND event_id = $2 AND zone = 'powerpoint' LIMIT 1`,
        [assetId, eventId]
      );
      const row = result.rows[0];
      if (!row) return res.status(404).json({ error: 'Deck not found' });
      if (!isPowerpointAsset(row.original_name, row.mime_type)) {
        return res.status(400).json({ error: 'Only PowerPoint decks can be opened from public control.' });
      }
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
      console.error('public meeting-hub asset url error:', error);
      res.status(500).json({ error: error.message || 'Failed to get deck URL' });
    }
  });

  return { ensureEventBoardSchema };
}

module.exports = {
  registerEventBoardRoutes,
  ensureEventBoardSchema,
  BOARD_ZONES,
};
