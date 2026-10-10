const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { BridgeController, vmix } = require('./bridge-controller');

const userDataRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ros-civics-vmix');
fs.mkdirSync(userDataRoot, { recursive: true });
app.setPath('userData', userDataRoot);

if (__dirname.toLowerCase().includes('onedrive') || process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

let mainWindow = null;
let powerSaveId = null;
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
    height: 920,
    minWidth: 680,
    minHeight: 560,
    title: 'ROS Civics vMix Bridge',
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

app.whenReady().then(() => {
  createWindow();
  if (powerSaveId == null) {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  }
});

app.on('window-all-closed', () => {
  bridge.stop();
  if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_e, cfg) => saveConfig(cfg || {}));
ipcMain.handle('bridge:start', () => {
  const cfg = loadConfig();
  bridge.start(cfg);
  return { ok: true };
});
ipcMain.handle('bridge:stop', () => {
  bridge.stop();
  return { ok: true };
});
ipcMain.handle('bridge:testVmix', async () => {
  const cfg = loadConfig();
  return vmix.testConnection(cfg.vmixHost, cfg.vmixPort);
});
ipcMain.handle('bridge:resync', async () => {
  bridge.lastKey = '';
  try {
    await bridge.pollOnce();
    return { ok: true, message: bridge.lastOk, url: bridge.lastVmixUrl };
  } catch (err) {
    return { ok: false, message: err.message || String(err), url: err.url || bridge.lastVmixUrl };
  }
});
ipcMain.handle('bridge:testSelect', async (_e, bindingId) => {
  try {
    const result = await bridge.testSelectBinding(bindingId);
    return { ok: true, message: bridge.lastOk, url: result.url, value: result.value };
  } catch (err) {
    return { ok: false, message: err.message || String(err), url: err.url, tried: err.tried };
  }
});
ipcMain.handle('bridge:listDataSources', async () => {
  const cfg = loadConfig();
  return vmix.listDataSources(cfg.vmixHost, cfg.vmixPort);
});
