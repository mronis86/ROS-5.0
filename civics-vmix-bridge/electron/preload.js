const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('civicsBridge', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  start: () => ipcRenderer.invoke('bridge:start'),
  stop: () => ipcRenderer.invoke('bridge:stop'),
  testVmix: () => ipcRenderer.invoke('bridge:testVmix'),
  resync: () => ipcRenderer.invoke('bridge:resync'),
  testSelect: (bindingId) => ipcRenderer.invoke('bridge:testSelect', bindingId),
  listDataSources: () => ipcRenderer.invoke('bridge:listDataSources'),
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('bridge:status', handler);
    return () => ipcRenderer.removeListener('bridge:status', handler);
  },
});
