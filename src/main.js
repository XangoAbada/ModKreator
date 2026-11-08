const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const tools = require('./tools');
const voice = require('./voice');

ipcMain.handle('tools:check', () => tools.checkAll());
ipcMain.handle('tools:install', (e, id) => tools.install(id, pct => e.sender.send('tools:progress', id, pct)));
ipcMain.handle('voice:transcribe', (_e, samples) => voice.transcribe(samples));

// Mod dziecka (T-9) i pętla tworzenia z Claude Code (T-10)
const mod = require('./mod');
const { change } = require('./claude');
const modSay = e => (text, detail) => e.sender.send('mod:progress', text, detail);
// ponytail: jedna kolejka – git, Gradle i Claude w folderze moda nigdy nie działają naraz
let busy = Promise.resolve();
const queue = fn => (busy = busy.catch(() => {}).then(fn));
for (const step of ['create', 'build', 'install', 'play', 'undo']) ipcMain.handle(`mod:${step}`, e => queue(() => mod[step](modSay(e))));
ipcMain.handle('mod:change', (e, text) => queue(() => change(String(text), modSay(e))));

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
