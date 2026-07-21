/**
 * Shared LED prerender bake — used by Spout UI and CLI script.
 * Records each cue's animate-in (transparent PNG sequence → VP9+alpha WebM).
 */
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function normalizeScheduleItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hasLedContent(item) {
  const cf = item?.customFields || item?.custom_fields;
  let layout = cf?.ledLayout ?? cf?.led_layout;
  if (typeof layout === 'string') {
    try {
      layout = JSON.parse(layout);
    } catch {
      layout = null;
    }
  }
  if (!layout || typeof layout !== 'object') return false;
  if (layout.sessionTitle?.enabled) return true;
  if (Array.isArray(layout.speakers) && layout.speakers.some((s) => s?.enabled)) return true;
  return false;
}

function cueLabel(item) {
  const cue = item?.customFields?.cue ?? item?.cue;
  if (cue != null && String(cue).trim()) return String(cue).trim();
  return `item-${item.id}`;
}

async function fetchSchedule(apiUrl, eventId, token) {
  const base = String(apiUrl || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/run-of-show-data/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} fetching run-of-show-data`);
  }
  return res.json();
}

function ensureFfmpeg(ffmpegPath) {
  const probe = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `ffmpeg not found (${ffmpegPath}). Install ffmpeg and ensure it is on PATH, then retry Bake pack.`
    );
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveFfprobe(ffmpegPath) {
  if (!ffmpegPath || ffmpegPath === 'ffmpeg') return 'ffprobe';
  if (/ffprobe(\.exe)?$/i.test(ffmpegPath)) return ffmpegPath;
  return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (_, ext) => `ffprobe${ext || ''}`);
}

/** True when the WebM video stream still has an alpha plane. */
function webmHasAlpha(ffmpegPath, webmPath) {
  const ffprobe = resolveFfprobe(ffmpegPath);
  const result = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt:stream_tags=alpha_mode',
      '-of',
      'json',
      webmPath,
    ],
    { encoding: 'utf8' }
  );
  let codec = '';
  try {
    const json = JSON.parse(result.stdout || '{}');
    const stream = json?.streams?.[0] || {};
    const pix = String(stream.pix_fmt || '');
    codec = String(stream.codec_name || '');
    const tags = stream.tags || {};
    const alphaMode = Object.entries(tags).find(
      ([key]) => String(key).toLowerCase() === 'alpha_mode'
    )?.[1];
    if (/yuva|rgba|gbrap/i.test(pix) || String(alphaMode) === '1') {
      return true;
    }
  } catch {
    /* Force-decode check below. */
  }

  // FFmpeg's native VP8/VP9 decoder commonly reports yuv420p even when the
  // WebM has alpha. Force libvpx and ask alphaextract to read the alpha plane.
  // Successful alphaextract is the reliable test used by ffmpeg itself.
  const decoders =
    codec === 'vp8'
      ? ['libvpx']
      : codec === 'vp9'
        ? ['libvpx-vp9']
        : ['libvpx', 'libvpx-vp9'];
  for (const decoder of decoders) {
    const decoded = spawnSync(
      ffmpegPath,
      [
        '-v',
        'error',
        '-c:v',
        decoder,
        '-i',
        webmPath,
        '-frames:v',
        '1',
        '-vf',
        'alphaextract',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' }
    );
    if (decoded.status === 0) return true;
  }

  return false;
}

/**
 * PNG sequence → WebM with alpha.
 * Chromium/Electron need alpha_mode=1 + yuva420p; VP8a is the most reliable fallback.
 */
function framesToWebm(ffmpegPath, framesDir, webmPath, fps) {
  const pattern = path.join(framesDir, 'frame_%04d.png');

  const tryEncode = (codec) => {
    const isVp9 = codec === 'libvpx-vp9';
    const args = [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      pattern,
      '-an',
      // Force alpha through the filter graph (PNG → RGBA → YUVA).
      '-vf',
      'format=rgba,format=yuva420p',
      '-c:v',
      codec,
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-lag-in-frames',
      '0',
      '-b:v',
      '0',
      '-crf',
      // VP9 lossless fixes the quantizer range at 0–0, so CRF must also be 0.
      isVp9 ? '0' : '20',
      '-metadata:s:v:0',
      'alpha_mode=1',
    ];
    if (isVp9) {
      args.push(
        '-lossless',
        '1',
        '-row-mt',
        '1',
        '-cpu-used',
        '2',
        '-deadline',
        'good'
      );
    } else {
      args.push('-quality', 'good', '-cpu-used', '2');
    }
    args.push(webmPath);

    const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(
        `ffmpeg ${codec} failed for ${path.basename(webmPath)}:\n${result.stderr || result.stdout}`
      );
    }
  };

  // Try lossless VP9a first for text quality; VP8a is the compatibility fallback.
  let hasAlpha = false;
  try {
    tryEncode('libvpx-vp9');
    hasAlpha = webmHasAlpha(ffmpegPath, webmPath);
  } catch (error) {
    console.warn(
      `[bake] VP9 encode failed — retrying as VP8a: ${path.basename(webmPath)}: ` +
        `${error.message || error}`
    );
  }
  if (!hasAlpha) {
    console.warn(`[bake] Retrying WebM as VP8a: ${path.basename(webmPath)}`);
    tryEncode('libvpx');
    hasAlpha = webmHasAlpha(ffmpegPath, webmPath);
  }
  if (!hasAlpha) {
    throw new Error(
      `WebM encode lost alpha channel for ${path.basename(webmPath)}. ` +
        `Check ffmpeg was built with libvpx and supports yuva420p.`
    );
  }
}

/** PNG sequence → lossless animated PNG with full 8-bit RGBA alpha. */
function framesToApng(ffmpegPath, framesDir, apngPath, fps) {
  const pattern = path.join(framesDir, 'frame_%04d.png');
  const args = [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    pattern,
    '-an',
    '-c:v',
    'apng',
    '-pix_fmt',
    'rgba',
    '-pred',
    'mixed',
    '-plays',
    '1',
    '-f',
    'apng',
    apngPath,
  ];
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg APNG failed for ${path.basename(apngPath)}:\n${result.stderr || result.stdout}`
    );
  }
}

