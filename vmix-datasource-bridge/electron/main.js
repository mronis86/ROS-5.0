const { app, BrowserWindow, ipcMain, session, powerSaveBlocker } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { installApiAuth } = require('./auth-session');
const {
  BridgeController,
  listCalendarEvents,
  validateApi,
  vmix,
} = require('./bridge-controller');

const userDataRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ros-vmix-datasource');
const chromiumCacheDir = path.join(userDataRoot, 'chromium-cache');
fs.mkdirSync(chromiumCacheDir, { recursive: true });
app.setPath('userData', userDataRoot);
app.commandLine.appendSwitch('disk-cache-dir', chromiumCacheDir);

let mainWindow = null;
let powerSaveId = null;
const bridge = new BridgeController({
  onStatus: (status) => sendToRenderer('bridge:status', status),
});

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'launcher', 'ros-vmix-datasource.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

function createWindow() {
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 800,
    minHeight: 640,
    title: 'ROS vMix DataSource Bridge',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    ...(icon ? { icon } : {}),
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

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(() => {
  const config = loadConfig();
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await bridge.stop();
  if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('config:save', (_event, partial) => {
  const config = saveConfig(partial || {});
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  return config;
});

ipcMain.handle('api:validate', async (_event, partial) => {
  const config = { ...loadConfig(), ...(partial || {}) };
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  return validateApi(config.apiBaseUrl, config.apiToken);
});

ipcMain.handle('api:events', async (_event, partial) => {
  const config = { ...loadConfig(), ...(partial || {}) };
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  try {
    const events = await listCalendarEvents(config.apiBaseUrl, config.apiToken);
    return { ok: true, events };
  } catch (err) {
    return { ok: false, message: err.message || 'Failed to load events', events: [] };
  }
});

ipcMain.handle('vmix:test', async (_event, partial) => {
  const config = { ...loadConfig(), ...(partial || {}) };
  return vmix.testConnection(config.vmixHost, config.vmixPort);
});

ipcMain.handle('vmix:listDataSources', async (_event, partial) => {
  const config = { ...loadConfig(), ...(partial || {}) };
  try {
    const result = await vmix.listDataSources(config.vmixHost, config.vmixPort);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, message: err.message || 'Failed to list Data Sources', names: [] };
  }
});

ipcMain.handle('bridge:start', async (_event, partial) => {
  const config = saveConfig(partial || {});
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  return bridge.start(config);
});

ipcMain.handle('bridge:stop', async () => bridge.stop());

ipcMain.handle('bridge:resync', async () => bridge.resync());

ipcMain.handle('bridge:status', () => bridge.getStatus());
