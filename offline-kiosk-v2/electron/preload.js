const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  getBootstrap: () => ipcRenderer.invoke('kiosk:getBootstrap'),
  offlineShowStatus: () => ipcRenderer.invoke('kiosk:offlineShowStatus'),
  startOfflineShow: () => ipcRenderer.invoke('kiosk:startOfflineShow'),
  stopOfflineShow: () => ipcRenderer.invoke('kiosk:stopOfflineShow'),
  getSession: () => ipcRenderer.invoke('kiosk:getSession'),
  startSession: (partial) => ipcRenderer.invoke('kiosk:startSession', partial),
  endSession: () => ipcRenderer.invoke('kiosk:endSession'),
  onSession: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('session:status', handler);
    return () => ipcRenderer.removeListener('session:status', handler);
  },
  listEvents: () => ipcRenderer.invoke('kiosk:listEvents'),
  getConnectivity: () => ipcRenderer.invoke('kiosk:getConnectivity'),
  setCloudMode: (payload) => ipcRenderer.invoke('kiosk:setCloudMode', payload),
  saveRailwayToken: (payload) => ipcRenderer.invoke('kiosk:saveRailwayToken', payload),
  clearRailwayToken: () => ipcRenderer.invoke('kiosk:clearRailwayToken'),
  syncFromCloud: () => ipcRenderer.invoke('kiosk:syncFromCloud'),
  setOutputArmed: (payload) => ipcRenderer.invoke('kiosk:setOutputArmed', payload),
  openDisplayPreview: (payload) => ipcRenderer.invoke('kiosk:openDisplayPreview', payload),
  closeDisplayPreview: (payload) => ipcRenderer.invoke('kiosk:closeDisplayPreview', payload),
  weblinkedGetState: () => ipcRenderer.invoke('kiosk:weblinkedGetState'),
  weblinkedApplySimpleSettings: (payload) =>
    ipcRenderer.invoke('kiosk:weblinkedApplySimpleSettings', payload),
  weblinkedGetPreviewFrame: (payload) =>
    ipcRenderer.invoke('kiosk:weblinkedGetPreviewFrame', payload || {}),
  weblinkedSendInput: (payload) => ipcRenderer.invoke('kiosk:weblinkedSendInput', payload),
  weblinkedStatus: () => ipcRenderer.invoke('kiosk:weblinkedStatus'),
  weblinkedDiagnostics: () => ipcRenderer.invoke('kiosk:weblinkedDiagnostics'),
  listSystemDisplays: () => ipcRenderer.invoke('kiosk:listSystemDisplays'),
  pptBridgeStatus: (payload) => ipcRenderer.invoke('kiosk:pptBridgeStatus', payload || {}),
  getSystemHealth: () => ipcRenderer.invoke('kiosk:getSystemHealth'),
  startWebLinked: (payload) => ipcRenderer.invoke('kiosk:startWebLinked', payload),
  stopWebLinked: () => ipcRenderer.invoke('kiosk:stopWebLinked'),
  setCameraMode: (payload) => ipcRenderer.invoke('kiosk:setCameraMode', payload),
  remoteEmbedOpen: (payload) => ipcRenderer.invoke('kiosk:remoteEmbedOpen', payload),
  remoteEmbedBounds: (bounds) => ipcRenderer.invoke('kiosk:remoteEmbedBounds', bounds),
  remoteEmbedHide: () => ipcRenderer.invoke('kiosk:remoteEmbedHide'),
  remoteEmbedShow: (bounds) => ipcRenderer.invoke('kiosk:remoteEmbedShow', bounds),
  remoteEmbedClose: () => ipcRenderer.invoke('kiosk:remoteEmbedClose'),
});
