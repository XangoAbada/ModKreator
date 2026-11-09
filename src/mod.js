// Mody dziecka (T-9): szablon Fabric dla wykrytej wersji gry, build Gradlem, „Zagraj” = zaznaczone mody do
// .minecraft/mods + launcher. Każdy mod to osobny projekt Gradle z gitem; rozmowa zmienia „aktywny” mod.
// Lista pokazuje też mody spoza ModKreatora z folderu mods gry (włącz/wyłącz, kosz).
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { spawn } = require('child_process');
const { readConfig, download, run } = require('./tools');

const TEMPLATE = path.join(__dirname, 'mod-template');
// PKG w ścieżce = folder pakietu moda (pl/modkreator/mod2 itd.)
const TEMPLATE_FILES = ['build.gradle', 'settings.gradle', 'gradle.properties',
  'src/main/resources/fabric.mod.json', 'src/main/java/PKG/ModKreatorMod.java',
  'src/client/java/PKG/client/ModKreatorModClient.java'];
// Pierwszy mod (sprzed listy modów) ma id modkreator_mod i folder userData/mod; kolejne: modkreator_<n> w userData/mods.
const FIRST = { id: 'modkreator_mod', pkg: 'pl.modkreator.mod', name: 'Mój mod' };
const OWN_JAR = /^modkreator_\w*-.*\.jar$/i; // jary modów dziecka w folderze mods
// Gradle wrapper (z binarnym .jar) bierzemy z oficjalnego przykładu Fabrica zamiast trzymać go w repo.
const EXAMPLE = 'https://raw.githubusercontent.com/FabricMC/fabric-example-mod';
const WRAPPER = ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties'];
// services.gradle.org dawał 502/503 (2026-11-08, mod „komputery”), więc Gradle pobieramy z oficjalnego mirrora na GitHubie
// z przypiętą sumą SHA-256. Suma: plik .sha256 z services.gradle.org (mały, działał też w czasie awarii) albo ta tabela.
const GRADLE_MIRROR = v => `https://github.com/gradle/gradle-distributions/releases/download/v${v}/gradle-${v}-bin.zip`;
const GRADLE_SHA256 = { '9.8.2': '21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607' };

const userData = () => require('electron').app.getPath('userData');
const modDir = (id = FIRST.id, base = userData()) => id === FIRST.id ? path.join(base, 'mod') : path.join(base, 'mods', id);
const nop = () => {};
const getJson = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': 'ModKreator' } }); // Modrinth wymaga User-Agent
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
};
const props = text => Object.fromEntries(text.split(/\r?\n/)
  .map(l => /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].trim()]));

// Od 26.x Minecraft nie jest obfuskowany: Loom bez remapowania. Starsze: nazwy Mojanga + remap.
const obfuscated = mc => Number(mc.split('.')[0]) < 26;

function pickVersions(loaders, apis) {
  return {
    loader: (loaders.find(l => l.loader.stable) || loaders[0])?.loader.version,
    fabricApi: (apis.find(v => v.version_type === 'release') || apis[0])?.version_number,
  };
}

function templateVars({ mc, java, loader, fabricApi, loom, mod = FIRST }) {
  const obf = obfuscated(mc);
  return {
    MC: mc, JAVA: String(java), LOADER: loader, FABRIC_API: fabricApi, LOOM: loom,
    MOD_ID: mod.id, PACKAGE: mod.pkg, NAME: mod.name,
    LOOM_PLUGIN: obf ? 'net.fabricmc.fabric-loom-remap' : 'net.fabricmc.fabric-loom',
    MAPPINGS: obf ? 'mappings loom.officialMojangMappings()' : '',
    IMPL: obf ? 'modImplementation' : 'implementation',
  };
}
// gradle-wrapper.properties z przykładu Fabrica → mirror na GitHubie, suma SHA-256, dłuższy timeout i ponowienia.
const gradleVersion = text => /gradle-([\w.-]+?)-(?:bin|all)\.zip/.exec(text)?.[1];
function wrapperProps(text, sha256) {
  const v = gradleVersion(text);
  if (!v) return text;
  const set = (t, key, val) => new RegExp(`^${key}=`, 'm').test(t)
    ? t.replace(new RegExp(`^${key}=.*$`, 'm'), () => `${key}=${val}`) : `${t.replace(/\s*$/, '')}\n${key}=${val}\n`;
  let t = set(text, 'distributionUrl', GRADLE_MIRROR(v).replace(':', '\\:')); // w .properties „:” zapisuje się jako „\:”
  if (sha256) t = set(t, 'distributionSha256Sum', sha256);
  t = set(t, 'networkTimeout', '120000');
  return set(t, 'retries', '3');
}

