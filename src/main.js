const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const tools = require('./tools');
const voice = require('./voice');

ipcMain.handle('tools:check', () => tools.checkAll());
ipcMain.handle('tools:install', (e, id) => tools.install(id, pct => e.sender.send('tools:progress', id, pct)));
ipcMain.handle('voice:transcribe', (_e, samples) => voice.transcribe(samples));

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    title: 'ModKreator',
    backgroundColor: '#2b1d12',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
