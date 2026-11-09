const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const offlineShow = require('./offline-show');
const weblinked = require('./weblinked');
const systemHealth = require('./system-health');
const { loadSessionConfig, saveSessionConfig } = require('./session-store');
const {
  planSession,
  sessionIsActive,
  formatRemaining,
  clampLiveHours,
} = require('./session-schedule');
const { injectRemoteWebrtcCodecShim } = require('./remote-webrtc-codec-shim');

const userDataRoot = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  'ros-offline-kiosk-v2'
);
fs.mkdirSync(userDataRoot, { recursive: true });
app.setPath('userData', userDataRoot);

// Quiet AMD / DirectComposition GL errors in Electron (kiosk + display popup).
// Must be set before app ready.
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('disable-features', 'DirectComposition');

let mainWindow = null;
/** Embedded RemoteOp page (VDO / Meshcast) inside the kiosk window. */
let remoteView = null;
let remoteVisible = false;
/** Preview browser windows keyed by display id (max 8). */
const displayPopups = new Map();
let sessionExpireTimer = null;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function getSessionState(cfg = loadSessionConfig()) {
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
    await offlineShow.stopOfflineShow();
  } catch {
    /* ignore */
  }
  try {
    await weblinked.stopWebLinked();
  } catch {
    /* ignore */
  }
  const cfg = saveSessionConfig({
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
  return payload;
}

function armSessionTimer(endsAtIso) {
  clearSessionTimer();
  const endsMs = Date.parse(String(endsAtIso || ''));
  if (!Number.isFinite(endsMs)) return;
  const delay = Math.max(0, endsMs - Date.now());
  sessionExpireTimer = setTimeout(() => {
    void endSession('Session time is up — Offline Show stopped');
  }, delay);
}

function requireActiveSession() {
  const state = getSessionState();
  if (state.active) return null;
  return {
    ok: false,
    error: 'Choose how long you need Offline Show first (Testing, Live Event, or Everyday).',
  };
}

function destroyRemoteView() {
  if (!remoteView) return;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeBrowserView(remoteView);
    }
  } catch {
    /* ignore */
  }
  try {
    remoteView.webContents.destroy();
  } catch {
    /* ignore */
  }
  remoteView = null;
  remoteVisible = false;
}

function ensureRemoteView() {
  if (remoteView) return remoteView;
  remoteView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  remoteView.setBackgroundColor('#000000');
  // Meshcast Go Live can throw on bare "H264" codec prefs in Electron Chromium.
  injectRemoteWebrtcCodecShim(remoteView.webContents);
  return remoteView;
}

function applyRemoteBounds(bounds) {
  if (!remoteView || !mainWindow || mainWindow.isDestroyed()) return;
  const x = Math.max(0, Math.round(bounds?.x || 0));
  const y = Math.max(0, Math.round(bounds?.y || 0));
  const width = Math.max(1, Math.round(bounds?.width || 1));
  const height = Math.max(1, Math.round(bounds?.height || 1));
  remoteView.setBounds({ x, y, width, height });
  remoteView.setAutoResize({ width: true, height: true });
}

function showRemoteView(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
  const view = ensureRemoteView();
  const attached = mainWindow.getBrowserViews().includes(view);
  if (!attached) mainWindow.addBrowserView(view);
  applyRemoteBounds(bounds);
  remoteVisible = true;
  return { ok: true };
}

function hideRemoteView() {
  if (!remoteView || !mainWindow || mainWindow.isDestroyed()) {
    remoteVisible = false;
    return { ok: true };
  }
  mainWindow.removeBrowserView(remoteView);
  remoteVisible = false;
  return { ok: true };
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  try {
    mainWindow.moveTop();
  } catch {
    /* ignore */
  }
}

/** WebLinked / CEF can steal focus after spawn — reclaim the kiosk shortly after. */
function reclaimKioskFocus() {
  focusMainWindow();
  setTimeout(focusMainWindow, 400);
  setTimeout(focusMainWindow, 1200);
}

function closeDisplayPopup(id) {
  if (id == null) {
    for (const key of [...displayPopups.keys()]) closeDisplayPopup(key);
    return { ok: true };
  }
  const win = displayPopups.get(id);
  if (!win || win.isDestroyed()) {
    displayPopups.delete(id);
    return { ok: true };
  }
  try {
    win.close();
  } catch {
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
  }
  displayPopups.delete(id);
  return { ok: true };
}

