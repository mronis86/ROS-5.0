const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { BridgeController } = require('./bridge-controller');
const { validateApi, listCalendarEvents } = require('./railway-client');
const ppt = require('./ppt-com');

function showCrash(err) {
  const message = err && err.stack ? err.stack : String(err || 'Unknown error');
  console.error('[powerpoint-bridge]', message);
  try {
    dialog.showErrorBox('ROS PowerPoint Bridge crashed', message.slice(0, 1500));
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', showCrash);
process.on('unhandledRejection', showCrash);

const userDataRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ros-powerpoint-bridge');
fs.mkdirSync(userDataRoot, { recursive: true });
app.setPath('userData', userDataRoot);
app.disableHardwareAcceleration();

let mainWindow = null;
const bridge = new BridgeController({
  onStatus: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bridge:status', status);
    }
  },
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 780,
    title: 'ROS PowerPoint Bridge',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  bridge.stop();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_e, partial) => saveConfig(partial || {}));
ipcMain.handle('api:validate', (_e, partial) => {
  const cfg = { ...loadConfig(), ...(partial || {}) };
  return validateApi(cfg.apiBaseUrl, cfg.apiToken);
});
ipcMain.handle('api:events', async (_e, partial) => {
  const cfg = { ...loadConfig(), ...(partial || {}) };
  return listCalendarEvents(cfg.apiBaseUrl, cfg.apiToken);
});
ipcMain.handle('ppt:status', () => ppt.getStatus());
ipcMain.handle('ppt:capture', async () => {
  return bridge.captureStills(loadConfig());
});
ipcMain.handle('bridge:start', (_e, partial) => {
  const cfg = saveConfig(partial || {});
  bridge.start(cfg);
  return { ok: true };
});
ipcMain.handle('bridge:stop', () => {
  bridge.stop();
  return { ok: true };
});
ipcMain.handle('bridge:status', () => bridge.status);
