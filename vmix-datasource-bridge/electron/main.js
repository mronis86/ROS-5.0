const { app, BrowserWindow, ipcMain, session, powerSaveBlocker, dialog } = require('electron');
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
const {
  planSession,
  sessionIsActive,
  formatRemaining,
  clampLiveHours,
} = require('./session-schedule');

const userDataRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ros-vmix-datasource');
const chromiumCacheDir = path.join(userDataRoot, 'chromium-cache');
fs.mkdirSync(chromiumCacheDir, { recursive: true });
app.setPath('userData', userDataRoot);
app.commandLine.appendSwitch('disk-cache-dir', chromiumCacheDir);

// OneDrive / some GPUs leave Electron windows blank without this.
const runningFromOneDrive = __dirname.toLowerCase().includes('onedrive');
if (runningFromOneDrive || process.env.ROS_VMIX_DISABLE_GPU === '1' || process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

let mainWindow = null;
let powerSaveId = null;
let sessionExpireTimer = null;
const bridge = new BridgeController({
  onStatus: (status) => sendToRenderer('bridge:status', status),
});

function getSessionState(cfg = loadConfig()) {
  const endsAt = cfg.sessionEndsAt || '';
  const active = sessionIsActive(endsAt);
  return {
    active,
    mode: cfg.sessionMode || '',
    hours: clampLiveHours(cfg.sessionHours),
    endsAt: active ? endsAt : '',
    label: active ? cfg.sessionLabel || '' : '',
    remaining: active ? formatRemaining(endsAt) : '',
  };
}

function clearSessionTimer() {
  if (sessionExpireTimer) {
    clearTimeout(sessionExpireTimer);
    sessionExpireTimer = null;
  }
}

async function endSession(reason) {
  clearSessionTimer();
  try {
    await bridge.stop();
  } catch {
    /* ignore */
  }
  const cfg = saveConfig({
    sessionMode: '',
    sessionEndsAt: '',
    sessionLabel: '',
  });
  const payload = {
    ...getSessionState(cfg),
    ended: true,
    reason: reason || 'Session ended',
  };
  sendToRenderer('session:status', payload);
  sendToRenderer('bridge:status', bridge.getStatus());
  return payload;
}

function armSessionTimer(endsAtIso) {
  clearSessionTimer();
  const endsMs = Date.parse(String(endsAtIso || ''));
  if (!Number.isFinite(endsMs)) return;
  const delay = Math.max(0, endsMs - Date.now());
  sessionExpireTimer = setTimeout(() => {
    void endSession('Session time is up — bridge disconnected');
  }, delay);
}

function requireActiveSession() {
  const state = getSessionState();
  if (state.active) return null;
  return {
    ok: false,
    error: 'Choose how long you need the bridge first (Testing, Live Event, or Everyday).',
  };
}

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

  const indexHtml = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[vmix-bridge] did-fail-load', { errorCode, errorDescription, validatedURL, indexHtml });
    dialog.showErrorBox(
      'ROS vMix DataSource Bridge',
      `UI failed to load (${errorCode}): ${errorDescription}\n\nExpected:\n${indexHtml}\n\nIf you unzipped a download, keep the whole ros-vmix-datasource-bridge folder together (exe + resources).`
    );
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[vmix-bridge] render-process-gone', details);
  });

  if (!fs.existsSync(indexHtml) && !indexHtml.includes('app.asar')) {
    dialog.showErrorBox(
      'ROS vMix DataSource Bridge',
      `Missing UI file:\n${indexHtml}\n\nReinstall or re-unzip the bridge package.`
    );
  }

  mainWindow.loadFile(indexHtml);
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
  const existing = getSessionState(config);
  if (existing.active) armSessionTimer(existing.endsAt);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  clearSessionTimer();
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

ipcMain.handle('session:get', () => getSessionState());
ipcMain.handle('session:start', (_event, partial) => {
  const plan = planSession({
    mode: partial?.mode,
    hours: partial?.hours,
  });
  if (!plan.ok) return { ok: false, error: plan.error };
  const cfg = saveConfig({
    sessionMode: plan.mode,
    sessionHours: plan.hours != null ? plan.hours : loadConfig().sessionHours,
    sessionEndsAt: plan.endsAt.toISOString(),
    sessionLabel: plan.label,
  });
  armSessionTimer(cfg.sessionEndsAt);
  const state = { ok: true, ...getSessionState(cfg) };
  sendToRenderer('session:status', state);
  return state;
});
ipcMain.handle('session:end', () => endSession('Session cleared'));

ipcMain.handle('bridge:start', async (_event, partial) => {
  const blocked = requireActiveSession();
  if (blocked) return blocked;
  const config = saveConfig(partial || {});
  installApiAuth(session.defaultSession, config.apiBaseUrl, config.apiToken);
  return bridge.start(config);
});

ipcMain.handle('bridge:stop', async () => bridge.stop());

ipcMain.handle('bridge:resync', async () => {
  const blocked = requireActiveSession();
  if (blocked) return blocked;
  return bridge.resync();
});

ipcMain.handle('bridge:status', () => bridge.getStatus());

ipcMain.handle('bridge:cue', async (_event, payload) => {
  const blocked = requireActiveSession();
  if (blocked) return blocked;
  const itemId = payload?.itemId;
  const data = payload?.data || {};
  await bridge.applyCue(itemId, data);
  return { ok: true };
});

ipcMain.on('bridge:socketStatus', (_event, status) => {
  bridge.setSocketStatus(status || {});
});