/** PNG sequence → lossless animated WebP with full alpha. */
function framesToWebp(ffmpegPath, framesDir, webpPath, fps) {
  const pattern = path.join(framesDir, 'frame_%04d.png');
  const args = [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    pattern,
    '-an',
    '-vf',
    'format=bgra',
    '-c:v',
    'libwebp_anim',
    '-lossless',
    '1',
    '-quality',
    '100',
    '-preset',
    'text',
    '-loop',
    '1',
    webpPath,
  ];
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg WebP failed for ${path.basename(webpPath)}:\n${result.stderr || result.stdout}`
    );
  }
}

async function readPrerenderState(win) {
  return win.webContents.executeJavaScript(`({
    ready: document.documentElement.getAttribute('data-led-prerender-ready') === '1',
    recording: document.documentElement.getAttribute('data-led-prerender-recording') === '1',
    bakeControl: document.documentElement.getAttribute('data-led-bake-control') === '1',
    error: document.documentElement.getAttribute('data-led-prerender-error') || '',
    phase: document.documentElement.getAttribute('data-led-prerender-phase') || '',
    inMs: parseInt(document.documentElement.getAttribute('data-led-prerender-in-ms') || '0', 10) || 0,
    inDelayMs: parseInt(document.documentElement.getAttribute('data-led-prerender-in-delay-ms') || '0', 10) || 0,
    clipMs: parseInt(document.documentElement.getAttribute('data-led-prerender-clip-ms') || '0', 10) || 0,
    hasBakeApi: typeof window.__ledBakeControl?.seek === 'function',
    href: location.href
  })`);
}

async function seekBakeFrame(win, ms) {
  await win.webContents.executeJavaScript(`
    (async () => {
      const ctrl = window.__ledBakeControl;
      if (!ctrl || typeof ctrl.seek !== 'function') {
        throw new Error('__ledBakeControl.seek missing — use app URL on this branch with bakeSeek=1');
      }
      await ctrl.seek(${Number(ms) || 0});
    })()
  `);
}

/**
 * Deterministic enter bake: seek CSS animation to each frame time, then capturePage.
 * Real-time capturePage cannot keep up at LED resolutions (choppy sparse frames).
 * Seeking gives exactly targetFps samples across inDelay+inDuration — matches live preview.
 */
async function recordCueEnter(opts, item, framesDir) {
  const appUrl = String(opts.appUrl || '').replace(/\/$/, '');
  const targetFps = Math.min(60, Math.max(15, Number(opts.fps) || 60));
  const settleMs = 120;
  const url =
    `${appUrl}/led-output?eventId=${encodeURIComponent(opts.eventId)}` +
    `&key=1&prerender=1&bakeSeek=1&itemId=${encodeURIComponent(String(item.id))}&clock=0`;

  fs.mkdirSync(framesDir, { recursive: true });
  for (const name of fs.readdirSync(framesDir)) {
    if (name.startsWith('frame_') && name.endsWith('.png')) {
      fs.unlinkSync(path.join(framesDir, name));
    }
  }

  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      offscreen: false,
    },
  });

  try {
    win.webContents.setFrameRate(targetFps);
  } catch {
    /* older electron */
  }

  let frameIndex = 0;
  const captureOne = async () => {
    if (win.isDestroyed()) return;
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: opts.width,
      height: opts.height,
    });
    const file = path.join(framesDir, `frame_${String(frameIndex).padStart(4, '0')}.png`);
    fs.writeFileSync(file, image.toPNG());
    frameIndex += 1;
  };

  try {
    await win.loadURL(url);

    const waitStarted = Date.now();
    const timeoutMs = 45000;
    let timing = null;
    while (Date.now() - waitStarted < timeoutMs) {
      const state = await readPrerenderState(win);
      if (state?.error) {
        throw new Error(`LED prerender error: ${state.error}`);
      }
      if (state?.bakeControl && state?.hasBakeApi) {
        timing = {
          inDelayMs: state.inDelayMs || 0,
          inMs: state.inMs || 0,
          clipMs: state.clipMs || (state.inDelayMs || 0) + (state.inMs || 0),
        };
        break;
      }
      await sleep(50);
    }

    if (!timing) {
      const detail = await readPrerenderState(win).catch(() => ({}));
      throw new Error(
        `Timed out waiting for bake seek API. Use http://localhost:3003 on this branch. Detail: ${JSON.stringify(detail)}`
      );
    }

    const animMs = Math.max(0, timing.clipMs || timing.inDelayMs + timing.inMs || 0);
    const totalMs = Math.max(1000 / targetFps, animMs + settleMs);
    const frameCount = Math.max(2, Math.round((totalMs / 1000) * targetFps) + 1);

    for (let i = 0; i < frameCount; i++) {
      const t = Math.min(totalMs, (i / targetFps) * 1000);
      await seekBakeFrame(win, t);
      await captureOne();
    }

    if (frameIndex < 2) {
      throw new Error(`Too few frames captured for item ${item.id} (${frameIndex})`);
    }

    return {
      framesDir,
      frameCount: frameIndex,
      durationMs: Math.round((frameIndex / targetFps) * 1000),
      animMs,
      inDelayMs: timing.inDelayMs,
      inMs: timing.inMs,
      fps: targetFps,
      targetFps,
    };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * @param {object} opts
 * @param {string} opts.eventId
 * @param {string} opts.token
 * @param {string} opts.appUrl
 * @param {string} opts.apiUrl
 * @param {string} opts.outDir
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.fps]  Encode fps for enter animation (default 60)
 * @param {Array<'apng'|'webp'|'webm'>} [opts.formats]
 * @param {'apng'|'webp'|'webm'} [opts.format] Legacy single-format option
 * @param {string} [opts.ffmpeg]
 * @param {(msg: object) => void} [opts.onProgress]
 */
