const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rosVmixBridge', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  validateApi: (partial) => ipcRenderer.invoke('api:validate', partial),
  listEvents: (partial) => ipcRenderer.invoke('api:events', partial),
  testVmix: (partial) => ipcRenderer.invoke('vmix:test', partial),
  listDataSources: (partial) => ipcRenderer.invoke('vmix:listDataSources', partial),
  startBridge: (partial) => ipcRenderer.invoke('bridge:start', partial),
  stopBridge: () => ipcRenderer.invoke('bridge:stop'),
  resync: () => ipcRenderer.invoke('bridge:resync'),
  getStatus: () => ipcRenderer.invoke('bridge:status'),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('bridge:status', handler);
    return () => ipcRenderer.removeListener('bridge:status', handler);
  },
});
