const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tools', {
  check: () => ipcRenderer.invoke('tools:check'),
  install: id => ipcRenderer.invoke('tools:install', id),
  onProgress: cb => ipcRenderer.on('tools:progress', (_e, id, pct) => cb(id, pct)),
});

contextBridge.exposeInMainWorld('voice', {
  transcribe: samples => ipcRenderer.invoke('voice:transcribe', samples), // Float32Array 16 kHz mono → tekst
});
