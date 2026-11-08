// Kreator startowy (T-7): sprawdza narzędzia i doinstalowuje brakujące.
// Wynik zapisuje do config.json (userData) – szablon moda (T-9) czyta stamtąd wersję gry, javaHome itd.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const HOME = os.homedir();
const MC_DIR = path.join(process.env.APPDATA || HOME, '.minecraft');
const LAUNCHER_APPX = 'Microsoft.4297127D64EC6'; // Minecraft Launcher ze Sklepu Microsoft
const LAUNCHER_EXES = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
  'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
];
const CLAUDE_EXE = path.join(HOME, '.local', 'bin', 'claude.exe'); // natywny instalator; PATH aplikacji może być stary
const WHISPER_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'; // small: sensowny polski, ~470 MB
const GRADLE_JDK = 25; // ponytail: Loom 1.19 (szablon moda, T-9) wymaga JDK 25 do Gradle także dla starszych gier; podbić, gdy Loom podbije
const WHISPER_BIN_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'; // whisper-cli.exe (CPU) + dll

const dataDir = () => require('electron').app.getPath('userData');
const configPath = () => path.join(dataDir(), 'config.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readConfig = () => readJson(configPath()) || {};
const saveConfig = patch => {
  const cfg = { ...readConfig(), ...patch };
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
};

const run = (cmd, timeout = 30000) => new Promise(resolve =>
  exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })));

async function download(url, dest, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0, last = -1;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), async function* (src) {
    for await (const chunk of src) {
      got += chunk.length;
      const pct = total ? Math.floor(got * 100 / total) : 0;
      if (pct !== last) onProgress(last = pct);
      yield chunk;
    }
  }, fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
}