async function openDisplayPopup({ id, url, title } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'invalid-url' };
  }
  const key = id || 'default';
  let win = displayPopups.get(key);

  if (win && !win.isDestroyed()) {
    win.setTitle(title || 'Display');
    await win.loadURL(url);
    win.show();
    win.focus();
    return { ok: true, reused: true, url, id: key };
  }

  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 480,
    backgroundColor: '#000000',
    title: title || 'Display',
    autoHideMenuBar: true,
    show: false,
    parent: mainWindow || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  displayPopups.set(key, win);
  win.on('closed', () => {
    displayPopups.delete(key);
  });

  await win.loadURL(url);
  win.show();
  win.focus();
  return { ok: true, reused: false, url, id: key };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b1220',
    title: 'SINOR Track · Offline Kiosk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    destroyRemoteView();
    closeDisplayPopup();
    mainWindow = null;
  });
  mainWindow.on('resize', () => {
    /* Renderer ResizeObserver pushes fresh bounds while embed is open. */
  });
}

app.whenReady().then(() => {
  // VDO / Meshcast need camera + mic inside the embed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow =
      permission === 'media' || permission === 'display-capture' || permission === 'mediaKeySystem';
    callback(allow);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'display-capture' || permission === 'mediaKeySystem';
  });

  createWindow();
  const existing = getSessionState();
  if (existing.active) armSessionTimer(existing.endsAt);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  clearSessionTimer();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('kiosk:getBootstrap', async () => {
  const status = await offlineShow.getStatus();
  return {
    offlineShowUrl: offlineShow.OFFLINE_SHOW_URL,
    offlineShowRunning: status.running,
    outputsEngine: 'weblinked',
    version: '0.1.0-offline-events',
  };
});

ipcMain.handle('kiosk:getSystemHealth', async () => {
  try {
    return await systemHealth.getSystemHealth();
  } catch (e) {
    return {
      ok: false,
      level: 'warn',
      label: 'Unavailable',
      tips: [e instanceof Error ? e.message : 'Could not read system health'],
      error: e instanceof Error ? e.message : 'System health failed',
    };
  }
});

ipcMain.handle('kiosk:weblinkedStatus', async () => {
  try {
    return await weblinked.getStatus();
  } catch (e) {
    return {
      ok: false,
      running: false,
      error: e instanceof Error ? e.message : 'WebLinked status failed',
    };
  }
});

ipcMain.handle('kiosk:startWebLinked', async (_evt, payload) => {
  try {
    const result = await weblinked.startWebLinked({ force: Boolean(payload?.force) });
    reclaimKioskFocus();
    return result;
  } catch (e) {
    reclaimKioskFocus();
    return {
      ok: false,
      running: false,
      error: e instanceof Error ? e.message : 'WebLinked start failed',
    };
  }
});

ipcMain.handle('kiosk:stopWebLinked', async () => {
  try {
    const result = await weblinked.stopWebLinked();
    reclaimKioskFocus();
    return result;
  } catch (e) {
    reclaimKioskFocus();
    return {
      ok: false,
      running: false,
      error: e instanceof Error ? e.message : 'WebLinked stop failed',
    };
  }
});

ipcMain.handle('kiosk:offlineShowStatus', async () => offlineShow.getStatus());

ipcMain.handle('kiosk:pptBridgeStatus', async (_evt, payload) => {
  try {
    return await offlineShow.getPptBridgeStatus(payload?.eventId);
  } catch (e) {
    return {
      ok: false,
      online: false,
      error: e instanceof Error ? e.message : 'PPT Bridge status failed',
    };
  }
});

ipcMain.handle('kiosk:getSession', () => getSessionState());
ipcMain.handle('kiosk:startSession', (_evt, partial) => {
  const plan = planSession({
    mode: partial?.mode,
    hours: partial?.hours,
  });
  if (!plan.ok) return { ok: false, error: plan.error };
  const cfg = saveSessionConfig({
    sessionMode: plan.mode,
    sessionHours: plan.hours != null ? plan.hours : loadSessionConfig().sessionHours,
    sessionEndsAt: plan.endsAt.toISOString(),
    sessionLabel: plan.label,
  });
  armSessionTimer(cfg.sessionEndsAt);
  const state = { ok: true, ...getSessionState(cfg) };
  sendToRenderer('session:status', state);
  return state;
});
ipcMain.handle('kiosk:endSession', () => endSession('Session cleared'));

ipcMain.handle('kiosk:startOfflineShow', async () => {
  const blocked = requireActiveSession();
  if (blocked) return blocked;
  return offlineShow.startOfflineShow();
});

ipcMain.handle('kiosk:stopOfflineShow', async () => offlineShow.stopOfflineShow());

