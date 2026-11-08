const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tools', {
  check: () => ipcRenderer.invoke('tools:check'),
  install: id => ipcRenderer.invoke('tools:install', id),
  onProgress: cb => ipcRenderer.on('tools:progress', (_e, id, pct) => cb(id, pct)),
});

contextBridge.exposeInMainWorld('mod', {
  create: () => ipcRenderer.invoke('mod:create'),
  build: () => ipcRenderer.invoke('mod:build'),
  install: () => ipcRenderer.invoke('mod:install'),
  play: () => ipcRenderer.invoke('mod:play'),
  change: text => ipcRenderer.invoke('mod:change', text), // prośba dziecka → zmiana w modzie, wynik: odpowiedź dla lektora
  undo: () => ipcRenderer.invoke('mod:undo'), // cofa ostatnią zmianę, wynik: odpowiedź dla lektora
  onProgress: cb => ipcRenderer.on('mod:progress', (_e, text, detail) => cb(text, detail)),
});

contextBridge.exposeInMainWorld('voice', {
  transcribe: samples => ipcRenderer.invoke('voice:transcribe', samples), // Float32Array 16 kHz mono → tekst
});
