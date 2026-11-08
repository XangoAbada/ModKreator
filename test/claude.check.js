// Szybki test pętli tworzenia (podmieniony Claude i build): node test/claude.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { change, parseResult, plain } = require('../src/claude');
const { git, undo } = require('../src/mod');

assert.deepStrictEqual(parseResult('{"type":"result","is_error":false,"result":"Masz miecz!","session_id":"s1"}\n'),
  { text: 'Masz miecz!', session: 's1' });
assert.deepStrictEqual(parseResult('[{"type":"system","session_id":"s2"},{"type":"result","is_error":false,"result":"Hej","session_id":"s2"}]\n'),
  { text: 'Hej', session: 's2' }); // "verbose": true w ustawieniach Claude'a
assert.throws(() => parseResult('{"is_error":true,"result":"Not logged in"}'), /Not logged in/);
assert.throws(() => parseResult('[{"type":"system"}]'), /nie odpowiedział/);
assert.strictEqual(plain('**Gotowe!**\nMiecz jest w zakładce `Walka`.'), 'Gotowe! Miecz jest w zakładce Walka.');

const gradleError = Object.assign(new Error('Gradle'), { buildLog: 'error: cannot find symbol FireSword' });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-claude-'));
  await git(dir, 'init -q');
  await git(dir, 'config user.name t');
  await git(dir, 'config user.email t@t');
  fs.writeFileSync(path.join(dir, 'Mod.java'), 'v1');
  await git(dir, 'add -A');
  await git(dir, 'commit -q -m "Nowy mod"');

  // Udana zmiana z jedną naprawą: Claude dostaje błąd w tej samej sesji, potem commit i instalacja.
  const prompts = [];
  let builds = 0, installs = 0;
  const claude = async (prompt, d, session) => {
    prompts.push([prompt, session]);
    fs.writeFileSync(path.join(d, 'Mod.java'), prompts.length === 1 ? 'zepsute' : 'v2');
    return { text: '**Masz** ognisty miecz!', session: 's1' };
  };
  const build = async () => { if (builds++ === 0) throw gradleError; };
  const install = async () => { installs++; };
  const reply = await change('chcę miecz, który "strzela" ogniem', undefined, { dir, claude, build, install });
  assert.strictEqual(reply, 'Masz ognisty miecz!');
  assert.match(prompts[0][0], /chcę miecz, który "strzela" ogniem/);
  assert.match(prompts[1][0], /cannot find symbol FireSword/);
  assert.strictEqual(prompts[1][1], 's1');
  assert.deepStrictEqual([builds, installs], [2, 1]);
  assert.strictEqual(await git(dir, 'log -1 --format=%s'), 'chcę miecz, który "strzela" ogniem');
  assert.strictEqual(await git(dir, 'status --porcelain'), '');

  // Build ciągle pada: po MAX_FIXES naprawach zmiana jest wycofana, bez commita.
  const broken = async (prompt, d) => { fs.writeFileSync(path.join(d, 'Nowy.java'), 'x'); fs.writeFileSync(path.join(d, 'Mod.java'), 'zepsute'); return { text: 'ok', session: 's2' }; };
  const failing = async () => { throw gradleError; };
  assert.match(await change('tęczowy blok', undefined, { dir, claude: broken, build: failing, install }), /poproś dorosłego/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Mod.java'), 'utf8'), 'v2');
  assert.ok(!fs.existsSync(path.join(dir, 'Nowy.java')));
  assert.strictEqual(await git(dir, 'rev-list --count HEAD'), '2');

  // Pytanie bez zmian w plikach: bez builda i commita.
  builds = 0;
  assert.strictEqual(await change('co to creeper?', undefined, { dir, claude: async () => ({ text: 'Zielony stwór.' }), build, install }), 'Zielony stwór.');
  assert.strictEqual(builds, 0);

  // Cofnij nie rusza pierwszego commita „Nowy mod” (pełne cofnięcie z buildem – sprawdzone na prawdziwym modzie).
  await git(dir, 'reset -q --hard HEAD~1');
  assert.strictEqual(await undo(undefined, dir), 'Nie ma nic do cofnięcia.');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Mod.java'), 'utf8'), 'v1');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