async function gradleSha256(v) {
  try {
    const r = await fetch(`https://services.gradle.org/distributions/gradle-${v}-bin.zip.sha256`, { signal: AbortSignal.timeout(30000) });
    const sum = r.ok && (await r.text()).trim();
    if (/^[0-9a-f]{64}$/.test(sum)) return sum;
  } catch {}
  return GRADLE_SHA256[v] || null;
}

const fill = (text, vars) => text.replace(/@([A-Z_]+)@/g, (m, k) => Object.hasOwn(vars, k) ? vars[k] : m);

// Zbudowany mod: najnowszy .jar w build/libs, bez -sources/-dev.
const pickJar = files => files.filter(f => /\.jar$/.test(f.name) && !/-(sources|dev)\.jar$/.test(f.name))
  .sort((a, b) => b.mtime - a.mtime)[0]?.name || null;

// Launcher pokazuje na „Graj” ostatnio używaną instalację, więc oznaczamy profil Fabric jako ostatnio używany.
function selectProfile(json, versionId, now = new Date().toISOString()) {
  const p = Object.values(json?.profiles || {}).find(p => p.lastVersionId === versionId);
  if (p) p.lastUsed = now;
  return !!p;
}

// Tworzy projekt moda w `dir` (bez gita). Wersje: loader z meta.fabricmc.net, Fabric API z Modrinth,
// Loom + Gradle wrapper z gałęzi fabric-example-mod dla tej wersji gry (albo najnowszej).
async function generate(dir, mc, java, mod = FIRST) {
  const q = v => encodeURIComponent(JSON.stringify([v]));
  const { loader, fabricApi } = pickVersions(
    await getJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`),
    await getJson(`https://api.modrinth.com/v2/project/fabric-api/version?loaders=${q('fabric')}&game_versions=${q(mc)}`));
  if (!loader || !fabricApi) throw new Error(`Fabric nie obsługuje jeszcze Minecrafta ${mc}.`);
  let branch = mc, res = await fetch(`${EXAMPLE}/${branch}/gradle.properties`);
  if (!res.ok) res = await fetch(`${EXAMPLE}/${branch = 'HEAD'}/gradle.properties`);
  const loom = res.ok && props(await res.text()).loom_version;
  if (!loom) throw new Error(`Nie udało się pobrać ${EXAMPLE}/${branch}/gradle.properties`);

  const vars = templateVars({ mc, java, loader, fabricApi, loom, mod });
  for (const f of TEMPLATE_FILES) {
    const out = path.join(dir, f.replace('PKG', mod.pkg.replace(/\./g, '/')));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fill(fs.readFileSync(path.join(TEMPLATE, f), 'utf8'), vars));
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), 'build/\n.gradle/\nrun/\n.idea/\n*.iml\n');
  for (const f of WRAPPER) await download(`${EXAMPLE}/${branch}/${f}`, path.join(dir, f), nop);
  const wp = path.join(dir, 'gradle/wrapper/gradle-wrapper.properties');
  const text = fs.readFileSync(wp, 'utf8');
  const v = gradleVersion(text);
  fs.writeFileSync(wp, wrapperProps(text, v && await gradleSha256(v)));
}

async function git(dir, args) {
  const r = await run(`git -C "${dir}" ${args}`, 60000);
  if (!r.ok) throw new Error(`git ${args}: ${r.out}\nCzy jest zainstalowany Git for Windows (git-scm.com)?`);
  return r.out;
}

// Lista modów: który mod zmienia rozmowa (active) i które są zaznaczone do gry (selected) – userData/mods.json.
const statePath = base => path.join(base, 'mods.json');
// ext: wybór dla modów spoza ModKreatora z folderu mods ({ 'ext:<plik.jar>': true/false }); bez wpisu – jak teraz na dysku.
function readState(base = userData()) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(statePath(base), 'utf8')); } catch {}
  return { active: s.active || FIRST.id, selected: Array.isArray(s.selected) ? s.selected : [FIRST.id],
    ext: s.ext && typeof s.ext === 'object' ? s.ext : {} };
}
function writeState(state, base = userData()) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(statePath(base), JSON.stringify(state, null, 2));
}

