const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rosPptBridge', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  validateApi: (partial) => ipcRenderer.invoke('api:validate', partial),
  listEvents: (partial) => ipcRenderer.invoke('api:events', partial),
  pptStatus: () => ipcRenderer.invoke('ppt:status'),
  captureStills: () => ipcRenderer.invoke('ppt:capture'),
  startBridge: (partial) => ipcRenderer.invoke('bridge:start', partial),
  stopBridge: () => ipcRenderer.invoke('bridge:stop'),
  getStatus: () => ipcRenderer.invoke('bridge:status'),
  syncPlayback: (partial) => ipcRenderer.invoke('playback:sync', partial),
  pickSyncFolder: () => ipcRenderer.invoke('playback:pick-folder'),
  startLiveCapture: (partial) => ipcRenderer.invoke('live-capture:start', partial),
  stopLiveCapture: () => ipcRenderer.invoke('live-capture:stop'),
  getLiveCapture: () => ipcRenderer.invoke('live-capture:status'),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('bridge:status', handler);
    return () => ipcRenderer.removeListener('bridge:status', handler);
  },
  onLiveCapture: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('live-capture:status', handler);
    return () => ipcRenderer.removeListener('live-capture:status', handler);
  },
});