// Zainstalowane wydania gry (bez profili Fabric itp.), najnowsze pierwsze.
function minecraftVersions(mcDir = MC_DIR) {
  const dir = path.join(mcDir, 'versions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map(id => readJson(path.join(dir, id, `${id}.json`)))
    .filter(v => v && v.type === 'release' && !v.inheritsFrom)
    .sort((a, b) => b.releaseTime.localeCompare(a.releaseTime))
    .map(v => ({ id: v.id, java: v.javaVersion?.majorVersion || 21 }));
}

// Główna wersja JDK w folderze (0 = brak JDK, np. samo JRE).
function jdkMajor(home) {
  if (!home || !fs.existsSync(path.join(home, 'bin', 'javac.exe'))) return 0;
  let release = '';
  try { release = fs.readFileSync(path.join(home, 'release'), 'utf8'); } catch {}
  const m = /JAVA_VERSION="(?:1\.)?(\d+)/.exec(release);
  return m ? Number(m[1]) : 0;
}

// Najlepsze JDK: co najmniej `need`, najbliżej `need`.
function pickJdk(homes, need) {
  return [...new Set(homes)]
    .map(h => ({ h, v: jdkMajor(h) }))
    .filter(j => j.v >= need)
    .sort((a, b) => a.v - b.v)[0]?.h || null;
}

async function jdkCandidates() {
  const homes = [readConfig().javaHome, process.env.JAVA_HOME, path.join(dataDir(), 'jdk')];
  const sub = d => { try { return fs.readdirSync(d).map(n => path.join(d, n)); } catch { return []; } };
  homes.push(...sub(path.join(dataDir(), 'jdk')));
  for (const vendor of ['Eclipse Adoptium', 'Microsoft', 'Java', 'Zulu', 'Amazon Corretto', 'BellSoft'])
    homes.push(...sub(path.join(process.env.ProgramFiles || 'C:\\Program Files', vendor)));
  const where = await run('where java');
  if (where.ok) homes.push(...where.out.split(/\r?\n/).map(p => path.dirname(path.dirname(p))));
  return homes.filter(Boolean);
}

function fabricVersionId(mcVersion) {
  const dir = path.join(MC_DIR, 'versions');
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const id = ids.find(n => n.startsWith('fabric-loader-') && n.endsWith(`-${mcVersion}`));
  const profiles = Object.values(readJson(path.join(MC_DIR, 'launcher_profiles.json'))?.profiles || {});
  return id && profiles.some(p => p.lastVersionId === id) ? id : null;
}

const ok = (id, text) => ({ id, ok: true, text });
const auto = (id, text) => ({ id, ok: false, fix: 'auto', text });
const adult = (id, text, help) => ({ id, ok: false, fix: 'adult', text, adult: help });
const blocked = (id, text) => ({ id, ok: false, text });
const AGAIN = 'Potem kliknij „Sprawdź jeszcze raz”.';

async function checkAll() {
  const appx = await run(`powershell -NoProfile -Command "(Get-AppxPackage -Name ${LAUNCHER_APPX}).PackageFamilyName"`);
  const launcherAppx = appx.ok && appx.out ? appx.out : null;
  const launcherExe = LAUNCHER_EXES.find(f => fs.existsSync(f)) || null;
  const game = minecraftVersions()[0] || null;
  const need = game?.java || 21;
  const javaHome = pickJdk(await jdkCandidates(), Math.max(need, GRADLE_JDK));
  const fabricId = game && fabricVersionId(game.id);
  saveConfig({
    minecraftDir: MC_DIR, minecraftVersion: game?.id || null, launcherExe, launcherAppx,
    javaVersion: need, javaHome, fabricVersionId: fabricId || null,
  });

  const minecraft = game
    ? ok('minecraft', `Jest! Wersja ${game.id}`)
    : !launcherAppx && !launcherExe && !fs.existsSync(MC_DIR)
      ? adult('minecraft', 'Nie ma Minecrafta. Poproś dorosłego o pomoc.',
        `Kup Minecraft: Java Edition na minecraft.net, zainstaluj Minecraft Launcher, zaloguj się kontem Microsoft i uruchom grę raz (Java Edition, najnowsze wydanie). ${AGAIN}`)
      : adult('minecraft', 'Gra nie jest jeszcze pobrana. Poproś dorosłego o pomoc.',
        `Uruchom Minecraft Launcher, zaloguj się i zagraj raz w Minecraft: Java Edition (najnowsze wydanie), żeby gra się pobrała. Zamknij grę i launcher. ${AGAIN}`);

  const java = javaHome
    ? ok('java', `Jest! Java ${jdkMajor(javaHome)}`)
    : auto('java', `Brakuje Javy ${Math.max(need, GRADLE_JDK)}. Pobrać?`);

  const fabric = !game ? blocked('fabric', 'Najpierw potrzebny Minecraft.')
    : fabricId ? ok('fabric', 'Jest!')
    : !javaHome ? blocked('fabric', 'Najpierw potrzebna Java.')
    : auto('fabric', 'Brakuje Fabrica. Zamknij grę i kliknij: pobrać?');

  const [claude, codex, whisper] = await Promise.all([checkClaude(), checkCodex(), checkWhisper()]);
  return [minecraft, java, fabric, claude, codex, whisper];
}

const claudeCmd = () => fs.existsSync(CLAUDE_EXE) ? `"${CLAUDE_EXE}"` : 'claude';

async function checkClaude() {
  if (!(await run(`${claudeCmd()} --version`)).ok) return auto('claude', 'Brakuje Claude’a. Pobrać?');
  const status = await run(`${claudeCmd()} auth status`);
  let loggedIn = false;
  try { loggedIn = JSON.parse(status.out).loggedIn === true; } catch { loggedIn = status.ok; }
  return loggedIn ? ok('claude', 'Jest!')
    : adult('claude', 'Claude musi się zalogować. Poproś dorosłego o pomoc.',
      `Otwórz PowerShell, wpisz: claude auth login i zaloguj się kontem Claude z subskrypcją (Pro lub Max). ${AGAIN}`);
}

async function checkCodex() {
  const opt = r => ({ ...r, optional: true });
  if (!(await run('codex --version')).ok) {
    return (await run('npm --version')).ok
      ? opt(auto('codex', 'Codex rysuje obrazki. Nie musi być. Pobrać?'))
      : opt(adult('codex', 'Codex rysuje obrazki. Nie musi być. Jeśli chcesz, poproś dorosłego.',
        `Zainstaluj Node.js ze strony nodejs.org, potem w PowerShell: npm install -g @openai/codex, a następnie: codex login (konto ChatGPT). ${AGAIN}`));
  }
  return (await run('codex login status')).ok ? opt(ok('codex', 'Jest!'))
    : opt(adult('codex', 'Codex musi się zalogować. Poproś dorosłego o pomoc.',
      `Otwórz PowerShell, wpisz: codex login i zaloguj się kontem ChatGPT. ${AGAIN}`));
}

const whisperPaths = () => ({
  model: path.join(dataDir(), 'whisper', 'ggml-small.bin'),
  cli: path.join(dataDir(), 'whisper', 'Release', 'whisper-cli.exe'),
});

async function checkWhisper() {
  const { model, cli } = whisperPaths();
  if (fs.existsSync(model) && fs.existsSync(cli)) { saveConfig({ whisperModel: model, whisperCli: cli }); return ok('whisper', 'Jest!'); }
  return auto('whisper', 'Brakuje słuchania. Pobrać?');
}

const installers = {
  async java(progress) {
    const need = Math.max(readConfig().javaVersion || 21, GRADLE_JDK);
    const zip = path.join(os.tmpdir(), `modkreator-jdk-${need}.zip`);
    const dir = path.join(dataDir(), 'jdk');
    await download(`https://api.adoptium.net/v3/binary/latest/${need}/ga/windows/x64/jdk/hotspot/normal/eclipse`, zip, progress);
    fs.mkdirSync(dir, { recursive: true });
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // bsdtar z Windows rozpakowuje zip
    const r = await run(`"${tar}" -xf "${zip}" -C "${dir}"`, 600000);
    fs.rmSync(zip, { force: true });
    if (!r.ok) throw new Error(r.out);
  },
  async fabric(progress) {
    const { minecraftVersion, javaHome } = readConfig();
    const loaders = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`)).json();
    if (!loaders.length) throw new Error(`Fabric nie obsługuje jeszcze Minecrafta ${minecraftVersion}.`);
    const installer = (await (await fetch('https://meta.fabricmc.net/v2/versions/installer')).json()).find(i => i.stable);
    const jar = path.join(os.tmpdir(), 'modkreator-fabric-installer.jar');
    await download(installer.url, jar, progress);
    const java = path.join(javaHome, 'bin', 'java.exe');
    const r = await run(`"${java}" -jar "${jar}" client -dir "${MC_DIR}" -mcversion "${minecraftVersion}"`, 300000);
    if (!r.ok) throw new Error(r.out);
  },
  async claude() {
    const r = await run('powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"', 600000);
    if (!r.ok) throw new Error(r.out);
  },
  async codex() {
    const r = await run('npm install -g @openai/codex', 600000);
    if (!r.ok) throw new Error(r.out);
  },
  async whisper(progress) {
    const { model, cli } = whisperPaths();
    if (!fs.existsSync(cli)) {
      const zip = path.join(os.tmpdir(), 'modkreator-whisper.zip');
      await download(WHISPER_BIN_URL, zip, progress);
      const dir = path.dirname(path.dirname(cli)); // zip ma w środku folder Release/
      fs.mkdirSync(dir, { recursive: true });
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const r = await run(`"${tar}" -xf "${zip}" -C "${dir}"`, 300000);
      fs.rmSync(zip, { force: true });
      if (!r.ok) throw new Error(r.out);
    }
    if (!fs.existsSync(model)) await download(WHISPER_URL, model, progress);
  },
};

async function install(id, progress) {
  if (!Object.hasOwn(installers, id)) throw new Error(`Nieznane narzędzie: ${id}`);
  await installers[id](progress);
}

module.exports = { checkAll, install, readConfig, minecraftVersions, jdkMajor, pickJdk, download, run };
