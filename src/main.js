const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const tools = require('./tools');
const voice = require('./voice');

ipcMain.handle('tools:check', () => tools.checkAll());
ipcMain.handle('tools:install', (e, id) => tools.install(id, pct => e.sender.send('tools:progress', id, pct)));
ipcMain.handle('voice:transcribe', (_e, samples) => voice.transcribe(samples));
ipcMain.handle('voice:speak', (_e, text) => voice.synthesize(text));

// Mod dziecka (T-9) i pętla tworzenia z Claude Code (T-10)
const mod = require('./mod');
const { change, pending, forget } = require('./claude');
const modSay = e => (text, detail, eta) => e.sender.send('mod:progress', text, detail, eta); // eta: ile sekund jeszcze
// ponytail: jedna kolejka – git, Gradle i Claude w folderze moda nigdy nie działają naraz
let busy = Promise.resolve();
const queue = fn => (busy = busy.catch(() => {}).then(fn));
// Dłuższa praca na modach (budowanie, kopiowanie do gry, Claude): ekran wyłącza wtedy „Zagraj” (mod:busy).
const work = (e, fn) => queue(async () => {
  e.sender.send('mod:busy', true);
  try { return await fn(); } finally { e.sender.send('mod:busy', false); }
});
for (const step of ['create', 'build', 'install', 'play']) ipcMain.handle(`mod:${step}`, e => work(e, () => mod[step](modSay(e))));
ipcMain.handle('mod:change', (e, text) => work(e, () => change(String(text), modSay(e))));
// Lista modów (ekran „Mój mod”) i „Nowy mod” (Rozmowa)
ipcMain.handle('mod:list', () => queue(() => mod.list()));
ipcMain.handle('mod:activate', (e, id) => queue(() => { mod.activate(String(id)); forget(); }));
ipcMain.handle('mod:select', (e, id, on) => queue(() => mod.select(String(id), !!on)));
ipcMain.handle('mod:remove', (e, id) => work(e, () => { forget(); return mod.remove(String(id)); }));
// Czy bieżący mod jest zapisany: brak niedokończonej rozmowy (pytanie Claude'a bez odpowiedzi) i zmian poza commitem.
ipcMain.handle('mod:status', () => queue(async () => {
  const dir = mod.modDir(mod.activeId());
  const made = fs.existsSync(path.join(dir, '.git'));
  const dirty = made && !!(await mod.git(dir, 'status --porcelain'));
  const empty = !made || Number(await mod.git(dir, 'rev-list --count HEAD')) < 2;
  const name = made ? (await mod.list()).find(m => m.id === mod.activeId())?.name : null;
  return { name, empty, saved: !dirty && !pending() };
}));
ipcMain.handle('mod:new', e => work(e, async () => { forget(); return mod.newMod(modSay(e)); }));
ipcMain.handle('mod:forget', () => forget());

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
