// Szybki test logiki kreatora: node test/tools.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { minecraftVersions, jdkMajor, pickJdk, whisperVariant } = require('../src/tools');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'));
const ver = (id, json) => {
  fs.mkdirSync(path.join(tmp, 'mc', 'versions', id), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'mc', 'versions', id, `${id}.json`), JSON.stringify({ id, ...json }));
};
ver('1.21.4', { type: 'release', releaseTime: '2024-12-03T10:12:57+00:00', javaVersion: { majorVersion: 21 } });
ver('26.3', { type: 'release', releaseTime: '2026-09-01T10:00:00+00:00', javaVersion: { majorVersion: 25 } });
ver('26.4-snapshot-7', { type: 'snapshot', releaseTime: '2026-11-01T10:00:00+00:00' });
ver('fabric-loader-0.17.0-26.3', { type: 'release', releaseTime: '2026-09-02T10:00:00+00:00', inheritsFrom: '26.3' });
assert.deepStrictEqual(minecraftVersions(path.join(tmp, 'mc')), [{ id: '26.3', java: 25 }, { id: '1.21.4', java: 21 }]);
assert.deepStrictEqual(minecraftVersions(path.join(tmp, 'nope')), []);

const jdk = (name, release, javac = true) => {
  const home = path.join(tmp, name);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  if (javac) fs.writeFileSync(path.join(home, 'bin', 'javac.exe'), '');
  fs.writeFileSync(path.join(home, 'release'), `JAVA_VERSION="${release}"\n`);
  return home;
};
const j8 = jdk('j8', '1.8.0_402'), j21 = jdk('j21', '21.0.9'), j25 = jdk('j25', '25.0.1'), jre21 = jdk('jre21', '21.0.9', false);
assert.strictEqual(jdkMajor(j8), 8);
assert.strictEqual(jdkMajor(jre21), 0);
assert.strictEqual(pickJdk([j8, j25, j21, jre21], 21), j21);
assert.strictEqual(pickJdk([j8, j21, j25], 25), j25);
assert.strictEqual(pickJdk([j8, jre21], 21), null);

const cpu = whisperVariant(false, 'W'), gpu = whisperVariant(true, 'W');
assert.strictEqual(cpu.id, 'cpu');
assert.match(cpu.binUrl, /whisper-bin-x64\.zip$/);
assert.match(cpu.modelUrl, /ggml-small\.bin$/);
assert.strictEqual(cpu.cli, path.join('W', 'Release', 'whisper-cli.exe')); // jak przed T-88: stare instalacje dalej pasują
assert.strictEqual(gpu.id, 'cuda');
assert.match(gpu.binUrl, /whisper-bin-win-cuda-12\.4\.0-x64\.zip$/);
assert.match(gpu.modelUrl, /ggml-large-v3-turbo/);
assert.strictEqual(gpu.cli, path.join('W', 'cuda', 'Release', 'whisper-cli.exe'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok');
