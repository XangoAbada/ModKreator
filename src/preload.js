const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tools', {
  check: () => ipcRenderer.invoke('tools:check'),
  install: id => ipcRenderer.invoke('tools:install', id),
  onProgress: cb => ipcRenderer.on('tools:progress', (_e, id, pct) => cb(id, pct)),
});