async function bakeLedPrerenderPack(opts) {
  const eventId = String(opts.eventId || '').trim();
  const token = String(opts.token || '').trim();
  const appUrl = String(opts.appUrl || '').replace(/\/$/, '');
  const apiUrl = String(opts.apiUrl || '').replace(/\/$/, '');
  const outDir = path.resolve(String(opts.outDir || '').trim());
  const width = Math.max(640, Number(opts.width) || 1920);
  const height = Math.max(360, Number(opts.height) || 1080);
  const fps = Math.min(60, Math.max(15, Number(opts.fps) || 60));
  const requestedFormats = Array.isArray(opts.formats) ? opts.formats : [opts.format];
  const formats = [
    ...new Set(
      requestedFormats
        .map((value) => String(value || '').toLowerCase())
        .filter((value) => ['apng', 'webp', 'webm'].includes(value))
    ),
  ];
  if (!formats.length) formats.push('apng');
  const ffmpeg = opts.ffmpeg || 'ffmpeg';
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  if (!eventId) throw new Error('Event ID is required');
  if (!token) throw new Error('API token is required (Admin → Integration API tokens)');
  if (!appUrl) throw new Error('Hosted app URL is required (where /led-output loads)');
  if (!apiUrl) throw new Error('API base URL is required');
  if (!outDir) throw new Error('Output folder is required');

  ensureFfmpeg(ffmpeg);
  onProgress({ phase: 'schedule', message: 'Fetching schedule…' });

  const data = await fetchSchedule(apiUrl, eventId, token);
  const items = normalizeScheduleItems(data.schedule_items);
  const ledItems = items.filter((item) => item?.id != null && hasLedContent(item));

  if (!ledItems.length) {
    throw new Error('No cues with LED layout content found for this event. Set layouts on LED Set first.');
  }

  const multipleFormats = formats.length > 1;
  const folderNames = { apng: 'APNG', webp: 'WebP', webm: 'WebM' };
  const packRoots = Object.fromEntries(
    formats.map((format) => [
      format,
      multipleFormats ? path.join(outDir, folderNames[format]) : outDir,
    ])
  );
  const cuesDirs = Object.fromEntries(
    formats.map((format) => [format, path.join(packRoots[format], 'cues')])
  );
  for (const cuesDir of Object.values(cuesDirs)) {
    fs.mkdirSync(cuesDir, { recursive: true });
  }
  const framesRoot = path.join(outDir, '_capture_frames');
  fs.mkdirSync(framesRoot, { recursive: true });

  onProgress({
    phase: 'start',
    message:
      `Baking ${ledItems.length} cue(s) as ${formats
        .map((format) => format.toUpperCase())
        .join(' + ')} at ` +
      `${width}×${height} (deterministic ${fps}fps seek)…`,
    total: ledItems.length,
    done: 0,
  });

  const cuesByFormat = Object.fromEntries(formats.map((format) => [format, {}]));
  const cueOrder = [];
  const captureOpts = { eventId, appUrl, width, height, fps };

  for (let i = 0; i < ledItems.length; i++) {
    const item = ledItems[i];
    const id = String(item.id);
    const label = cueLabel(item);
    onProgress({
      phase: 'cue',
      message: `Capturing and encoding ${i + 1}/${ledItems.length}: ${label}`,
      total: ledItems.length,
      done: i,
      itemId: item.id,
      cueLabel: label,
    });

    // Capture once, then feed the same exact PNG frames to every selected encoder.
    const framesDir = path.join(framesRoot, id);
    const recorded = await recordCueEnter(captureOpts, item, framesDir);
    const lastFrame = path.join(
      framesDir,
      `frame_${String(recorded.frameCount - 1).padStart(4, '0')}.png`
    );

    for (const format of formats) {
      const clipRel = `cues/${id}-enter.${format}`;
      const clipPath = path.join(packRoots[format], clipRel);
      if (format === 'webp') {
        framesToWebp(ffmpeg, framesDir, clipPath, recorded.fps);
      } else if (format === 'webm') {
        framesToWebm(ffmpeg, framesDir, clipPath, recorded.fps);
      } else {
        framesToApng(ffmpeg, framesDir, clipPath, recorded.fps);
      }

      const stillRel = `cues/${id}-enter-last.png`;
      if (fs.existsSync(lastFrame)) {
        fs.copyFileSync(lastFrame, path.join(packRoots[format], stillRel));
      }

      cuesByFormat[format][id] = {
        itemId: Number(item.id),
        cueLabel: label,
        segmentName: item.segmentName || '',
        format,
        files: {
          enter: clipRel,
          last: stillRel,
          hold: null,
          exit: null,
        },
        durationMs: {
          enter: recorded.animMs ?? recorded.durationMs,
          hold: 0,
          exit: 0,
          clip: recorded.durationMs,
          inDelay: recorded.inDelayMs ?? 0,
          in: recorded.inMs ?? 0,
        },
        hasVisibleContent: true,
        playOnce: true,
      };
    }

    fs.rmSync(framesDir, { recursive: true, force: true });
    cueOrder.push(Number(item.id));
  }

  fs.rmSync(framesRoot, { recursive: true, force: true });

  const packPaths = {};
  for (const format of formats) {
    const manifest = {
      version: 3,
      eventId,
      eventName: data.event_name || '',
      exportedAt: new Date().toISOString(),
      canvas: {
        width,
        height,
        fps,
        note: 'Deterministic bakeSeek: fixed fps samples of CSS enter (inDelay+inDuration)',
      },
      background: { mode: 'transparent', color: '#000000' },
      bakeMode: `enter-only-seek-${format}`,
      format,
      cues: cuesByFormat[format],
      cueOrder,
    };
    fs.writeFileSync(
      path.join(packRoots[format], 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
    packPaths[format] = packRoots[format];
  }

  onProgress({
    phase: 'done',
    message:
      `${formats.length} pack${formats.length === 1 ? '' : 's'} ready — ` +
      `${cueOrder.length} cues each`,
    total: ledItems.length,
    done: ledItems.length,
    outDir,
  });

  return {
    ok: true,
    // Select first format for immediate Offline mode; all pack paths are returned.
    outDir: packRoots[formats[0]],
    rootOutDir: outDir,
    packPaths,
    eventId,
    eventName: data.event_name || '',
    formats,
    cueCount: cueOrder.length,
    manifestPath: path.join(packRoots[formats[0]], 'manifest.json'),
  };
}

module.exports = {
  bakeLedPrerenderPack,
  hasLedContent,
  cueLabel,
  ensureFfmpeg,
};
