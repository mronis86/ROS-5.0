const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('civicsBridge', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  start: () => ipcRenderer.invoke('bridge:start'),
  stop: () => ipcRenderer.invoke('bridge:stop'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('bridge:status', handler);
  },
});
