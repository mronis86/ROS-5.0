const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { BridgeController } = require('./bridge-controller');

const userDataRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ros-civics-bridge-v2');
fs.mkdirSync(userDataRoot, { recursive: true });
app.setPath('userData', userDataRoot);
app.disableHardwareAcceleration();

let mainWindow = null;
const bridge = new BridgeController({
  onStatus: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:status', status);
  },
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 640,
    title: 'Civics Bridge V2',
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

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_e, cfg) => saveConfig(cfg || {}));
ipcMain.handle('bridge:start', () => {
  bridge.start(loadConfig());
  return { ok: true };
});
ipcMain.handle('bridge:stop', () => {
  bridge.stop();
  return { ok: true };
});
ipcMain.handle('dialog:pickFolder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const options = { title: 'Folder Companion imports pictures from', properties: ['openDirectory', 'createDirectory'] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths?.[0]) return '';
  return result.filePaths[0];
});