const modNumber = id => id === FIRST.id ? 1 : Number(id.split('_')[1]);
const modSpec = id => id === FIRST.id ? FIRST : { id, pkg: `pl.modkreator.mod${modNumber(id)}`, name: 'Nowy mod' };

// Id istniejących modów (z gitem), w kolejności tworzenia.
function modIds(base = userData()) {
  const ids = fs.existsSync(path.join(modDir(FIRST.id, base), '.git')) ? [FIRST.id] : [];
  const more = path.join(base, 'mods');
  for (const n of fs.existsSync(more) ? fs.readdirSync(more) : [])
    if (/^modkreator_\d+$/.test(n) && fs.existsSync(path.join(more, n, '.git'))) ids.push(n);
  return ids.sort((a, b) => modNumber(a) - modNumber(b));
}

// id, nazwa i pakiet moda z jego fabric.mod.json (nazwę nadaje Claude przy pierwszej prośbie).
function modInfo(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'src/main/resources/fabric.mod.json'), 'utf8'));
    return { id: j.id, name: j.name, pkg: j.entrypoints.main[0].replace(/\.ModKreatorMod$/, '') };
  } catch { return { ...FIRST }; }
}

// Co jest w modzie: polskie nazwy przedmiotów i bloków z lang/pl_pl.json.
function modThings(dir, id) {
  try {
    const lang = JSON.parse(fs.readFileSync(path.join(dir, 'src/main/resources/assets', id, 'lang', 'pl_pl.json'), 'utf8'));
    return Object.entries(lang).filter(([k]) => /^(item|block)\./.test(k)).map(([, v]) => String(v));
  } catch { return []; }
}

// Co już jest w modzie (dla Claude'a: nowa rzecz = nowy mod): nazwy rzeczy, a bez nich prośby z historii.
// Pusta lista = pusty mod (sam commit „Nowy mod”).
async function contents(dir) {
  const things = modThings(dir, modInfo(dir).id);
  if (things.length) return things;
  const log = await git(dir, 'log --format=%s').catch(() => '');
  return log.split(/\r?\n/).filter(l => l && l !== 'Nowy mod');
}

// Nazwa zastępcza z szablonu – wtedy mod nazywa się od pierwszej rzeczy w nim (miecz → „Miecz”).
const PLACEHOLDER = new Set(['Nowy mod', 'Mój mod']);
const displayName = (name, things) => PLACEHOLDER.has(name) && things.length ? things[0] : name;

// Jeden plik z archiwum .jar (zip) – bez bibliotek: katalog centralny → nagłówek lokalny → stored albo deflate.
function zipEntry(file, wanted) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0 && buf.readUInt32LE(p) === 0x02014b50; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    }
    p += 46 + nameLen + extra + comment;
  }
  return null;
}

// Mody spoza ModKreatora w <minecraftDir>/mods (pobrane z internetu itp.): włączony = .jar, wyłączony = .jar.disabled
// (tak wyłącza mody Fabric i inne launchery). Fabric API pomijamy – potrzebne wszystkim modom, zostaje włączone.
function externalMods(cfg) {
  const dir = cfg.minecraftDir && path.join(cfg.minecraftDir, 'mods');
  const out = [];
  for (const f of dir && fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = /^(.+\.jar)(\.disabled)?$/i.exec(f);
    if (!m || OWN_JAR.test(m[1]) || /^fabric-api-/i.test(m[1])) continue;
    let j = {};
    try { j = JSON.parse(zipEntry(path.join(dir, f), 'fabric.mod.json')?.toString('utf8') || '{}'); } catch {}
    if (j.id === 'fabric-api') continue;
    out.push({ id: `ext:${m[1]}`, file: path.join(dir, f), jar: m[1], enabled: !m[2],
      name: j.name || m[1].replace(/\.jar$/i, ''), description: typeof j.description === 'string' ? j.description : '' });
  }
  return out;
}

// Dla ekranu „Mój mod”: najpierw mody dziecka (nazwa, czy aktywny, czy w grze, co w nich jest), potem znalezione
// w folderze mods gry (own: false – nie da się ich zmieniać rozmową, tylko włączać/wyłączać i usuwać).
async function list(base = userData(), cfg = readConfig()) {
  const state = readState(base);
  const ids = modIds(base);
  const active = ids.includes(state.active) ? state.active : ids[0];
  const mods = ids.map(id => {
    const dir = modDir(id, base), info = modInfo(dir), things = modThings(dir, info.id);
    return { id, own: true, name: displayName(info.name, things), active: id === active,
      selected: state.selected.includes(id), things };
  });
  for (const e of externalMods(cfg))
    mods.push({ id: e.id, own: false, name: e.name, active: false, selected: state.ext[e.id] ?? e.enabled,
      things: e.description ? [e.description.length > 90 ? e.description.slice(0, 87) + '…' : e.description] : [] });
  return mods;
}

