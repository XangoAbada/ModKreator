// Szybki test logiki moda dziecka: node test/mod.check.js
const assert = require('assert');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickVersions, templateVars, fill, pickJar, selectProfile, install, wrapperProps, git, modDir, list, activate, select, activeId, remove } = require('../src/mod');

const loaders = [{ loader: { version: '0.21.0-beta', stable: false } }, { loader: { version: '0.20.1', stable: true } }];
const apis = [{ version_number: '0.166.0+26.3', version_type: 'beta' }, { version_number: '0.165.2+26.3', version_type: 'release' }];
assert.deepStrictEqual(pickVersions(loaders, apis), { loader: '0.20.1', fabricApi: '0.165.2+26.3' });
assert.deepStrictEqual(pickVersions([], []), { loader: undefined, fabricApi: undefined });

const tpl = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'mod-template', f), 'utf8');
const v = { java: 25, loader: '0.20.1', fabricApi: '0.165.2+26.3', loom: '1.19-SNAPSHOT' };
const props = fill(tpl('gradle.properties'), templateVars({ mc: '26.3', ...v }));
assert.match(props, /^minecraft_version=26\.3$/m);
assert.match(props, /^fabric_api_version=0\.165\.2\+26\.3$/m);
assert.match(props, /^java_version=25$/m);
assert.doesNotMatch(props, /@[A-Z_]+@/);
const newGradle = fill(tpl('build.gradle'), templateVars({ mc: '26.3', ...v }));
assert.match(newGradle, /id 'net\.fabricmc\.fabric-loom' /);
assert.doesNotMatch(newGradle, /mappings|modImplementation|@[A-Z_]+@/);
const oldGradle = fill(tpl('build.gradle'), templateVars({ mc: '1.21.10', ...v, java: 21 }));
assert.match(oldGradle, /id 'net\.fabricmc\.fabric-loom-remap' /);
assert.match(oldGradle, /mappings loom\.officialMojangMappings\(\)/);
assert.match(oldGradle, /modImplementation "net\.fabricmc:fabric-loader/);
assert.match(fill('@Override @MC@', { MC: '1' }), /^@Override 1$/);
// Jak w sprawdzonym modzie „komputery”: osobny kod klienta i jego klasa startowa.
assert.match(newGradle, /splitEnvironmentSourceSets\(\)/);
assert.match(newGradle, /sourceSet sourceSets\.client/);
const modJson = JSON.parse(fill(tpl('src/main/resources/fabric.mod.json'), templateVars({ mc: '26.3', ...v })));
assert.deepStrictEqual(modJson.entrypoints.client, ['pl.modkreator.mod.client.ModKreatorModClient']);
assert.strictEqual(modJson.id, 'modkreator_mod');
assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'mod-template', 'src/client/java/PKG/client/ModKreatorModClient.java')));
// Kolejne mody: własne id, pakiet i nazwa (żeby kilka modów mogło być w grze naraz).
const mod2 = { id: 'modkreator_2', pkg: 'pl.modkreator.mod2', name: 'Nowy mod' };
const json2 = JSON.parse(fill(tpl('src/main/resources/fabric.mod.json'), templateVars({ mc: '26.3', ...v, mod: mod2 })));
assert.deepStrictEqual([json2.id, json2.name, json2.entrypoints.main[0]], ['modkreator_2', 'Nowy mod', 'pl.modkreator.mod2.ModKreatorMod']);
assert.match(fill(tpl('build.gradle'), templateVars({ mc: '26.3', ...v, mod: mod2 })), /archivesName = 'modkreator_2'/);
assert.match(fill(tpl('src/main/java/PKG/ModKreatorMod.java'), templateVars({ mc: '26.3', ...v, mod: mod2 })), /^package pl\.modkreator\.mod2;[\s\S]*MOD_ID = "modkreator_2"/);

// Gradle z mirrora na GitHubie z sumą SHA-256 (services.gradle.org dawał 502/503).
const wrapper = 'distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.2-bin.zip\nnetworkTimeout=10000\nretries=0\nzipStorePath=wrapper/dists\n';
const w = wrapperProps(wrapper, 'ab'.repeat(32));
assert.match(w, /^distributionUrl=https\\:\/\/github\.com\/gradle\/gradle-distributions\/releases\/download\/v9\.8\.2\/gradle-9\.8\.2-bin\.zip$/m);
assert.match(w, /^distributionSha256Sum=(ab){32}$/m);
assert.match(w, /^networkTimeout=120000$/m);
assert.match(w, /^retries=3$/m);
assert.match(w, /^zipStorePath=wrapper\/dists$/m);
assert.doesNotMatch(wrapperProps(wrapper, null), /distributionSha256Sum/);
assert.strictEqual(wrapperProps('foo=1\n', 'x'), 'foo=1\n');

