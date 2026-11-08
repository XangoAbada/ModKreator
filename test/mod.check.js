// Szybki test logiki moda dziecka: node test/mod.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickVersions, templateVars, fill, pickJar, selectProfile, install } = require('../src/mod');

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

assert.strictEqual(pickJar([
  { name: 'modkreator_mod-1.0.0-sources.jar', mtime: 3 }, { name: 'modkreator_mod-0.9.jar', mtime: 1 },
  { name: 'modkreator_mod-1.0.0.jar', mtime: 2 }, { name: 'notes.txt', mtime: 4 }]), 'modkreator_mod-1.0.0.jar');
assert.strictEqual(pickJar([]), null);

const profiles = { profiles: { a: { lastVersionId: '26.3' }, f: { lastVersionId: 'fabric-loader-0.20.1-26.3', lastUsed: '2020-01-01T00:00:00.000Z' } } };
assert.strictEqual(selectProfile(profiles, 'fabric-loader-0.20.1-26.3', 'NOW'), true);
assert.strictEqual(profiles.profiles.f.lastUsed, 'NOW');
assert.strictEqual(profiles.profiles.a.lastUsed, undefined);
assert.strictEqual(selectProfile(null, 'x'), false);

// Instalacja na kopii: stary mod i stare Fabric API znikają, inne mody zostają.
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-mod-'));
  const mod = path.join(tmp, 'mod'), mods = path.join(tmp, 'mc', 'mods');
  fs.mkdirSync(path.join(mod, 'build', 'libs'), { recursive: true });
  fs.mkdirSync(mods, { recursive: true });
  fs.writeFileSync(path.join(mod, 'gradle.properties'), 'fabric_api_version=0.165.2+26.3\n');
  fs.writeFileSync(path.join(mod, 'build', 'libs', 'modkreator_mod-1.0.0.jar'), 'new');
  fs.writeFileSync(path.join(mod, 'build', 'libs', 'modkreator_mod-1.0.0-sources.jar'), 'src');
  for (const f of ['modkreator_mod-0.9.jar', 'fabric-api-0.165.2+26.3.jar', 'sodium.jar']) fs.writeFileSync(path.join(mods, f), 'x');
  await install(undefined, mod, { minecraftDir: path.join(tmp, 'mc') });
  assert.deepStrictEqual(fs.readdirSync(mods).sort(), ['fabric-api-0.165.2+26.3.jar', 'modkreator_mod-1.0.0.jar', 'sodium.jar']);
  assert.strictEqual(fs.readFileSync(path.join(mods, 'modkreator_mod-1.0.0.jar'), 'utf8'), 'new');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
