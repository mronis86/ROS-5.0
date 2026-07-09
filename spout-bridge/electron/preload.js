const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rosLedSpout', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  validateApi: (partial) => ipcRenderer.invoke('api:validate', partial),
  startOutput: (partial) => ipcRenderer.invoke('output:start', partial),
  stopOutput: () => ipcRenderer.invoke('output:stop'),
  getOutputStatus: () => ipcRenderer.invoke('output:status'),
  onOutputStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('output:status', handler);
    return () => ipcRenderer.removeListener('output:status', handler);
  },
});
