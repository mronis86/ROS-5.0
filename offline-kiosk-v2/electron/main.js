const { app, BrowserWindow, BrowserView, ipcMain, session, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
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

/** Keep display awake (Electron powerSaveBlocker + optional 1px mouse nudge). */
let powerSaveId = null;
let mouseJiggleTimer = null;

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
  // Keep Meshcast/VDO popups inside this embed instead of spawning loose windows.
  remoteView.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      void remoteView.webContents.loadURL(url);
    }
    return { action: 'deny' };
  });
  return remoteView;
}

function applyRemoteBounds(bounds) {
  if (!remoteView || !mainWindow || mainWindow.isDestroyed()) return;
  // BrowserView is a native layer — CSS overflow cannot clip it. Floor + clamp
  // hard against content size so Meshcast/VDO never paints past the window.
  // Prefer getContentBounds size (DIP) which matches getBoundingClientRect space.
  const contentBounds = mainWindow.getContentBounds();
  const maxW = Math.max(1, Math.floor(contentBounds.width || 1));
  const maxH = Math.max(1, Math.floor(contentBounds.height || 1));
  let x = Math.max(0, Math.floor(Number(bounds?.x) || 0));
  let y = Math.max(0, Math.floor(Number(bounds?.y) || 0));
  let width = Math.max(1, Math.floor(Number(bounds?.width) || 1));
  let height = Math.max(1, Math.floor(Number(bounds?.height) || 1));
  // Keep a visible gutter inside the window (DPI 1.25 was still kissing the edge).
  const edgePad = 8;
  if (x < edgePad) {
    width -= edgePad - x;
    x = edgePad;
  }
  if (y < edgePad) {
    height -= edgePad - y;
    y = edgePad;
  }
  if (x >= maxW) x = Math.max(0, maxW - 1);
  if (y >= maxH) y = Math.max(0, maxH - 1);
  if (x + width > maxW - edgePad) width = Math.max(1, maxW - edgePad - x);
  if (y + height > maxH - edgePad) height = Math.max(1, maxH - edgePad - y);
  remoteView.setBounds({ x, y, width, height });
  // Renderer ResizeObserver pushes exact host bounds — do not auto-grow with the window.
  remoteView.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
}

/** Re-read #remoteEmbedHost from the renderer so bounds match the laid-out host. */
async function syncRemoteBoundsFromDom() {
  if (!remoteVisible || !remoteView || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const rect = await mainWindow.webContents.executeJavaScript(`(() => {
      const el = document.getElementById('remoteEmbedHost');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        iw: window.innerWidth,
        ih: window.innerHeight
      };
    })()`);
    if (!rect) return;
    applyRemoteBounds(rect);
  } catch {
    /* ignore */
  }
}

function showRemoteView(bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no-window' };
  const view = ensureRemoteView();
  const attached = mainWindow.getBrowserViews().includes(view);
  if (!attached) mainWindow.addBrowserView(view);
  applyRemoteBounds(bounds);
  remoteVisible = true;
  // Second pass after layout / DPI settle.
  setTimeout(() => {
    void syncRemoteBoundsFromDom();
  }, 50);
  setTimeout(() => {
    void syncRemoteBoundsFromDom();
  }, 250);
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
      // RemoteOp Meshcast/VDO uses <webview> so CSS can clip it inside the panel.
      webviewTag: true,
    },
  });

  // Guest page for RemoteOp — codec shim + keep popups inside the webview.
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    injectRemoteWebrtcCodecShim(guest);
    guest.setWindowOpenHandler(({ url }) => {
      if (url && /^https?:\/\//i.test(url)) {
        void guest.loadURL(url);
      }
      return { action: 'deny' };
    });
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    destroyRemoteView();
    closeDisplayPopup();
    mainWindow = null;
  });
}

function allowMediaPermission(_wc, permission, callback) {
  const allow =
    permission === 'media' || permission === 'display-capture' || permission === 'mediaKeySystem';
  if (typeof callback === 'function') callback(allow);
  return allow;
}

