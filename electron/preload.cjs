/**
 * DayMark preload：向渲染进程安全暴露主进程能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('daymark', {
  isElectron: true,
  loadSnapshot: () => ipcRenderer.invoke('daymark:load-snapshot'),
  saveSnapshot: (data) => ipcRenderer.invoke('daymark:save-snapshot', data),
  getConfig: () => ipcRenderer.invoke('daymark:get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('daymark:set-config', cfg),
  testConnection: () => ipcRenderer.invoke('daymark:test-connection'),
  pushNow: (force) => ipcRenderer.invoke('daymark:push-now', force),
  pullNow: (force) => ipcRenderer.invoke('daymark:pull-now', force),
  onSyncStatus: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('daymark:sync-status', listener);
    return () => ipcRenderer.removeListener('daymark:sync-status', listener);
  },
  onApplySnapshot: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('daymark:apply-snapshot', listener);
    return () => ipcRenderer.removeListener('daymark:apply-snapshot', listener);
  },
});