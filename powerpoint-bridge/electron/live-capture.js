const { BrowserWindow, BrowserView, desktopCapturer, ipcMain, Menu } = require('electron');
const path = require('path');
const { loadConfig, saveConfig } = require('./config-store');
const { reportLiveCapture } = require('./railway-client');
const { ensureRoom, buildPushUrl, buildViewUrl } = require('./vdo-ninja');

const HEARTBEAT_MS = 8000;
const SHELL_HEADER_H = 48;
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36';

let pendingDisplaySource = null;

let captureWindow = null;
let captureView = null;
let pickerWindow = null;
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

function mapPickerSources(sources, kind) {
  return sources
    .filter((source) =>
      kind === 'screen' ? String(source.id).startsWith('screen') : !String(source.id).startsWith('screen')
    )
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : '',
    }));
}

function listSources(types) {
  return desktopCapturer.getSources({
    types,
    thumbnailSize: { width: 280, height: 158 },
  });
}

function layoutCaptureView() {
  if (!captureWindow || captureWindow.isDestroyed() || !captureView) return;
  const [width, height] = captureWindow.getContentSize();
  captureView.setBounds({
    x: 0,
    y: SHELL_HEADER_H,
    width,
    height: Math.max(0, height - SHELL_HEADER_H),
  });
}

function sendPickerSources(sources) {
  if (!pickerWindow || pickerWindow.isDestroyed()) return;
  pickerWindow.webContents.send('capture-picker:sources', {
    screens: mapPickerSources(sources, 'screen'),
    windows: mapPickerSources(sources, 'window'),
  });
}

function pickDisplaySource() {
  return new Promise(async (resolve) => {
    let sources = [];
    try {
      sources = await listSources(['screen']);
    } catch {
      resolve(null);
      return;
    }

    if (pickerWindow && !pickerWindow.isDestroyed()) {
      pickerWindow.focus();
      sendPickerSources(sources);
    } else {
      pickerWindow = new BrowserWindow({
        width: 820,
        height: 640,
        title: 'Pick a screen',
        autoHideMenuBar: true,
        parent: captureWindow && !captureWindow.isDestroyed() ? captureWindow : undefined,
        backgroundColor: '#0b1220',
        webPreferences: {
          preload: path.join(__dirname, 'capture-picker-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      pickerWindow.loadFile(path.join(__dirname, '..', 'renderer', 'capture-picker.html'));
    }

    let done = false;
    const finish = (source, closeCapture) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('capture-picker:pick', onPick);
      ipcMain.removeListener('capture-picker:cancel', onCancel);
      ipcMain.removeListener('capture-picker:close-all', onCloseAll);
      ipcMain.removeListener('capture-picker:windows', onWindows);
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.removeAllListeners('closed');
        pickerWindow.close();
      }
      pickerWindow = null;
      resolve(source || null);
      if (closeCapture) void stop({ silent: true });
    };
    const onPick = (event, sourceId) => {
      if (!pickerWindow || event.sender !== pickerWindow.webContents) return;
      finish(sources.find((source) => source.id === sourceId) || null, false);
    };
    const onCancel = (event) => {
      if (!pickerWindow || event.sender !== pickerWindow.webContents) return;
      finish(null, false);
    };
    const onCloseAll = (event) => {
      if (!pickerWindow || event.sender !== pickerWindow.webContents) return;
      finish(null, true);
    };
    const onWindows = async (event) => {
      if (!pickerWindow || event.sender !== pickerWindow.webContents) return;
      try {
        const extra = await listSources(['window']);
        sources = sources.filter((source) => String(source.id).startsWith('screen')).concat(extra);
        sendPickerSources(sources);
      } catch {
        /* keep screens */
      }
    };

    ipcMain.on('capture-picker:pick', onPick);
    ipcMain.on('capture-picker:cancel', onCancel);
    ipcMain.on('capture-picker:close-all', onCloseAll);
    ipcMain.on('capture-picker:windows', onWindows);
    pickerWindow.on('closed', () => {
      pickerWindow = null;
      finish(null, false);
    });
    pickerWindow.webContents.on('did-finish-load', () => sendPickerSources(sources));
  });
}

function attachPermissions(webContents) {
  const ses = webContents.session;
  const allow = new Set(['media', 'display-capture', 'fullscreen', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allow.has(permission));
  });
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler((_wc, permission) => allow.has(permission));
  }
  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
      const ready = pendingDisplaySource;
      pendingDisplaySource = null;
      const source = ready || (await pickDisplaySource());
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source });
    });
  }
}

function attachCaptureMenu(webContents) {
  webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      {
        label: 'Share a screen…',
        click: () => {
          pendingDisplaySource = null;
          if (captureView && !captureView.webContents.isDestroyed()) {
            captureView.webContents.executeJavaScript(
              `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).catch(() => {});`,
              true
            );
          }
        },
      },
      { type: 'separator' },
      { label: 'Close Live Capture', click: () => void stop({ silent: true }) },
    ]).popup();
  });
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

function destroyCaptureView() {
  if (captureWindow && !captureWindow.isDestroyed() && captureView) {
    try {
      captureWindow.removeBrowserView(captureView);
    } catch {
      /* ignore */
    }
  }
  if (captureView) {
    try {
      captureView.webContents.destroy();
    } catch {
      /* ignore */
    }
  }
  captureView = null;
}

async function stop(opts = {}) {
  const silent = opts.silent === true;
  pendingDisplaySource = null;
  stopHeartbeat();
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.removeAllListeners('closed');
    pickerWindow.close();
    pickerWindow = null;
  }
  destroyCaptureView();
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

  pendingDisplaySource = null;
  if (source === 'screen') {
    const picked = await pickDisplaySource();
    if (!picked) return getState();
    pendingDisplaySource = picked;
  }

  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.removeAllListeners('closed');
    destroyCaptureView();
    captureWindow.close();
    captureWindow = null;
  }

  captureWindow = new BrowserWindow({
    width: 780,
    height: 820,
    title: 'ROS Live Capture',
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'capture-shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  captureView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  captureWindow.setBrowserView(captureView);
  captureView.webContents.setUserAgent(CHROME_UA);
  attachPermissions(captureView.webContents);
  attachCaptureMenu(captureView.webContents);
  attachCaptureMenu(captureWindow.webContents);
  layoutCaptureView();
  captureWindow.on('resize', layoutCaptureView);
  captureWindow.on('closed', () => {
    captureWindow = null;
    destroyCaptureView();
    if (lastState.active) {
      void stop({ silent: true });
    }
  });

  try {
    await captureWindow.loadFile(path.join(__dirname, '..', 'renderer', 'live-capture-shell.html'));
    await captureView.webContents.loadURL(pushUrl);
    layoutCaptureView();
  } catch (err) {
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.removeAllListeners('closed');
      destroyCaptureView();
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
