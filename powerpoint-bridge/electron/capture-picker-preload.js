const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capturePicker', {
  onSources: (callback) => {
    ipcRenderer.on('capture-picker:sources', (_event, payload) => callback(payload));
  },
  pick: (sourceId) => ipcRenderer.send('capture-picker:pick', sourceId),
  cancel: () => ipcRenderer.send('capture-picker:cancel'),
  closeAll: () => ipcRenderer.send('capture-picker:close-all'),
  showWindows: () => ipcRenderer.send('capture-picker:windows'),
});