function startKeepAwake() {
  try {
    if (powerSaveId == null || !powerSaveBlocker.isStarted(powerSaveId)) {
      // prevent-display-sleep maps to SetThreadExecutionState(ES_DISPLAY_REQUIRED) on Windows.
      powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
    }
  } catch (err) {
    console.warn('[kiosk] powerSaveBlocker failed', err?.message || err);
  }
  if (process.platform !== 'win32') return;
  if (mouseJiggleTimer) return;
  // GitHub-style StayActive nudge: ±1px cursor move resets idle/display sleep timers
  // when Group Policy ignores execution-state flags.
  const jigglePs = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$p=[System.Windows.Forms.Cursor]::Position;",
    "[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(($p.X+1),$p.Y);",
    "Start-Sleep -Milliseconds 40;",
    "[System.Windows.Forms.Cursor]::Position=$p;",
  ].join(' ');
  const runJiggle = () => {
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', jigglePs],
        { windowsHide: true, stdio: 'ignore' }
      );
      child.unref();
    } catch {
      /* ignore */
    }
  };
  mouseJiggleTimer = setInterval(runJiggle, 55_000);
  if (typeof mouseJiggleTimer.unref === 'function') mouseJiggleTimer.unref();
  setTimeout(runJiggle, 8_000);
}

function stopKeepAwake() {
  if (mouseJiggleTimer) {
    clearInterval(mouseJiggleTimer);
    mouseJiggleTimer = null;
  }
  try {
    if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }
  } catch {
    /* ignore */
  }
  powerSaveId = null;
}