ipcMain.handle('kiosk:listEvents', async () => {
  try {
    return await offlineShow.prepareEvents({ preferCloud: true, sync: true });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to list events',
      events: [],
    };
  }
});

ipcMain.handle('kiosk:getConnectivity', async () => {
  try {
    const connectivity = await offlineShow.getConnectivity();
    return { ok: true, connectivity };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Connectivity failed' };
  }
});

ipcMain.handle('kiosk:setCloudMode', async (_evt, payload) => {
  try {
    const cloudMode = await offlineShow.setCloudMode(payload?.mode);
    return { ok: true, cloudMode };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Cloud mode failed' };
  }
});

ipcMain.handle('kiosk:saveRailwayToken', async (_evt, payload) => {
  try {
    const token = await offlineShow.saveRailwayToken(payload?.token);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Token save failed' };
  }
});

ipcMain.handle('kiosk:clearRailwayToken', async () => {
  try {
    const token = await offlineShow.clearRailwayToken();
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Token clear failed' };
  }
});

ipcMain.handle('kiosk:syncFromCloud', async () => {
  try {
    const syncResult = await offlineShow.syncFromCloud();
    const events = await offlineShow.listEvents();
    return { ok: true, syncResult, events };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sync failed', events: [] };
  }
});

ipcMain.handle('kiosk:openDisplayPreview', async (_evt, payload) => {
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  const title = typeof payload?.name === 'string' && payload.name ? payload.name : 'Display preview';
  const id = payload?.id || 'default';
  try {
    return await openDisplayPopup({ id, url, title });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Preview failed' };
  }
});

ipcMain.handle('kiosk:closeDisplayPreview', async (_evt, payload) =>
  closeDisplayPopup(payload?.id)
);

ipcMain.handle('kiosk:weblinkedGetState', async () => {
  try {
    return await weblinked.getEngineState();
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to read WebLinked state',
    };
  }
});

ipcMain.handle('kiosk:weblinkedApplySimpleSettings', async (_evt, payload) => {
  try {
    const result = await weblinked.applySimpleSettings(payload || {});
    reclaimKioskFocus();
    return result;
  } catch (e) {
    reclaimKioskFocus();
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to apply WebLinked settings',
    };
  }
});

ipcMain.handle('kiosk:weblinkedGetPreviewFrame', async (_evt, payload) => {
  try {
    return await weblinked.getPreviewFrame({
      source: payload?.source || payload?.id || null,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to read preview frame',
    };
  }
});

ipcMain.handle('kiosk:weblinkedSendInput', async (_evt, payload) => {
  try {
    return await weblinked.sendInput(payload || {});
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to send input',
    };
  }
});

ipcMain.handle('kiosk:setOutputArmed', async (_evt, payload) => {
  const armed = Boolean(payload?.armed);
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  const source = payload?.source || payload?.id || null;

  if (!armed) {
    const cleared = await weblinked.clearUrl({ source });
    reclaimKioskFocus();
    return {
      ok: cleared.ok,
      armed: false,
      id: payload?.id || null,
      source,
      weblinked: cleared,
      error: cleared.ok ? undefined : cleared.error,
    };
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Enter a valid http(s) URL before pushing to WebLinked.' };
  }

  const set = await weblinked.setUrl(url, { source });
  reclaimKioskFocus();
  return {
    ok: set.ok,
    armed: set.ok,
    id: payload?.id || null,
    source,
    url,
    skipped: Boolean(set.skipped),
    weblinked: set,
    error: set.ok ? undefined : set.error,
  };
});

ipcMain.handle('kiosk:setCameraMode', async (_evt, payload) => ({
  ok: true,
  ...payload,
}));

ipcMain.handle('kiosk:remoteEmbedOpen', async (_evt, payload) => {
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'invalid-url' };
  }
  const view = ensureRemoteView();
  const shown = showRemoteView(payload?.bounds || { x: 0, y: 120, width: 1000, height: 600 });
  if (!shown.ok) return shown;
  await view.webContents.loadURL(url);
  return { ok: true, url, provider: payload?.provider || null };
});

ipcMain.handle('kiosk:remoteEmbedBounds', async (_evt, bounds) => {
  if (!remoteVisible || !remoteView) return { ok: true, skipped: true };
  applyRemoteBounds(bounds);
  return { ok: true };
});

ipcMain.handle('kiosk:remoteEmbedHide', async () => hideRemoteView());

ipcMain.handle('kiosk:remoteEmbedClose', async () => {
  destroyRemoteView();
  return { ok: true };
});

ipcMain.handle('kiosk:remoteEmbedShow', async (_evt, bounds) => showRemoteView(bounds || {}));
