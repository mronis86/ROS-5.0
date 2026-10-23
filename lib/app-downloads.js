/**
 * Public operator downloads hosted on a dedicated Railway bucket.
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DOWNLOAD_URL_TTL_SEC = 60 * 60;
const HOSTED_DOWNLOADS = {
  'powerpoint-bridge.zip': {
    key: 'downloads/powerpoint-bridge.zip',
    contentType: 'application/zip',
    label: 'PowerPoint Bridge',
  },
  'ros-vmix-datasource-bridge.zip': {
    key: 'downloads/ros-vmix-datasource-bridge.zip',
    contentType: 'application/zip',
    label: 'vMix DataSource Bridge',
  },
  'ros-hyperdeck-ingest.zip': {
    key: 'downloads/ros-hyperdeck-ingest.zip',
    contentType: 'application/zip',
    label: 'HyperDeck Ingest',
  },
};

function getDownloadsBucketConfig() {
  const bucket =
    process.env.DOWNLOADS_BUCKET_NAME ||
    process.env.DOWNLOADS_BUCKET ||
    '';
  const accessKeyId =
    process.env.DOWNLOADS_BUCKET_ACCESS_KEY_ID ||
    process.env.DOWNLOADS_AWS_ACCESS_KEY_ID ||
    '';
  const secretAccessKey =
    process.env.DOWNLOADS_BUCKET_SECRET_ACCESS_KEY ||
    process.env.DOWNLOADS_AWS_SECRET_ACCESS_KEY ||
    '';
  const region =
    process.env.DOWNLOADS_BUCKET_REGION ||
    process.env.DOWNLOADS_AWS_REGION ||
    'auto';
  const endpoint =
    process.env.DOWNLOADS_BUCKET_ENDPOINT ||
    process.env.DOWNLOADS_AWS_ENDPOINT_URL ||
    '';
  return {
    bucket: String(bucket).trim(),
    accessKeyId: String(accessKeyId).trim(),
    secretAccessKey: String(secretAccessKey).trim(),
    region: String(region).trim() || 'auto',
    endpoint: String(endpoint).trim(),
    forcePathStyle: /^(1|true|yes)$/i.test(String(process.env.DOWNLOADS_S3_FORCE_PATH_STYLE || '').trim()),
  };
}

function isDownloadsBucketConfigured() {
  const c = getDownloadsBucketConfig();
  return Boolean(c.bucket && c.accessKeyId && c.secretAccessKey && c.endpoint);
}

let downloadsClient = null;
function getDownloadsS3() {
  if (!isDownloadsBucketConfigured()) return null;
  if (downloadsClient) return downloadsClient;
  const c = getDownloadsBucketConfig();
  downloadsClient = new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: c.forcePathStyle,
    credentials: {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
    },
  });
  return downloadsClient;
}

function hostedDownload(fileName) {
  const safe = path.basename(String(fileName || '').trim());
  return HOSTED_DOWNLOADS[safe] || null;
}

async function presignDownload(fileName) {
  const item = hostedDownload(fileName);
  if (!item) return null;
  if (!isDownloadsBucketConfigured()) {
    const err = new Error('Downloads bucket is not configured');
    err.statusCode = 503;
    throw err;
  }
  const s3 = getDownloadsS3();
  const { bucket } = getDownloadsBucketConfig();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
  } catch (err) {
    const missing = err && (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound');
    if (missing) {
      const notFound = new Error(`${item.label} is not uploaded yet`);
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: item.key,
      ResponseContentDisposition: `attachment; filename="${path.basename(fileName)}"`,
      ResponseContentType: item.contentType,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SEC }
  );
  return { url, item };
}

function disableDownloadTimeouts(req, res) {
  if (typeof req.setTimeout === 'function') req.setTimeout(0);
  if (typeof res.setTimeout === 'function') res.setTimeout(0);
}

function pipeDownloadBody(body, res) {
  if (!body) {
    const err = new Error('Empty download body');
    err.statusCode = 502;
    throw err;
  }
  const onError = (err) => {
    console.error('[downloads] stream failed:', err.message || err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Download stream failed' });
      return;
    }
    res.destroy(err);
  };
  if (typeof body.pipe === 'function') {
    body.on('error', onError);
    body.pipe(res);
    return;
  }
  if (typeof body.transformToWebStream === 'function') {
    const nodeStream = Readable.fromWeb(body.transformToWebStream());
    nodeStream.on('error', onError);
    nodeStream.pipe(res);
    return;
  }
  const err = new Error('Unsupported download body');
  err.statusCode = 502;
  throw err;
}

async function streamHostedDownload(fileName) {
  const item = hostedDownload(fileName);
  if (!item) return null;
  if (!isDownloadsBucketConfigured()) {
    const err = new Error('Downloads bucket is not configured');
    err.statusCode = 503;
    throw err;
  }
  const s3 = getDownloadsS3();
  const { bucket } = getDownloadsBucketConfig();
  try {
    return {
      item,
      object: await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: item.key,
        })
      ),
    };
  } catch (err) {
    const missing = err && (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound');
    if (missing) {
      const notFound = new Error(`${item.label} is not uploaded yet`);
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }
}

async function uploadLocalDownload(fileName, localPath) {
  const item = hostedDownload(fileName);
  if (!item) throw new Error(`Unknown download: ${fileName}`);
  if (!isDownloadsBucketConfigured()) throw new Error('Downloads bucket is not configured');
  const body = fs.readFileSync(localPath);
  const s3 = getDownloadsS3();
  const { bucket } = getDownloadsBucketConfig();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: item.key,
      Body: body,
      ContentType: item.contentType,
    })
  );
  return { key: item.key, bytes: body.length };
}

function registerAppDownloadRoutes(app) {
  app.get('/api/downloads', (_req, res) => {
    res.json({
      configured: isDownloadsBucketConfigured(),
      files: Object.entries(HOSTED_DOWNLOADS).map(([fileName, item]) => ({
        fileName,
        label: item.label,
        url: `/api/downloads/${encodeURIComponent(fileName)}`,
      })),
    });
  });

  app.get('/api/downloads/:fileName', async (req, res) => {
    try {
      const fileName = path.basename(String(req.params.fileName || ''));
      const item = hostedDownload(fileName);
      if (!item) {
        return res.status(404).json({ error: 'Unknown download' });
      }
      // Stream through the Railway API so browsers never see storageapi.dev.
      disableDownloadTimeouts(req, res);
      const { object } = await streamHostedDownload(fileName);
      const safeName = fileName.replace(/"/g, '');
      res.setHeader('Content-Type', item.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Accel-Buffering', 'no');
      if (object.ContentLength != null) {
        res.setHeader('Content-Length', String(object.ContentLength));
      }
      pipeDownloadBody(object.Body, res);
    } catch (err) {
      const status = err.statusCode || 500;
      console.error('[downloads] GET failed:', err.message || err);
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      return res.status(status).json({ error: err.message || 'Download failed' });
    }
  });
}

module.exports = {
  HOSTED_DOWNLOADS,
  getDownloadsBucketConfig,
  isDownloadsBucketConfigured,
  getDownloadsS3,
  presignDownload,
  streamHostedDownload,
  uploadLocalDownload,
  registerAppDownloadRoutes,
};