app.whenReady().then(() => {
  // VDO / Meshcast need camera + mic inside the embed (default + remoteop partition).
  session.defaultSession.setPermissionRequestHandler(allowMediaPermission);
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    allowMediaPermission(null, permission)
  );
  const remoteSession = session.fromPartition('persist:remoteop');
  remoteSession.setPermissionRequestHandler(allowMediaPermission);
  remoteSession.setPermissionCheckHandler((_wc, permission) =>
    allowMediaPermission(null, permission)
  );

  startKeepAwake();
  createWindow();
  const existing = getSessionState();
  if (existing.active) armSessionTimer(existing.endsAt);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let shuttingDown = false;

/**
 * Stop WebLinked + Offline Show + popups so closing the kiosk releases file locks
 * (otherwise sinor-weblinked / node keep the install folder locked until reboot).
 */
async function shutdownKiosk(reason = 'shutdown') {
  stopKeepAwake();
  clearSessionTimer();
  destroyRemoteView();
  try {
    closeDisplayPopup();
  } catch {
    /* ignore */
  }
  // Force-kill engines first (unref'd WebLinked / orphaned Offline Show node).
  try {
    await weblinked.stopWebLinked();
  } catch {
    /* ignore */
  }
  try {
    await offlineShow.stopOfflineShow({ force: true });
  } catch {
    /* ignore */
  }
  try {
    saveSessionConfig({
      sessionMode: '',
      sessionEndsAt: '',
      sessionLabel: '',
    });
  } catch {
    /* ignore */
  }
  return { ok: true, reason };
}

app.on('window-all-closed', () => {
  clearSessionTimer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void shutdownKiosk('window-closed')
    .catch(() => {})
    .finally(() => {
      try {
        app.exit(0);
      } catch {
        process.exit(0);
      }
    });
});

ipcMain.handle('kiosk:getBootstrap', async () => {
  const status = await offlineShow.getStatus();
  return {
    offlineShowUrl: offlineShow.OFFLINE_SHOW_URL,
    offlineShowRunning: status.running,
    outputsEngine: 'weblinked',
    version: '0.1.0-offline-events',
    token: status.token || offlineShow.getStoredTokenStatus(),
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

ipcMain.handle('kiosk:weblinkedDiagnostics', async () => {
  try {
    const status = await weblinked.getStatus();
    const log = weblinked.getWebLinkedLog();
    return {
      ok: true,
      status,
      diagnostics: weblinked.collectDiagnostics(),
      log,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'WebLinked diagnostics failed',
    };
  }
});

ipcMain.handle('kiosk:listSystemDisplays', async () => {
  try {
    const primaryId = screen.getPrimaryDisplay()?.id;
    const displays = screen.getAllDisplays().map((d, index) => {
      const w = d.bounds?.width || 0;
      const h = d.bounds?.height || 0;
      const primary = d.id === primaryId;
      return {
        index,
        id: d.id,
        primary,
        width: w,
        height: h,
        scaleFactor: d.scaleFactor || 1,
        internal: Boolean(d.internal),
        label: `Display ${index + 1} · ${w}×${h}${primary ? ' · primary' : ''}`,
      };
    });
    return { ok: true, displays, primaryId };
  } catch (e) {
    return {
      ok: false,
      displays: [],
      error: e instanceof Error ? e.message : 'Could not list displays',
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

ipcMain.handle('kiosk:vmixBridgeStatus', async (_evt, payload) => {
  try {
    return await offlineShow.getVmixBridgeStatus(payload?.eventId);
  } catch (e) {
    return {
      ok: false,
      online: false,
      error: e instanceof Error ? e.message : 'vMix Bridge status failed',
    };
  }
});

ipcMain.handle('kiosk:listDisplayClients', async (_evt, payload) => {
  try {
    return await offlineShow.listDisplayClients({ kind: payload?.kind || 'green-room' });
  } catch (e) {
    return {
      ok: false,
      clients: [],
      error: e instanceof Error ? e.message : 'Display clients list failed',
    };
  }
});

ipcMain.handle('kiosk:commandDisplayClient', async (_evt, payload) => {
  try {
    return await offlineShow.commandDisplayClient(payload?.clientId, {
      action: payload?.action || 'start',
      eventId: payload?.eventId,
      url: payload?.url,
      page: payload?.page || 'green-room',
      message: payload?.message,
      durationHours: payload?.durationHours,
      day: payload?.day,
      eventName: payload?.eventName,
      eventDate: payload?.eventDate,
      fullscreen: payload?.fullscreen,
      displayIndex: payload?.displayIndex,
      display: payload?.display,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Display client command failed',
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

ipcMain.handle('kiosk:stopOfflineShow', async () => offlineShow.stopOfflineShow({ force: true }));

ipcMain.handle('kiosk:shutdown', async (_evt, payload) => {
  const reason = typeof payload?.reason === 'string' ? payload.reason : 'operator-shutdown';
  shuttingDown = true;
  const result = await shutdownKiosk(reason);
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {
      process.exit(0);
    }
  }, 150);
  return result;
});

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

ipcMain.handle('kiosk:weblinkedExecuteScript', async (_evt, payload) => {
  try {
    return await weblinked.executeScript(payload?.script || payload?.js || '', {
      source: payload?.source || payload?.id || null,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to run WebLinked script',
    };
  }
});

ipcMain.handle('kiosk:weblinkedRemoveOrphans', async (_evt, payload) => {
  try {
    const result = await weblinked.removeOrphanSources({
      keepIds: Array.isArray(payload?.keepIds) ? payload.keepIds : [],
    });
    reclaimKioskFocus();
    return result;
  } catch (e) {
    reclaimKioskFocus();
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to remove orphan WebLinked sources',
      removed: [],
    };
  }
});

ipcMain.handle('kiosk:setOutputArmed', async (_evt, payload) => {
  const armed = Boolean(payload?.armed);
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  const source = payload?.source || payload?.id || null;

  if (!armed) {
    // Full disable: tear down NDI/outputs + remove source (not just about:blank).
    const cleared = await weblinked.disableDisplaySource(source);
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

  // Force reload when operator Push / re-arm so stale event-… URLs are replaced
  // after syncPresetDisplayUrls switches to calendar UUID.
  const set = await weblinked.setUrl(url, {
    source,
    force: Boolean(payload?.force) || Boolean(payload?.reload),
  });
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

// RemoteOp now uses an in-page <webview> (CSS-clipped). Keep these IPC stubs so
 // older renderer calls stay harmless; destroy any leftover BrowserView.
ipcMain.handle('kiosk:remoteEmbedOpen', async (_evt, payload) => {
  destroyRemoteView();
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'invalid-url' };
  }
  return { ok: true, url, provider: payload?.provider || null, mode: 'webview' };
});

ipcMain.handle('kiosk:remoteEmbedBounds', async () => ({ ok: true, skipped: true }));

ipcMain.handle('kiosk:remoteEmbedHide', async () => {
  destroyRemoteView();
  return { ok: true };
});

ipcMain.handle('kiosk:remoteEmbedClose', async () => {
  destroyRemoteView();
  return { ok: true };
});

ipcMain.handle('kiosk:remoteEmbedShow', async () => {
  destroyRemoteView();
  return { ok: true };
});
