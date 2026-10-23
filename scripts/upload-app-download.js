/**
 * Upload a hosted operator zip to the Railway ros-downloads bucket
 * and wire DOWNLOADS_BUCKET_* vars onto the ROS-5.0 service.
 *
 * Usage:
 *   node scripts/upload-app-download.js public/powerpoint-bridge.zip
 *   node scripts/upload-app-download.js public/ros-vmix-datasource-bridge.zip
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const projectRoot = path.resolve(__dirname, '..');
const railwayBin = process.platform === 'win32' ? 'railway.cmd' : 'railway';

function railway(args) {
  return execFileSync(railwayBin, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function setVar(key, value) {
  execFileSync(railwayBin, ['variable', 'set', key, '--stdin', '--skip-deploys', '--service', 'ROS-5.0'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    input: String(value),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const localPath = path.resolve(process.argv[2] || path.join(projectRoot, 'public', 'powerpoint-bridge.zip'));
const fileName = path.basename(localPath);
if (!fs.existsSync(localPath)) {
  console.error(`Missing file: ${localPath}`);
  process.exit(1);
}

const HOSTED = {
  'powerpoint-bridge.zip': {
    key: 'downloads/powerpoint-bridge.zip',
    contentType: 'application/zip',
  },
  'ros-vmix-datasource-bridge.zip': {
    key: 'downloads/ros-vmix-datasource-bridge.zip',
    contentType: 'application/zip',
  },
};
const item = HOSTED[fileName];
if (!item) {
  console.error(`Not a hosted download: ${fileName}`);
  process.exit(1);
}

const creds = JSON.parse(railway(['bucket', 'credentials', '--bucket', 'ros-downloads', '--json']));
if (!creds.accessKeyId || !creds.secretAccessKey || !creds.endpoint || !creds.bucketName) {
  console.error('ros-downloads credentials were incomplete');
  process.exit(1);
}

setVar('DOWNLOADS_BUCKET_NAME', creds.bucketName);
setVar('DOWNLOADS_BUCKET_ENDPOINT', creds.endpoint);
setVar('DOWNLOADS_BUCKET_ACCESS_KEY_ID', creds.accessKeyId);
setVar('DOWNLOADS_BUCKET_SECRET_ACCESS_KEY', creds.secretAccessKey);
setVar('DOWNLOADS_BUCKET_REGION', creds.region || 'auto');

const s3 = new S3Client({
  region: creds.region || 'auto',
  endpoint: creds.endpoint,
  forcePathStyle: creds.urlStyle === 'path',
  credentials: {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
  },
});

const body = fs.readFileSync(localPath);
s3.send(
  new PutObjectCommand({
    Bucket: creds.bucketName,
    Key: item.key,
    Body: body,
    ContentType: item.contentType,
  })
)
  .then(() => {
    const mb = (body.length / (1024 * 1024)).toFixed(2);
    console.log(`Uploaded ${fileName} (${mb} MB) to ros-downloads/${item.key}`);
    console.log('Set DOWNLOADS_BUCKET_* on ROS-5.0 (deploy skipped)');
  })
  .catch((err) => {
    console.error('Upload failed:', err.message || err);
    process.exit(1);
  });
