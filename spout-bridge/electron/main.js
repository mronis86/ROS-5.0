const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { installApiAuth } = require('./auth-session');
const { OutputManager } = require('./output-manager');
const { resolveDllPath } = require('./spout-sender');

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
    height: 720,
    minWidth: 420,
    minHeight: 600,
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
