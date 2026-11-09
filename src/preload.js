const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tools', {
  check: () => ipcRenderer.invoke('tools:check'),
  install: id => ipcRenderer.invoke('tools:install', id),
  onProgress: cb => ipcRenderer.on('tools:progress', (_e, id, pct) => cb(id, pct)),
});

contextBridge.exposeInMainWorld('mod', {
  create: () => ipcRenderer.invoke('mod:create'),
  build: () => ipcRenderer.invoke('mod:build'),
  install: () => ipcRenderer.invoke('mod:install'), // zaznaczone mody do .minecraft/mods, odznaczone wyłączone
  play: () => ipcRenderer.invoke('mod:play'), // otwiera launcher z profilem Fabric
  change: text => ipcRenderer.invoke('mod:change', text), // prośba dziecka → zmiana w modzie, wynik: odpowiedź dla lektora
  list: () => ipcRenderer.invoke('mod:list'), // [{ id, own, name, active, selected, things }] – też mody z folderu mods gry
  remove: id => ipcRenderer.invoke('mod:remove', id), // do kosza (userData/kosz)
  activate: id => ipcRenderer.invoke('mod:activate', id), // ten mod zmienia rozmowa
  select: (id, on) => ipcRenderer.invoke('mod:select', id, on), // zaznaczony = jest w grze
  status: () => ipcRenderer.invoke('mod:status'), // { name, empty, saved } aktywnego moda
  newMod: () => ipcRenderer.invoke('mod:new'), // nowy pusty mod, od razu aktywny
  forget: () => ipcRenderer.invoke('mod:forget'), // zapomnij niedokończoną rozmowę
  onProgress: cb => ipcRenderer.on('mod:progress', (_e, text, detail, eta) => cb(text, detail, eta)), // eta: sekundy do końca albo undefined
  onBusy: cb => ipcRenderer.on('mod:busy', (_e, on) => cb(on)), // trwa praca na modach – „Zagraj” niedostępny
});

contextBridge.exposeInMainWorld('voice', {
  transcribe: samples => ipcRenderer.invoke('voice:transcribe', samples), // Float32Array 16 kHz mono → tekst
  speak: text => ipcRenderer.invoke('voice:speak', text), // tekst → WAV (Piper, Uint8Array) albo null bez Pipera
});
