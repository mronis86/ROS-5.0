const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { installApiAuth, normalizeBaseUrl } = require('./auth-session');
const { OutputManager } = require('./output-manager');
const { resolveDllPath } = require('./spout-sender');
const { loadManifest } = require('./prerender-pack');
const { bakeLedPrerenderPack } = require('./bake-pack');

// Writable paths outside OneDrive — avoids "Unable to move the cache" on Desktop sync folders.
const userDataRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ros-led-spout');
const chromiumCacheDir = path.join(userDataRoot, 'chromium-cache');
fs.mkdirSync(chromiumCacheDir, { recursive: true });
app.setPath('userData', userDataRoot);
app.commandLine.appendSwitch('disk-cache-dir', chromiumCacheDir);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Avoid DPI-scaled offscreen captures (bitmap size mismatch → Spout crash).
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Keep the hidden LED window compositing at full rate (timers, CSS animations).
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let configWindow = null;
const outputManager = new OutputManager();

function createConfigWindow() {
  configWindow = new BrowserWindow({
    width: 520,
    height: 840,
    minWidth: 420,
    minHeight: 640,
    title: 'ROS LED Spout',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

function sendToRenderer(channel, payload) {
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.webContents.send(channel, payload);
  }
}

outputManager.onStatus = (status) => {
  sendToRenderer('output:status', status);
};

app.whenReady().then(() => {
  const config = loadConfig();
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  createConfigWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createConfigWindow();
  });
});

app.on('window-all-closed', async () => {
  await outputManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:load', () => {
  const config = loadConfig();
  return {
    config,
    spoutDll: resolveDllPath(),
  };
});

ipcMain.handle('config:save', (_event, partial) => {
  const config = saveConfig(partial || {});
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  return config;
});

ipcMain.handle('api:validate', async (_event, partial) => {
  const config = { ...loadConfig(), ...(partial || {}) };
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  return outputManager.validateApi(config);
});

ipcMain.handle('output:start', async (_event, partial) => {
  const config = saveConfig(partial || {});
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  try {
    return await outputManager.start(config);
  } catch (err) {
    return { ok: false, message: err.message || 'Start failed' };
  }
});

ipcMain.handle('output:stop', async () => {
  await outputManager.stop();
  return { ok: true };
});

ipcMain.handle('output:status', () => ({
  running: outputManager.running,
  spoutDll: resolveDllPath(),
}));

ipcMain.handle('dialog:pickPrerenderPack', async () => {
  const result = await dialog.showOpenDialog(configWindow || undefined, {
    title: 'Select LED prerender pack folder (must contain manifest.json)',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  const packPath = result.filePaths[0];
  try {
    const { manifest } = loadManifest(packPath);
    const count = Object.keys(manifest.cues || {}).length;
    return {
      ok: true,
      path: packPath,
      eventId: manifest.eventId || '',
      message: `${manifest.eventName || 'Pack'} · ${count} cues`,
    };
  } catch (err) {
    return {
      ok: false,
      path: packPath,
      message:
        `${err.message || 'Invalid pack'}. ` +
        'This folder needs manifest.json + cue animation files — stay in Live mode and click “Bake pack…” first.',
    };
  }
});

ipcMain.handle('dialog:pickBakeOutputFolder', async () => {
  const result = await dialog.showOpenDialog(configWindow || undefined, {
    title: 'Choose folder for new LED prerender pack',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

let bakeBusy = false;

ipcMain.handle('pack:bake', async (_event, partial) => {
  if (bakeBusy) {
    return { ok: false, message: 'Bake already in progress' };
  }
  if (outputManager.running) {
    return {
      ok: false,
      message: 'Stop Spout output before baking (bake needs the capture window free).',
    };
  }

  const config = { ...loadConfig(), ...(partial || {}) };
  const eventId = String(config.eventId || '').trim();
  const token = String(config.apiToken || '').trim();
  const appUrl = normalizeBaseUrl(config.appBaseUrl);
  const apiUrl = normalizeBaseUrl(config.apiBaseUrl);

  if (!eventId || !token || !appUrl || !apiUrl) {
    return {
      ok: false,
      message: 'Fill Event ID, hosted app URL, API URL, and token (Live fields) before baking.',
    };
  }

  const pick = await dialog.showOpenDialog(configWindow || undefined, {
    title: 'Choose folder to save the prerender pack',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: config.prerenderBakeRootPath || config.prerenderPackPath || undefined,
  });
  if (pick.canceled || !pick.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }

  const outDir = path.join(pick.filePaths[0], `led-prerender-${eventId.slice(0, 8)}`);
  // If they already picked a pack-looking folder or prior bake, allow writing into the selected folder directly
  // when it is empty or already has manifest — otherwise nest a subfolder.
  let targetDir = pick.filePaths[0];
  const selected = pick.filePaths[0];
  const hasManifest = fs.existsSync(path.join(selected, 'manifest.json'));
  const entries = fs.existsSync(selected) ? fs.readdirSync(selected) : [];
  if (!hasManifest && entries.length > 0) {
    targetDir = outDir;
  }

  installApiAuth(session.defaultSession, apiUrl, token);
  bakeBusy = true;
  sendToRenderer('pack:bake-progress', { phase: 'start', message: 'Starting bake…' });

  try {
    const result = await bakeLedPrerenderPack({
      eventId,
      token,
      appUrl,
      apiUrl,
      outDir: targetDir,
      width: Number(config.width) || 1920,
      height: Number(config.height) || 1080,
      // Default is 60 Hz/FPS; checkbox opts into the selected FPS field.
      fps: config.useSelectedFps
        ? Math.min(60, Math.max(15, Number(config.fps) || 60))
        : 60,
      formats: Array.isArray(config.bakeFormats)
        ? config.bakeFormats.filter((value) =>
            ['apng', 'webp', 'webm'].includes(String(value).toLowerCase())
          )
        : [config.bakeFormat || 'apng'],
      holdSeconds: 1,
      onProgress: (p) => sendToRenderer('pack:bake-progress', p),
    });

    const next = saveConfig({
      ...config,
      prerenderPackPath: result.outDir,
      prerenderBakeRootPath: result.rootOutDir || result.outDir,
      eventId: result.eventId || eventId,
    });

    sendToRenderer('pack:bake-progress', {
      phase: 'done',
      message: `Saved ${result.cueCount} cues → ${result.outDir}`,
      outDir: result.outDir,
      cueCount: result.cueCount,
    });

    return {
      ok: true,
      ...result,
      config: next,
      message:
        `Baked ${result.cueCount} cues in ${(result.formats || ['apng'])
          .map((value) => String(value).toUpperCase())
          .join(', ')}. ` +
        `Pack folders: ${result.rootOutDir || result.outDir}`,
    };
  } catch (err) {
    sendToRenderer('pack:bake-progress', {
      phase: 'error',
      message: err.message || 'Bake failed',
    });
    return { ok: false, message: err.message || 'Bake failed' };
  } finally {
    bakeBusy = false;
  }
});
