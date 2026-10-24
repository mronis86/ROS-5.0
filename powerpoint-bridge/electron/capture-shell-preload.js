const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureShell', {
  close: () => ipcRenderer.invoke('live-capture:stop'),
});