assert.strictEqual(pickJar([
  { name: 'modkreator_mod-1.0.0-sources.jar', mtime: 3 }, { name: 'modkreator_mod-0.9.jar', mtime: 1 },
  { name: 'modkreator_mod-1.0.0.jar', mtime: 2 }, { name: 'notes.txt', mtime: 4 }]), 'modkreator_mod-1.0.0.jar');
assert.strictEqual(pickJar([]), null);

const profiles = { profiles: { a: { lastVersionId: '26.3' }, f: { lastVersionId: 'fabric-loader-0.20.1-26.3', lastUsed: '2020-01-01T00:00:00.000Z' } } };
assert.strictEqual(selectProfile(profiles, 'fabric-loader-0.20.1-26.3', 'NOW'), true);
assert.strictEqual(profiles.profiles.f.lastUsed, 'NOW');
assert.strictEqual(profiles.profiles.a.lastUsed, undefined);
assert.strictEqual(selectProfile(null, 'x'), false);

// Kilka modów na kopii userData: lista, aktywny, zaznaczone; instalacja tylko zaznaczonych.
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-mod-'));
  const base = path.join(tmp, 'userData'), mods = path.join(tmp, 'mc', 'mods');
  const fakeMod = async (id, name, jar) => { // projekt z gitem i zbudowanym jarem (nowszym niż commit)
    const dir = modDir(id, base);
    fs.mkdirSync(path.join(dir, 'build', 'libs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/main/resources'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/main/resources/fabric.mod.json'),
      JSON.stringify({ id, name, entrypoints: { main: [`pl.modkreator.x.ModKreatorMod`] } }));
    fs.writeFileSync(path.join(dir, 'gradle.properties'), 'fabric_api_version=0.165.2+26.3\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'build/\n');
    await git(dir, 'init -q'); await git(dir, 'config user.name t'); await git(dir, 'config user.email t@t');
    await git(dir, 'add -A'); await git(dir, 'commit -q -m "Nowy mod"');
    for (const f of [`${jar}.jar`, `${jar}-sources.jar`]) fs.writeFileSync(path.join(dir, 'build', 'libs', f), id);
    fs.writeFileSync(path.join(dir, 'build', 'modkreator-head'), (await git(dir, 'rev-parse HEAD')).trim()); // jar z tej wersji
  };
  const cfg = { minecraftDir: path.join(tmp, 'mc'), javaHome: 'x' };
  assert.deepStrictEqual(await list(base, cfg), []);
  await fakeMod('modkreator_mod', 'Mój mod', 'modkreator_mod-1.0.0');
  await fakeMod('modkreator_2', 'Kwiatki', 'modkreator_2-1.0.0');
  assert.strictEqual(modDir('modkreator_mod', base), path.join(base, 'mod'));
  assert.strictEqual(modDir('modkreator_2', base), path.join(base, 'mods', 'modkreator_2'));
  // Nazwa zastępcza („Mój mod”) → nazwa pierwszej rzeczy w modzie; pod nazwą – co jest w modzie.
  const lang = path.join(modDir('modkreator_mod', base), 'src/main/resources/assets/modkreator_mod/lang');
  fs.mkdirSync(lang, { recursive: true });
  fs.writeFileSync(path.join(lang, 'pl_pl.json'), JSON.stringify({ 'item.modkreator_mod.miecz': 'Miecz z kraterem', 'block.modkreator_mod.lawa': 'Lawowy blok', 'itemGroup.x': 'Zakładka' }));
  { const d = modDir('modkreator_mod', base); await git(d, 'add -A'); await git(d, 'commit -q -m miecz');
    fs.writeFileSync(path.join(d, 'build', 'modkreator-head'), (await git(d, 'rev-parse HEAD')).trim()); }
  let l = await list(base, cfg);
  assert.deepStrictEqual(l.map(m => [m.id, m.name, m.active, m.selected, m.own]),
    [['modkreator_mod', 'Miecz z kraterem', true, true, true], ['modkreator_2', 'Kwiatki', false, false, true]]);
  assert.deepStrictEqual(l[0].things, ['Miecz z kraterem', 'Lawowy blok']);
  activate('modkreator_2', base);
  select('modkreator_2', true, base);
  assert.strictEqual(activeId(base), 'modkreator_2');
  assert.throws(() => activate('modkreator_9', base), /Nie ma moda/);

  // Folder mods gry: stare jary modów dziecka, Fabric API, mody z internetu (jar z fabric.mod.json, wyłączony .disabled).
  const zip = (name, data) => { // najprostszy zip (stored) – jak .jar
    const n = Buffer.from(name), d = Buffer.from(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(d.length, 18); local.writeUInt32LE(d.length, 22); local.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt32LE(d.length, 20); cen.writeUInt32LE(d.length, 24); cen.writeUInt16LE(n.length, 28);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + d.length, 16);
    return Buffer.concat([local, n, d, cen, n, end]);
  };
  fs.mkdirSync(mods, { recursive: true });
  for (const f of ['modkreator_mod-0.9.jar', 'modkreator_7-1.0.0.jar', 'fabric-api-0.165.2+26.3.jar']) fs.writeFileSync(path.join(mods, f), 'x');
  fs.writeFileSync(path.join(mods, 'sodium-0.6.jar'), zip('fabric.mod.json', JSON.stringify({ id: 'sodium', name: 'Sodium', description: 'Szybsza gra' })));
  fs.writeFileSync(path.join(mods, 'mapa.jar.disabled'), zip('fabric.mod.json', JSON.stringify({ id: 'mapa', name: 'Minimapa' })));
  fs.writeFileSync(path.join(mods, 'notatki.txt'), 'x');
  l = await list(base, cfg);
  assert.deepStrictEqual(l.filter(m => !m.own).map(m => [m.id, m.name, m.selected, m.things.join()]),
    [['ext:mapa.jar', 'Minimapa', false, ''], ['ext:sodium-0.6.jar', 'Sodium', true, 'Szybsza gra']]);

  // Zagraj (install): zaznaczone mody dziecka w grze, odznaczone i stare usunięte; mody z internetu wg zaznaczenia.
  const etas = [];
  await install((t, d, eta) => typeof eta === "number" && etas.push(eta), cfg, base);
  assert.deepStrictEqual(etas, [2]); // nic do budowania – tylko kopiowanie
  assert.deepStrictEqual(fs.readdirSync(mods).sort(), ['fabric-api-0.165.2+26.3.jar', 'mapa.jar.disabled', 'modkreator_2-1.0.0.jar', 'modkreator_mod-1.0.0.jar', 'notatki.txt', 'sodium-0.6.jar']);
  select('modkreator_mod', false, base);
  select('ext:sodium-0.6.jar', false, base);
  select('ext:mapa.jar', true, base);
  await install(undefined, cfg, base);
  assert.deepStrictEqual(fs.readdirSync(mods).sort(), ['fabric-api-0.165.2+26.3.jar', 'mapa.jar', 'modkreator_2-1.0.0.jar', 'notatki.txt', 'sodium-0.6.jar.disabled']);
  assert.deepStrictEqual((await list(base, cfg)).map(m => [m.id, m.selected]),
    [['modkreator_mod', false], ['modkreator_2', true], ['ext:mapa.jar', true], ['ext:sodium-0.6.jar', false]]);

  // Jar z innej wersji moda (np. po przywróceniu starszej zmiany) jest budowany od nowa, choć jest „nowszy”.
  const d1 = modDir('modkreator_mod', base);
  fs.writeFileSync(path.join(d1, 'build', 'modkreator-head'), 'inna-wersja');
  select('modkreator_mod', true, base);
  await assert.rejects(install(undefined, { ...cfg, javaHome: null }, base), /Brak Javy/); // próbuje budować
  select('modkreator_mod', false, base);
  fs.writeFileSync(path.join(d1, 'build', 'modkreator-head'), (await git(d1, 'rev-parse HEAD')).trim());

  // Kosz: mod dziecka (projekt + jego jar w grze) i mod z internetu trafiają do userData/kosz.
  assert.match(await remove('modkreator_2', base, cfg), /Usunięte: „Kwiatki”/);
  assert.ok(!fs.existsSync(modDir('modkreator_2', base)));
  assert.ok(!fs.existsSync(path.join(mods, 'modkreator_2-1.0.0.jar')));
  assert.strictEqual(activeId(base), 'modkreator_mod'); // usunięty był aktywny
  assert.match(await remove('ext:sodium-0.6.jar', base, cfg), /Sodium/);
  assert.deepStrictEqual(fs.readdirSync(mods).sort(), ['fabric-api-0.165.2+26.3.jar', 'mapa.jar', 'notatki.txt']);
  assert.strictEqual(fs.readdirSync(path.join(base, 'kosz')).length, 2);
  assert.deepStrictEqual((await list(base, cfg)).map(m => m.id), ['modkreator_mod', 'ext:mapa.jar']);
  // Nowsze Fabric API dla tej samej gry zostaje (bez pobierania starszego).
  select('modkreator_mod', true, base);
  fs.renameSync(path.join(mods, 'fabric-api-0.165.2+26.3.jar'), path.join(mods, 'fabric-api-0.166.0+26.3.jar'));
  await install(undefined, cfg, base);
  assert.ok(fs.existsSync(path.join(mods, 'fabric-api-0.166.0+26.3.jar')));
  assert.ok(!fs.existsSync(path.join(mods, 'fabric-api-0.165.2+26.3.jar')));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
