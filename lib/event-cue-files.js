/**
 * Cue asset uploads to Railway Storage Buckets (S3-compatible).
 * Files expire 4 months after upload and are deleted by a periodic cleanup.
 */

const crypto = require('crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { userCanAccessEvent } = require('./api-auth');

const RETENTION_MONTHS = 4;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_URL_TTL_SEC = 60 * 60;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const ALLOWED_EXT = new Set([
  'pdf', 'ppt', 'pptx', 'key', 'doc', 'docx', 'xls', 'xlsx', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'mp4', 'mov', 'm4v', 'mp3', 'wav', 'm4a',
  'zip', 'txt',
]);

const DDL = `
  CREATE TABLE IF NOT EXISTS public.event_cue_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL,
    item_id BIGINT NOT NULL,
    object_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    uploaded_by TEXT,
    uploaded_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_cue_files_event_item
    ON public.event_cue_files (event_id, item_id);
  CREATE INDEX IF NOT EXISTS idx_event_cue_files_expires
    ON public.event_cue_files (expires_at);
`;

function getBucketConfig() {
  const bucket =
    process.env.BUCKET_NAME ||
    process.env.BUCKET ||
    process.env.AWS_S3_BUCKET ||
    process.env.AWS_S3_BUCKET_NAME ||
    process.env.S3_BUCKET ||
    '';
  const accessKeyId =
    process.env.BUCKET_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.ACCESS_KEY_ID ||
    '';
  const secretAccessKey =
    process.env.BUCKET_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.SECRET_ACCESS_KEY ||
    '';
  const region =
    process.env.BUCKET_REGION ||
    process.env.AWS_REGION ||
    process.env.REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'auto';
  const endpoint =
    process.env.BUCKET_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL_S3 ||
    process.env.AWS_ENDPOINT_URL ||
    process.env.ENDPOINT ||
    '';
  return {
    bucket: String(bucket).trim(),
    accessKeyId: String(accessKeyId).trim(),
    secretAccessKey: String(secretAccessKey).trim(),
    region: String(region).trim() || 'auto',
    endpoint: String(endpoint).trim(),
    // New Railway buckets use virtual-hosted URLs. Set S3_FORCE_PATH_STYLE=true for older buckets.
    forcePathStyle: /^(1|true|yes)$/i.test(String(process.env.S3_FORCE_PATH_STYLE || '').trim()),
  };
}

function isBucketConfigured() {
  const c = getBucketConfig();
  return Boolean(c.bucket && c.accessKeyId && c.secretAccessKey && c.endpoint);
}

let s3Client = null;
function getS3() {
  if (!isBucketConfigured()) return null;
  if (s3Client) return s3Client;
  const c = getBucketConfig();
  s3Client = new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: c.forcePathStyle,
    credentials: {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
    },
  });
  return s3Client;
}

