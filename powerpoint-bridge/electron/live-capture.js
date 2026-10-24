const { BrowserWindow, desktopCapturer } = require('electron');
const { loadConfig, saveConfig } = require('./config-store');
const { reportLiveCapture } = require('./railway-client');
const { ensureRoom, buildPushUrl, buildViewUrl } = require('./vdo-ninja');

const HEARTBEAT_MS = 8000;

let captureWindow = null;
let heartbeat = null;
let onStatus = () => {};
let lastState = {
  active: false,
  source: 'screen',
  viewUrl: '',
  error: '',
};

function getState() {
  return { ...lastState };
}

function emit() {
  try {
    onStatus(getState());
  } catch {
    /* ignore */
  }
}

function setState(partial) {
  lastState = { ...lastState, ...partial };
  emit();
}

function attachPermissions(win) {
  const ses = win.webContents.session;
  const allow = new Set(['media', 'display-capture', 'fullscreen', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allow.has(permission));
  });
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler((_wc, permission) => allow.has(permission));
  }
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const screen = sources.find((s) => String(s.id).startsWith('screen')) || sources[0];
      if (!screen) {
        callback({});
        return;
      }
      callback({
        video: screen,
        audio: request.audioRequested ? 'loopback' : undefined,
      });
    });
  }
}

async function post(active) {
  const cfg = loadConfig();
  if (!cfg.eventId || !cfg.apiBaseUrl || !cfg.apiToken) return;
  await reportLiveCapture(cfg.apiBaseUrl, cfg.apiToken, cfg.eventId, {
    viewUrl: lastState.viewUrl,
    active,
    source: lastState.source,
  });
}

function stopHeartbeat() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    post(true).catch((err) => {
      setState({ error: err.message || String(err) });
    });
  }, HEARTBEAT_MS);
}

async function stop(opts = {}) {
  const silent = opts.silent === true;
  stopHeartbeat();
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.removeAllListeners('closed');
    captureWindow.close();
  }
  captureWindow = null;
  const wasActive = lastState.active;
  setState({ active: false, error: silent ? lastState.error : '' });
  if (wasActive || lastState.viewUrl) {
    try {
      await post(false);
    } catch (err) {
      if (!silent) setState({ error: err.message || String(err) });
    }
  }
}

async function start(partial) {
  const cfg = saveConfig(partial || {});
  if (!cfg.eventId) throw new Error('Pick an event first.');
  if (!cfg.apiBaseUrl || !cfg.apiToken) throw new Error('Save the API URL and token first.');

  const source = String(partial?.liveCaptureSource || cfg.liveCaptureSource || '').toLowerCase() === 'camera'
    ? 'camera'
    : 'screen';
  const { rooms, room } = ensureRoom(cfg.liveCaptureRooms, cfg.eventId);
  saveConfig({ liveCaptureRooms: rooms, liveCaptureSource: source });

  const viewUrl = buildViewUrl(room.streamId, room.password);
  const pushUrl = buildPushUrl(room.streamId, room.password, source);

  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.removeAllListeners('closed');
    captureWindow.close();
    captureWindow = null;
  }

  captureWindow = new BrowserWindow({
    width: 540,
    height: 680,
    title: 'ROS Live Capture',
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachPermissions(captureWindow);
  captureWindow.on('closed', () => {
    captureWindow = null;
    if (lastState.active) {
      void stop({ silent: true });
    }
  });
  try {
    await captureWindow.loadURL(pushUrl);
  } catch (err) {
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.removeAllListeners('closed');
      captureWindow.close();
    }
    captureWindow = null;
    throw err;
  }

  setState({ active: true, source, viewUrl, error: '' });
  try {
    await post(true);
  } catch (err) {
    setState({ error: err.message || String(err) });
  }
  startHeartbeat();
  return getState();
}

function init(opts) {
  if (typeof opts?.onStatus === 'function') onStatus = opts.onStatus;
}

module.exports = { init, start, stop, getState };
