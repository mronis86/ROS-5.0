/**
 * CLI entry: bake transparent WebM hold clips for each LED cue.
 *
 *   npm run prerender:led-cues -- --eventId=<uuid> --token=<ros_itok_...>
 *   cd spout-bridge && npm run bake -- --eventId=… --token=…
 */
const { app } = require('electron');
const path = require('path');
const { bakeLedPrerenderPack } = require('../electron/bake-pack');

const DEFAULT_API = 'https://ros-50-production.up.railway.app';
const DEFAULT_APP = 'http://localhost:3003';

function parseArgs(argv) {
  const out = {
    eventId: '',
    token: '',
    appUrl: DEFAULT_APP,
    apiUrl: DEFAULT_API,
    outDir: '',
    width: 1920,
    height: 1080,
    format: 'apng',
    holdSeconds: 1,
    ffmpeg: 'ffmpeg',
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const val = eq === -1 ? '1' : arg.slice(eq + 1);
    switch (key) {
      case 'eventId':
        out.eventId = val;
        break;
      case 'token':
        out.token = val;
        break;
      case 'appUrl':
        out.appUrl = val.replace(/\/$/, '');
        break;
      case 'apiUrl':
        out.apiUrl = val.replace(/\/$/, '');
        break;
      case 'out':
        out.outDir = val;
        break;
      case 'width':
        out.width = Math.max(640, parseInt(val, 10) || 1920);
        break;
      case 'height':
        out.height = Math.max(360, parseInt(val, 10) || 1080);
        break;
      case 'format':
        out.format = ['apng', 'webp', 'webm'].includes(String(val).toLowerCase())
          ? String(val).toLowerCase()
          : 'apng';
        break;
      case 'formats':
        out.formats = String(val)
          .split(',')
          .map((format) => format.trim().toLowerCase())
          .filter((format) => ['apng', 'webp', 'webm'].includes(format));
        break;
      case 'holdSeconds':
        out.holdSeconds = Math.max(0.2, parseFloat(val) || 1);
        break;
      case 'ffmpeg':
        out.ffmpeg = val;
        break;
      default:
        break;
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.eventId) {
    console.error('Missing --eventId=…');
    app.exit(1);
    return;
  }
  if (!opts.token) {
    console.error('Missing --token=… (or use Bake pack in the Spout app UI)');
    app.exit(1);
    return;
  }

  const { session } = require('electron');
  const { installApiAuth } = require('../electron/auth-session');
  installApiAuth(session.defaultSession, opts.apiUrl, opts.token);

  const outDir =
    opts.outDir || path.join(process.cwd(), 'led-prerenders', String(opts.eventId));

  try {
    const result = await bakeLedPrerenderPack({
      ...opts,
      outDir,
      onProgress: (p) => console.log(p.message || ''),
    });
    console.log('');
    console.log('Done.');
    console.log(`Pack: ${result.outDir}`);
    console.log(`Manifest cues: ${result.cueCount}`);
    app.exit(0);
  } catch (err) {
    console.error(err.message || err);
    app.exit(1);
  }
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
