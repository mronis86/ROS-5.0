const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rosLedSpout', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  validateApi: (partial) => ipcRenderer.invoke('api:validate', partial),
  startOutput: (partial) => ipcRenderer.invoke('output:start', partial),
  stopOutput: () => ipcRenderer.invoke('output:stop'),
  getOutputStatus: () => ipcRenderer.invoke('output:status'),
  pickPrerenderPack: () => ipcRenderer.invoke('dialog:pickPrerenderPack'),
  bakePack: (partial) => ipcRenderer.invoke('pack:bake', partial),
  getSession: () => ipcRenderer.invoke('session:get'),
  startSession: (partial) => ipcRenderer.invoke('session:start', partial),
  endSession: () => ipcRenderer.invoke('session:end'),
  onBakeProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('pack:bake-progress', handler);
    return () => ipcRenderer.removeListener('pack:bake-progress', handler);
  },
  onOutputStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('output:status', handler);
    return () => ipcRenderer.removeListener('output:status', handler);
  },
  onSession: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('session:status', handler);
    return () => ipcRenderer.removeListener('session:status', handler);
  },
});
