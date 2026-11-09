const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config-store');
const { BridgeController } = require('./bridge-controller');
const { PlaybackController } = require('./playback-controller');
const { MeetingHubController } = require('./meeting-hub-controller');
const { validateApi, listCalendarEvents } = require('./railway-client');
const {
  planSession,
  sessionIsActive,
  formatRemaining,
  clampLiveHours,
} = require('./session-schedule');
const ppt = require('./ppt-com');
const liveCapture = require('./live-capture');

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
const cacheRoot = path.join(userDataRoot, 'powerpoint-cache');

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bridge:status', status);
  }
}

function sendLiveCapture(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('live-capture:status', status);
  }
}

const follow = new BridgeController({ onStatus: sendStatus });
const playback = new PlaybackController({ onStatus: sendStatus, cacheRoot });
const meetingHub = new MeetingHubController();

let sessionExpireTimer = null;

function activeController(mode) {
  if (mode === 'playback') return playback;
  if (mode === 'meetinghub') return meetingHub;
  return follow;
}

function sendSession(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:status', payload);
  }
}

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

function stopAllBridgeWork() {
  follow.stop();
  playback.stop();
  void liveCapture.stop({ silent: true });
}

function endSession(reason) {
  clearSessionTimer();
  stopAllBridgeWork();
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
  sendSession(payload);
  sendStatus({
    ...activeController(cfg.bridgeMode).status,
    message: 'Stopped — session ended',
    error: reason || 'Session ended',
  });
  return payload;
}

function armSessionTimer(endsAtIso) {
  clearSessionTimer();
  const endsMs = Date.parse(String(endsAtIso || ''));
  if (!Number.isFinite(endsMs)) return;
  const delay = Math.max(0, endsMs - Date.now());
  sessionExpireTimer = setTimeout(() => {
    endSession('Session time is up — bridge disconnected');
  }, delay);
}

function requireActiveSession() {
  const state = getSessionState();
  if (state.active) return null;
  return { ok: false, error: 'Choose how long you need the bridge first (Testing, Live Event, or Everyday).' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 1020,
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

app.whenReady().then(() => {
  liveCapture.init({ onStatus: sendLiveCapture });
  try {
    const cfg = loadConfig();
    ppt.setOptions({
      focusTarget: cfg.focusTarget,
      forceEditMode: cfg.forceEditMode,
    });
  } catch {
    /* ignore */
  }
  createWindow();
  const existing = getSessionState();
  if (existing.active) armSessionTimer(existing.endsAt);
});
app.on('window-all-closed', () => {
  clearSessionTimer();
  follow.stop();
  playback.stop();
  void liveCapture.stop({ silent: true });
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  clearSessionTimer();
  void liveCapture.stop({ silent: true });
});

ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_e, partial) => {
  const next = saveConfig(partial || {});
  if (playback.running) playback.config = { ...playback.config, ...next };
  if (follow.running) follow.config = { ...follow.config, ...next };
  try {
    ppt.setOptions({
      focusTarget: next.focusTarget,
      forceEditMode: next.forceEditMode,
    });
  } catch {
    /* ignore */
  }
  return next;
});
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
  const blocked = requireActiveSession();
  if (blocked) throw new Error(blocked.error);
  follow.stop();
  playback.stop();
  return follow.captureStills(loadConfig());
});
ipcMain.handle('session:get', () => getSessionState());
ipcMain.handle('session:start', (_e, partial) => {
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
  sendSession(state);
  return state;
});
ipcMain.handle('session:end', () => endSession('Session cleared'));
ipcMain.handle('bridge:start', (_e, partial) => {
  const blocked = requireActiveSession();
  if (blocked) return blocked;
  const cfg = saveConfig(partial || {});
  if (cfg.bridgeMode === 'playback') {
    follow.stop();
    playback.start(cfg);
  } else if (cfg.bridgeMode === 'meetinghub') {
    follow.stop();
    playback.stop();
    meetingHub.config = cfg;
  } else {
    playback.stop();
    follow.start(cfg);
  }
  return { ok: true, mode: cfg.bridgeMode || 'follow' };
});
ipcMain.handle('bridge:stop', () => {
  follow.stop();
  playback.stop();
  return { ok: true };
});
ipcMain.handle('bridge:status', () => {
  const mode = loadConfig().bridgeMode;
  return activeController(mode).status;
});
ipcMain.handle('playback:sync', async (_e, partial) => {
  const cfg = saveConfig(partial || {});
  return playback.syncNow(cfg);
});
ipcMain.handle('playback:pick-folder', async () => {
  const current = loadConfig();
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'ROS PPT Launcher sync folder',
    defaultPath: current.syncFolder || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return current;
  return saveConfig({ syncFolder: picked.filePaths[0] });
});
ipcMain.handle('meetinghub:list', async (_e, partial) => {
  const blocked = requireActiveSession();
  if (blocked) throw new Error(blocked.error);
  const cfg = saveConfig(partial || {});
  follow.stop();
  playback.stop();
  const status = await meetingHub.listDecks(cfg);
  sendStatus(status);
  return status;
});
ipcMain.handle('meetinghub:open', async (_e, payload) => {
  const blocked = requireActiveSession();
  if (blocked) throw new Error(blocked.error);
  const partial = payload?.config || payload || {};
  const deckId = payload?.deckId || partial.deckId;
  const cfg = saveConfig(partial);
  follow.stop();
  playback.stop();
  try {
    const status = await meetingHub.openDeckById(deckId, cfg);
    sendStatus(status);
    return status;
  } catch (err) {
    const status = {
      ...meetingHub.status,
      error: err.message || String(err),
      lastAction: 'Open failed',
    };
    sendStatus(status);
    throw err;
  }
});
ipcMain.handle('live-capture:start', (_e, partial) => {
  const blocked = requireActiveSession();
  if (blocked) return Promise.reject(new Error(blocked.error));
  return liveCapture.start(partial || {});
});
ipcMain.handle('live-capture:stop', () => liveCapture.stop());
ipcMain.handle('live-capture:status', () => liveCapture.getState());