async function ensureEventCueFilesSchema(pool) {
  await pool.query(DDL);
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function safeOriginalName(name) {
  const base = String(name || 'file')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return base || 'file';
}

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function isAllowedFile(originalName, mimeType) {
  const ext = fileExtension(originalName);
  if (ALLOWED_EXT.has(ext)) return true;
  const mime = String(mimeType || '').toLowerCase();
  return mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/') || mime === 'application/pdf';
}

function mapFileRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    itemId: Number(row.item_id),
    originalName: row.original_name,
    mimeType: row.mime_type || null,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    uploadedBy: row.uploaded_by || null,
    uploadedByName: row.uploaded_by_name || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function deleteS3Key(key) {
  const s3 = getS3();
  if (!s3 || !key) return;
  const { bucket } = getBucketConfig();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function deleteCueFilesForEventIds(pool, eventIds) {
  const ids = [...new Set((eventIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return { deleted: 0 };
  const rows = await pool.query(
    `SELECT id, object_key FROM public.event_cue_files WHERE event_id = ANY($1)`,
    [ids]
  );
  for (const row of rows.rows || []) {
    try {
      await deleteS3Key(row.object_key);
    } catch (err) {
      console.warn('[cue-files] S3 delete failed during event purge:', row.object_key, err.message || err);
    }
  }
  const del = await pool.query(
    `DELETE FROM public.event_cue_files WHERE event_id = ANY($1)`,
    [ids]
  );
  return { deleted: del.rowCount || 0 };
}

async function cleanupExpiredCueFiles(pool) {
  if (!isBucketConfigured()) return { deleted: 0, skipped: true };
  const expired = await pool.query(
    `SELECT id, object_key FROM public.event_cue_files WHERE expires_at <= now() ORDER BY expires_at ASC LIMIT 200`
  );
  let deleted = 0;
  for (const row of expired.rows || []) {
    try {
      await deleteS3Key(row.object_key);
      await pool.query(`DELETE FROM public.event_cue_files WHERE id = $1`, [row.id]);
      deleted += 1;
    } catch (err) {
      console.warn('[cue-files] expired cleanup failed:', row.id, err.message || err);
    }
  }
  if (deleted > 0) {
    console.log(`[cue-files] deleted ${deleted} expired upload(s)`);
  }
  return { deleted };
}

function uploaderFromAuth(req) {
  const auth = req.auth || {};
  return {
    id: auth.userId || auth.email || auth.accessId || null,
    name: auth.fullName || auth.email || auth.userName || null,
  };
}

function denyIfNoEventAccess(req, res, eventId) {
  if (req.auth && !userCanAccessEvent(req.auth, eventId)) {
    res.status(403).json({ error: 'You do not have access to this event.' });
    return true;
  }
  return false;
}

const cueFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (isAllowedFile(file.originalname, file.mimetype)) cb(null, true);
    else cb(new Error('That file type is not allowed. Use PDF, Office, image, audio, video, or zip.'));
  },
});

function registerEventCueFileRoutes(app, pool) {
  app.get('/api/event-cue-files/status', async (_req, res) => {
    res.json({
      configured: isBucketConfigured(),
      retentionMonths: RETENTION_MONTHS,
      maxFileBytes: MAX_FILE_BYTES,
    });
  });

  app.get('/api/events/:eventId/cue-files', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensureEventCueFilesSchema(pool);
      const r = await pool.query(
        `SELECT * FROM public.event_cue_files WHERE event_id = $1 ORDER BY created_at ASC`,
        [eventId]
      );
      res.json({ files: (r.rows || []).map(mapFileRow) });
    } catch (err) {
      console.error('[cue-files] list event failed:', err);
      res.status(500).json({ error: err.message || 'Failed to list files' });
    }
  });

  app.get('/api/events/:eventId/cue-files/:itemId', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      const itemId = parseInt(req.params.itemId, 10);
      if (!eventId || !Number.isFinite(itemId)) {
        return res.status(400).json({ error: 'eventId and itemId required' });
      }
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensureEventCueFilesSchema(pool);
      const r = await pool.query(
        `SELECT * FROM public.event_cue_files WHERE event_id = $1 AND item_id = $2 ORDER BY created_at ASC`,
        [eventId, itemId]
      );
      res.json({ files: (r.rows || []).map(mapFileRow) });
    } catch (err) {
      console.error('[cue-files] list cue failed:', err);
      res.status(500).json({ error: err.message || 'Failed to list files' });
    }
  });

  app.post(
    '/api/events/:eventId/cue-files/:itemId',
    (req, res, next) => {
      cueFileUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const msg = err.message || 'Upload failed';
        const status = /file too large/i.test(msg) ? 413 : 400;
        return res.status(status).json({
          error:
            status === 413
              ? `File is too large. Max size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`
              : msg,
        });
      });
    },
    async (req, res) => {
      try {
        if (!isBucketConfigured()) {
          return res.status(503).json({
            error: 'Platform file storage is not configured yet. Use a Dropbox / Drive link instead.',
          });
        }
        const eventId = String(req.params.eventId || '').trim();
        const itemId = parseInt(req.params.itemId, 10);
        if (!eventId || !Number.isFinite(itemId) || itemId <= 0) {
          return res.status(400).json({ error: 'Save the cue first, then upload files.' });
        }
        if (denyIfNoEventAccess(req, res, eventId)) return;
        if (!req.file?.buffer) {
          return res.status(400).json({ error: 'No file uploaded.' });
        }
        if (!isAllowedFile(req.file.originalname, req.file.mimetype)) {
          return res.status(400).json({ error: 'That file type is not allowed.' });
        }

        await ensureEventCueFilesSchema(pool);
        const originalName = safeOriginalName(req.file.originalname);
        const fileId = crypto.randomUUID();
        const objectKey = `cue-assets/${eventId}/${itemId}/${fileId}/${originalName}`;
        const createdAt = new Date();
        const expiresAt = addMonths(createdAt, RETENTION_MONTHS);
        const uploader = uploaderFromAuth(req);
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

        const inserted = await pool.query(
          `INSERT INTO public.event_cue_files (
             id, event_id, item_id, object_key, original_name, mime_type, size_bytes,
             uploaded_by, uploaded_by_name, created_at, expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            fileId,
            eventId,
            itemId,
            objectKey,
            originalName,
            req.file.mimetype || null,
            req.file.size || req.file.buffer.length,
            uploader.id,
            uploader.name,
            createdAt.toISOString(),
            expiresAt.toISOString(),
          ]
        );

        res.status(201).json({ file: mapFileRow(inserted.rows[0]) });
      } catch (err) {
        console.error('[cue-files] upload failed:', err);
        res.status(500).json({ error: err.message || 'Upload failed' });
      }
    }
  );

  app.get('/api/event-cue-files/:fileId/download', async (req, res) => {
    try {
      if (!isBucketConfigured()) {
        return res.status(503).json({ error: 'Platform file storage is not configured.' });
      }
      await ensureEventCueFilesSchema(pool);
      const r = await pool.query(`SELECT * FROM public.event_cue_files WHERE id = $1`, [req.params.fileId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'File not found' });
      if (denyIfNoEventAccess(req, res, row.event_id)) return;
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return res.status(410).json({ error: 'This file has expired and was deleted (4-month retention).' });
      }
      const s3 = getS3();
      const { bucket } = getBucketConfig();
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: row.object_key,
          ResponseContentDisposition: `attachment; filename="${safeOriginalName(row.original_name)}"`,
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SEC }
      );
      if (String(req.query.redirect || '') === '1') {
        return res.redirect(302, url);
      }
      res.json({ url, expiresIn: DOWNLOAD_URL_TTL_SEC, file: mapFileRow(row) });
    } catch (err) {
      console.error('[cue-files] download failed:', err);
      res.status(500).json({ error: err.message || 'Download failed' });
    }
  });

  app.delete('/api/event-cue-files/:fileId', async (req, res) => {
    try {
      await ensureEventCueFilesSchema(pool);
      const r = await pool.query(`SELECT * FROM public.event_cue_files WHERE id = $1`, [req.params.fileId]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ error: 'File not found' });
      if (denyIfNoEventAccess(req, res, row.event_id)) return;
      try {
        await deleteS3Key(row.object_key);
      } catch (err) {
        console.warn('[cue-files] S3 delete failed:', row.object_key, err.message || err);
      }
      await pool.query(`DELETE FROM public.event_cue_files WHERE id = $1`, [req.params.fileId]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[cue-files] delete failed:', err);
      res.status(500).json({ error: err.message || 'Delete failed' });
    }
  });
}

function startEventCueFileCleanup(pool) {
  if (!isBucketConfigured()) {
    console.warn('[cue-files] Railway bucket not configured — platform uploads disabled');
    return;
  }
  const run = () => {
    cleanupExpiredCueFiles(pool).catch((err) => {
      console.warn('[cue-files] cleanup error:', err.message || err);
    });
  };
  setTimeout(run, 20 * 1000);
  setInterval(run, CLEANUP_INTERVAL_MS);
}

module.exports = {
  RETENTION_MONTHS,
  MAX_FILE_BYTES,
  isBucketConfigured,
  getBucketConfig,
  getS3,
  safeOriginalName,
  ensureEventCueFilesSchema,
  registerEventCueFileRoutes,
  startEventCueFileCleanup,
  deleteCueFilesForEventIds,
  cleanupExpiredCueFiles,
};
