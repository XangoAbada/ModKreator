// Mod dziecka (T-9): szablon Fabric dla wykrytej wersji gry, build Gradlem, instalacja do .minecraft/mods, „Zagraj”.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readConfig, download, run } = require('./tools');

const MOD_ID = 'modkreator_mod';
const TEMPLATE = path.join(__dirname, 'mod-template');
const TEMPLATE_FILES = ['build.gradle', 'settings.gradle', 'gradle.properties',
  'src/main/resources/fabric.mod.json', 'src/main/java/pl/modkreator/mod/ModKreatorMod.java'];
// Gradle wrapper (z binarnym .jar) bierzemy z oficjalnego przykładu Fabrica zamiast trzymać go w repo.
const EXAMPLE = 'https://raw.githubusercontent.com/FabricMC/fabric-example-mod';
const WRAPPER = ['gradlew', 'gradlew.bat', 'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties'];

const modDir = () => path.join(require('electron').app.getPath('userData'), 'mod');
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

function templateVars({ mc, java, loader, fabricApi, loom }) {
  const obf = obfuscated(mc);
  return {
    MC: mc, JAVA: String(java), LOADER: loader, FABRIC_API: fabricApi, LOOM: loom,
    LOOM_PLUGIN: obf ? 'net.fabricmc.fabric-loom-remap' : 'net.fabricmc.fabric-loom',
    MAPPINGS: obf ? 'mappings loom.officialMojangMappings()' : '',
    IMPL: obf ? 'modImplementation' : 'implementation',
  };
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
async function generate(dir, mc, java) {
  const q = v => encodeURIComponent(JSON.stringify([v]));
  const { loader, fabricApi } = pickVersions(
    await getJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`),
    await getJson(`https://api.modrinth.com/v2/project/fabric-api/version?loaders=${q('fabric')}&game_versions=${q(mc)}`));
  if (!loader || !fabricApi) throw new Error(`Fabric nie obsługuje jeszcze Minecrafta ${mc}.`);
  let branch = mc, res = await fetch(`${EXAMPLE}/${branch}/gradle.properties`);
  if (!res.ok) res = await fetch(`${EXAMPLE}/${branch = 'HEAD'}/gradle.properties`);
  const loom = res.ok && props(await res.text()).loom_version;
  if (!loom) throw new Error(`Nie udało się pobrać ${EXAMPLE}/${branch}/gradle.properties`);

  const vars = templateVars({ mc, java, loader, fabricApi, loom });
  for (const f of TEMPLATE_FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), fill(fs.readFileSync(path.join(TEMPLATE, f), 'utf8'), vars));
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), 'build/\n.gradle/\nrun/\n.idea/\n*.iml\n');
  for (const f of WRAPPER) await download(`${EXAMPLE}/${branch}/${f}`, path.join(dir, f), nop);
}

async function git(dir, args) {
  const r = await run(`git -C "${dir}" ${args}`, 60000);
  if (!r.ok) throw new Error(`git ${args}: ${r.out}\nCzy jest zainstalowany Git for Windows (git-scm.com)?`);
  return r.out;
}

// Jeden rosnący mod: tworzony raz, potem tylko zmieniany (T-10).
async function create(say = nop, dir = modDir(), cfg = readConfig()) {
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  if (!cfg.minecraftVersion) throw new Error('Brak wykrytej wersji Minecrafta – najpierw ekran Start.');
  say('Przygotowuję nowy mod…');
  fs.rmSync(dir, { recursive: true, force: true }); // bez .git = nieudana poprzednia próba
  await generate(dir, cfg.minecraftVersion, cfg.javaVersion || 21);
  await git(dir, 'init -q');
  await git(dir, 'config user.name ModKreator');
  await git(dir, 'config user.email modkreator@localhost');
  await git(dir, 'add -A');
  await git(dir, 'commit -q -m "Nowy mod"');
  return dir;
}

function build(say = nop, dir = modDir(), cfg = readConfig()) {
  if (!cfg.javaHome) return Promise.reject(new Error('Brak Javy (JDK) – najpierw ekran Start.'));
  say('Buduję mod… Za pierwszym razem to trwa kilka minut.');
  return new Promise((resolve, reject) => {
    const tail = [];
    const p = spawn('cmd.exe', ['/c', '.\\gradlew.bat', 'build', '--console=plain'], // .\ – cmd nie zawsze szuka w cwd
      { cwd: dir, env: { ...process.env, JAVA_HOME: cfg.javaHome }, windowsHide: true });
    const onData = d => {
      for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
        tail.push(line);
        if (tail.length > 40) tail.shift();
        say('Buduję mod… Za pierwszym razem to trwa kilka minut.', line);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(dir)
      : reject(new Error(`Gradle zakończył się błędem (kod ${code}):\n${tail.join('\n')}`)));
  });
}

async function install(say = nop, dir = modDir(), cfg = readConfig()) {
  const libs = path.join(dir, 'build', 'libs');
  const files = fs.existsSync(libs) ? fs.readdirSync(libs).map(name => ({ name, mtime: fs.statSync(path.join(libs, name)).mtimeMs })) : [];
  const jar = pickJar(files);
  if (!jar) throw new Error('Mod nie jest jeszcze zbudowany.');
  say('Wkładam mod do gry…');
  const mods = path.join(cfg.minecraftDir, 'mods');
  fs.mkdirSync(mods, { recursive: true });
  const api = props(fs.readFileSync(path.join(dir, 'gradle.properties'), 'utf8')).fabric_api_version;
  const apiJar = `fabric-api-${api}.jar`;
  const haveApi = fs.existsSync(path.join(mods, apiJar));
  try {
    for (const f of fs.readdirSync(mods))
      if (f.startsWith(MOD_ID) || (!haveApi && /^fabric-api-.*\.jar$/i.test(f))) fs.rmSync(path.join(mods, f));
  } catch (e) {
    throw new Error(`Zamknij Minecrafta i spróbuj jeszcze raz. (${e.message})`);
  }
  fs.copyFileSync(path.join(libs, jar), path.join(mods, jar));
  if (!haveApi) {
    say('Pobieram Fabric API…');
    await download(`https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${api}/${apiJar}`, path.join(mods, apiJar), nop);
  }
  return path.join(mods, jar);
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

module.exports = { create, build, install, play, generate, pickVersions, templateVars, fill, pickJar, selectProfile };