// Folder aktywnego moda (tego, który zmienia rozmowa); gdy go jeszcze nie ma – pierwszy mod.
function activeId(base = userData()) {
  const { active } = readState(base);
  return modIds(base).includes(active) ? active : FIRST.id;
}

function activate(id, base = userData()) {
  if (!modIds(base).includes(id)) throw new Error(`Nie ma moda ${id}.`);
  writeState({ ...readState(base), active: id }, base);
}

// Zaznaczenie zapisujemy od razu; w folderze mods gry zmienia je dopiero „Zagraj” (install) – gra może trzymać pliki.
function select(id, on = true, base = userData()) {
  const state = readState(base);
  if (id.startsWith('ext:')) return writeState({ ...state, ext: { ...state.ext, [id]: !!on } }, base);
  const selected = state.selected.filter(s => s !== id);
  if (on) selected.push(id);
  writeState({ ...state, selected }, base);
}

// Przenosi plik/folder do <userData>/kosz (da się odzyskać), zamiast kasować na zawsze.
function toTrash(src, base, name) {
  const trash = path.join(base, 'kosz');
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${new Date().toISOString().replace(/[:.]/g, '-')}_${name}`);
  try { fs.renameSync(src, dest); }
  catch (e) {
    if (e.code !== 'EXDEV') throw new Error(`Zamknij Minecrafta i spróbuj jeszcze raz. (${e.message})`);
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

// Kosz na liście: mod dziecka (cały projekt + jego jar w grze) albo mod znaleziony w folderze mods gry.
async function remove(id, base = userData(), cfg = readConfig()) {
  const state = readState(base);
  if (id.startsWith('ext:')) {
    const e = externalMods(cfg).find(m => m.id === id);
    if (!e) throw new Error(`Nie ma moda ${id}.`);
    const { [id]: _, ...ext } = state.ext;
    toTrash(e.file, base, path.basename(e.file));
    writeState({ ...state, ext }, base);
    return `Usunięte: „${e.name}”.`;
  }
  if (!modIds(base).includes(id)) throw new Error(`Nie ma moda ${id}.`);
  const dir = modDir(id, base), info = modInfo(dir), name = displayName(info.name, modThings(dir, info.id));
  const mods = cfg.minecraftDir && path.join(cfg.minecraftDir, 'mods');
  for (const f of mods && fs.existsSync(mods) ? fs.readdirSync(mods) : [])
    if (f.startsWith(`${id}-`) && OWN_JAR.test(f)) {
      try { fs.rmSync(path.join(mods, f)); } catch (e) { throw new Error(`Zamknij Minecrafta i spróbuj jeszcze raz. (${e.message})`); }
    }
  toTrash(dir, base, id);
  const left = modIds(base);
  writeState({ ...state, selected: state.selected.filter(s => s !== id),
    active: state.active === id ? (left[0] || FIRST.id) : state.active }, base);
  return `Usunięte: „${name}”.`;
}

// Nowy, pusty mod – od razu aktywny (rozmowa zmienia teraz jego) i zaznaczony do gry.
async function newMod(say = nop, base = userData(), cfg = readConfig()) {
  const id = `modkreator_${Math.max(1, ...modIds(base).map(modNumber)) + 1}`;
  await create(say, id, cfg, base);
  const state = readState(base);
  writeState({ ...state, active: id, selected: [...state.selected.filter(s => s !== id), id] }, base);
  return 'Mamy nowy, pusty mod! Powiedz, co ma w nim być.';
}

async function create(say = nop, id = activeId(), cfg = readConfig(), base = userData()) {
  const dir = modDir(id, base);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  if (!cfg.minecraftVersion) throw new Error('Brak wykrytej wersji Minecrafta – najpierw ekran Start.');
  say('Przygotowuję nowy mod…');
  fs.rmSync(dir, { recursive: true, force: true }); // bez .git = nieudana poprzednia próba
  await generate(dir, cfg.minecraftVersion, cfg.javaVersion || 21, modSpec(id));
  await git(dir, 'init -q');
  await git(dir, 'config user.name ModKreator');
  await git(dir, 'config user.email modkreator@localhost');
  await git(dir, 'add -A');
  await git(dir, 'commit -q -m "Nowy mod"');
  return dir;
}

function build(say = nop, dir = modDir(activeId()), cfg = readConfig()) {
  if (!cfg.javaHome) return Promise.reject(new Error('Brak Javy (JDK) – najpierw ekran Start.'));
  const info = modInfo(dir);
  const msg = `Buduję mod „${displayName(info.name, modThings(dir, info.id))}”… Za pierwszym razem to trwa kilka minut.`;
  say(msg);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tail = [];
    const p = spawn('cmd.exe', ['/c', '.\\gradlew.bat', 'build', '--console=plain'], // .\ – cmd nie zawsze szuka w cwd
      { cwd: dir, env: { ...process.env, JAVA_HOME: cfg.javaHome }, windowsHide: true });
    const onData = d => {
      for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
        tail.push(line);
        if (tail.length > 40) tail.shift();
        say(msg, line);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    // buildLog: błędy Gradle'a, które pętla tworzenia (T-10) daje Claude'owi do naprawy
    p.on('close', code => {
      if (code === 0) {
        try { fs.writeFileSync(timeFile(dir), String(Date.now() - t0)); } catch {} // do szacowania czasu (buildSeconds)
        return resolve(dir);
      }
      reject(Object.assign(
        new Error(`Gradle zakończył się błędem (kod ${code}):\n${tail.join('\n')}`), { buildLog: tail.join('\n') }));
    });
  });
}

// Ile potrwa build (sekundy, do odliczania przy „Zagraj”): ostatni czas tego moda; bez niego – krótko, gdy Gradle
// ma już Minecrafta w cache (kolejne mody budują się w kilka sekund), a za pierwszym razem w ogóle – kilka minut.
const timeFile = dir => path.join(dir, 'build', 'modkreator-buildms');
const LOOM_CACHE = path.join(process.env.GRADLE_USER_HOME || path.join(require('os').homedir(), '.gradle'), 'caches', 'fabric-loom');
function buildSeconds(dir) {
  try { return Math.max(3, Math.ceil(Number(fs.readFileSync(timeFile(dir), 'utf8')) / 1000)); } catch {}
  return fs.existsSync(LOOM_CACHE) ? 30 : 300;
}

// Zbudowany jar moda albo null.
function jarOf(dir) {
  const libs = path.join(dir, 'build', 'libs');
  const files = fs.existsSync(libs) ? fs.readdirSync(libs).map(name => ({ name, mtime: fs.statSync(path.join(libs, name)).mtimeMs })) : [];
  const jar = pickJar(files);
  return jar && path.join(libs, jar);
}

// Build tylko, gdy jar nie powstał z obecnej wersji moda (commit HEAD zapisany przy buildzie w build/modkreator-head).
// ponytail: nie po datach – po przywróceniu starszego commita jar jest nowszy, a mimo to nieaktualny.
const headFile = dir => path.join(dir, 'build', 'modkreator-head');
async function needsBuild(dir) {
  let last = null;
  try { last = fs.readFileSync(headFile(dir), 'utf8').trim(); } catch {}
  return !jarOf(dir) || last !== (await git(dir, 'rev-parse HEAD')).trim() || !!(await git(dir, 'status --porcelain'));
}
async function built(say, dir, cfg) {
  const head = (await git(dir, 'rev-parse HEAD')).trim();
  if (await needsBuild(dir)) {
    await build(say, dir, cfg);
    if (!(await git(dir, 'status --porcelain'))) fs.writeFileSync(headFile(dir), head); // tylko czysty stan = ten commit
  }
  const out = jarOf(dir);
  if (!out) throw new Error(`Mod ${dir} nie zbudował się (brak .jar w build/libs).`);
  return out;
}

// Jary zaznaczonych modów (zbudowane w razie potrzeby). say(tekst, szczegół, eta) – eta: ile sekund jeszcze
// (szacunek z czasów poprzednich buildów) do odliczania na ekranie; „Zagraj” jest w tym czasie wyłączony.
async function selectedJars(say, cfg, base) {
  const { selected } = readState(base);
  const ids = modIds(base).filter(id => selected.includes(id));
  const plan = [];
  for (const id of ids) plan.push((await needsBuild(modDir(id, base))) ? buildSeconds(modDir(id, base)) : 0);
  let left = plan.reduce((a, b) => a + b, 0) + 2; // +2 s: kopiowanie do gry
  say('Przygotowuję mody do gry…', '', left);
  const jars = [];
  for (const [i, id] of ids.entries()) {
    jars.push({ id, jar: await built(say, modDir(id, base), cfg) });
    if (plan[i]) say('Przygotowuję mody do gry…', '', left -= plan[i]);
  }
  return jars;
}

// Podmienia jary modów dziecka w folderze mods na podane (inne mody zostają).
function putJars(mods, jars) {
  fs.mkdirSync(mods, { recursive: true });
  try {
    for (const f of fs.readdirSync(mods)) if (OWN_JAR.test(f)) fs.rmSync(path.join(mods, f));
  } catch (e) {
    throw new Error(`Zamknij Minecrafta i spróbuj jeszcze raz. (${e.message})`);
  }
  for (const { jar } of jars) fs.copyFileSync(jar, path.join(mods, path.basename(jar)));
}

// Prawdziwa gra: zaznaczone mody dziecka do <minecraftDir>/mods (odznaczone znikają, nawet jeśli były tam wcześniej),
// mody spoza ModKreatora włączone/wyłączone wg zaznaczenia (.jar ↔ .jar.disabled), brakujące Fabric API.
async function install(say = nop, cfg = readConfig(), base = userData()) {
  const jars = await selectedJars(say, cfg, base);
  say('Wkładam mody do gry…');
  const mods = path.join(cfg.minecraftDir, 'mods');
  putJars(mods, jars);
  const { ext } = readState(base);
  for (const e of externalMods(cfg)) {
    const want = ext[e.id] ?? e.enabled;
    if (want === e.enabled) continue;
    try { fs.renameSync(e.file, path.join(mods, want ? e.jar : `${e.jar}.disabled`)); }
    catch (err) { throw new Error(`Zamknij Minecrafta i spróbuj jeszcze raz. (${err.message})`); }
  }
  if (!jars.length) return mods;
  const api = props(fs.readFileSync(path.join(modDir(jars[0].id, base), 'gradle.properties'), 'utf8')).fabric_api_version;
  const apiJar = `fabric-api-${api}.jar`;
  // Każde Fabric API dla tej samej wersji gry (…+26.3.jar) wystarczy – nowszego nie zamieniamy na starsze.
  const sameGame = f => /^fabric-api-.*\.jar$/i.test(f) && f.endsWith(`+${api.split('+')[1]}.jar`);
  if (!fs.readdirSync(mods).some(sameGame)) {
    try {
      for (const f of fs.readdirSync(mods)) if (/^fabric-api-.*\.jar$/i.test(f)) fs.rmSync(path.join(mods, f));
    } catch (e) {
      throw new Error(`Zamknij Minecrafta i spróbuj jeszcze raz. (${e.message})`);
    }
    say('Pobieram Fabric API…', '', 20);
    await download(`https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${api}/${apiJar}`, path.join(mods, apiJar), nop);
  }
  return mods;
}

// ponytail: oficjalny launcher nie ma opcji „uruchom grę z profilem” – otwieramy go z wybranym profilem Fabric,
// dziecko klika „Graj”. Zmiana lastUsed nie zadziała, gdy launcher jest już otwarty (trzyma profile w pamięci).
async function play(say = nop, cfg = readConfig()) {
  if (!cfg.fabricVersionId) throw new Error('Brak profilu Fabric – najpierw ekran Start.');
  const file = path.join(cfg.minecraftDir, 'launcher_profiles.json');
  let json = null;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (selectProfile(json, cfg.fabricVersionId)) fs.writeFileSync(file, JSON.stringify(json, null, 2));
  say('Otwieram Minecrafta…');
  if (cfg.launcherAppx) {
    const name = cfg.launcherAppx.split('_')[0];
    const r = await run(`powershell -NoProfile -Command "$p = Get-AppxPackage -Name ${name}; ` +
      `$id = @((Get-AppxPackageManifest $p).Package.Applications.Application)[0].Id; ` +
      `Start-Process ('shell:AppsFolder\\' + $p.PackageFamilyName + '!' + $id)"`);
    if (!r.ok) throw new Error(r.out);
  } else if (cfg.launcherExe) {
    spawn(cfg.launcherExe, [], { detached: true, stdio: 'ignore' }).unref();
  } else throw new Error('Nie ma Minecraft Launchera – najpierw ekran Start.');
}

module.exports = { create, build, install, play, remove, git, modDir, list, contents, activate, select, newMod, activeId, modInfo, readState, generate, pickVersions, templateVars, fill, pickJar, selectProfile, wrapperProps };
