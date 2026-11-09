// Szybki test pętli tworzenia (podmieniony Claude i build): node test/claude.check.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { change, parseResult, plain, system, tools, pending, forget } = require('../src/claude');
const { git } = require('../src/mod');

assert.deepStrictEqual(parseResult('{"type":"result","is_error":false,"result":"Masz miecz!","session_id":"s1"}\n'),
  { text: 'Masz miecz!', session: 's1' });
assert.deepStrictEqual(parseResult('[{"type":"system","session_id":"s2"},{"type":"result","is_error":false,"result":"Hej","session_id":"s2"}]\n'),
  { text: 'Hej', session: 's2' }); // "verbose": true w ustawieniach Claude'a
assert.throws(() => parseResult('{"is_error":true,"result":"Not logged in"}'), /Not logged in/);
assert.throws(() => parseResult('[{"type":"system"}]'), /nie odpowiedział/);
assert.strictEqual(plain('**Gotowe!**\nMiecz jest w zakładce `Walka`.'), 'Gotowe! Miecz jest w zakładce Walka.');

// javap/jar: pełna ścieżka z ukośnikami w regule Bash i ta sama postać w prompcie (Claude Code nie widzi JDK w PATH).
const jdk = path.join('C:', 'J', 'jdk');
assert.ok(tools(jdk).includes('Bash("C:/J/jdk/bin/javap.exe" *)'));
assert.ok(tools(jdk).includes('Bash("C:/J/jdk/bin/jar.exe" tf *)'));
assert.ok(!tools(null).some(t => /javap|jar\.exe/.test(t)));
assert.match(system(jdk), /"C:\/J\/jdk\/bin\/javap\.exe" -cp/);
assert.doesNotMatch(system(jdk), /undefined/);
// Prompt dla kolejnego moda: jego id, pakiet i nazwa (każdy mod osobno, mogą być razem w grze).
const p2 = system(jdk, { id: 'modkreator_2', pkg: 'pl.modkreator.mod2', name: 'Kwiatki' });
assert.match(p2, /id moda modkreator_2, pakiet pl\.modkreator\.mod2/);
assert.match(p2, /assets\/modkreator_2\/items/);
assert.match(p2, /nazywa się „Kwiatki”/);
assert.doesNotMatch(p2, /modkreator_mod|pl\.modkreator\.mod\b/);

const gradleError =Object.assign(new Error('Gradle'), { buildLog: 'error: cannot find symbol FireSword' });

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
  const reply = await change('chcę miecz, który "strzela" ogniem', undefined, { dir, claude, build, install, select: () => {} });
  assert.strictEqual(reply, 'Masz ognisty miecz! Kliknij „Zagraj”, żeby to wypróbować.');
  assert.match(prompts[0][0], /chcę miecz, który "strzela" ogniem/);
  assert.match(prompts[1][0], /cannot find symbol FireSword/);
  assert.strictEqual(prompts[1][1], 's1');
  assert.deepStrictEqual([builds, installs], [2, 1]);
  assert.strictEqual(await git(dir, 'log -1 --format=%s'), 'chcę miecz, który "strzela" ogniem');
  assert.strictEqual(await git(dir, 'status --porcelain'), '');

  // Build ciągle pada: po MAX_FIXES naprawach zmiana jest wycofana, bez commita.
  const broken = async (prompt, d) => { fs.writeFileSync(path.join(d, 'Nowy.java'), 'x'); fs.writeFileSync(path.join(d, 'Mod.java'), 'zepsute'); return { text: 'ok', session: 's2' }; };
  const failing = async () => { throw gradleError; };
  assert.match(await change('tęczowy blok', undefined, { dir, claude: broken, build: failing, install, select: () => {} }), /poproś dorosłego/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Mod.java'), 'utf8'), 'v2');
  assert.ok(!fs.existsSync(path.join(dir, 'Nowy.java')));
  assert.strictEqual(await git(dir, 'rev-list --count HEAD'), '2');

  // Pytanie bez zmian w plikach: bez builda i commita.
  builds = 0;
  assert.strictEqual(await change('co to creeper?', undefined, { dir, claude: async () => ({ text: 'Zielony stwór.' }), build, install, select: () => {} }), 'Zielony stwór.');
  assert.strictEqual(builds, 0);

  // Dopytanie: Claude pyta (bez zmian), odpowiedź dziecka idzie do tej samej sesji, commit ma obie wypowiedzi.
  const seen = [];
  const asking = async (prompt, d, session) => {
    seen.push(session);
    if (seen.length === 1) return { text: 'Jaki ma być kolor?', session: 'q1' };
    fs.writeFileSync(path.join(d, 'Blok.java'), 'czerwony');
    return { text: 'Masz czerwony blok!', session: 'q1' };
  };
  assert.strictEqual(await change('nowy blok', undefined, { dir, claude: asking, build: async () => {}, install, select: () => {} }), 'Jaki ma być kolor?');
  assert.strictEqual(pending(), true); // pytanie bez odpowiedzi = pomysł niezapisany
  assert.match(await change('czerwony', undefined, { dir, claude: asking, build: async () => {}, install, select: () => {} }), /^Masz czerwony blok!/);
  assert.deepStrictEqual(seen, [undefined, 'q1']);
  assert.strictEqual(pending(), false);
  assert.strictEqual(await git(dir, 'log -1 --format=%s'), 'nowy blok – czerwony');
  await git(dir, 'reset -q --hard HEAD~1');
  // Po zmianie w modzie nowa prośba zaczyna nową sesję.
  await change('hej', undefined, { dir, claude: async (p, d, session) => { seen.push(session); return { text: 'Hej!' }; }, build, install, select: () => {} });
  assert.strictEqual(seen[2], undefined);

  // Nowy pomysł (pusty mod): prośba o pytania doprecyzowujące; odpowiedź dziecka idzie już bez dopisków.
  {
    const got = [];
    const q = async (prompt, d, session) => {
      got.push(prompt);
      if (!session) return { text: 'Jak ma wyglądać? a) złoty b) tęczowy', session: 'n1' };
      fs.writeFileSync(path.join(d, 'Smok.java'), 's');
      return { text: 'Masz smoka!', session: 'n1' };
    };
    const opts = { dir, claude: q, build: async () => {}, install, select: () => {}, describe: async () => [] };
    assert.match(await change('chcę smoka', undefined, opts), /a\) złoty/);
    assert.match(got[0], /nowy pomysł na mod[\s\S]*1–3 krótkie pytania/);
    assert.match(await change('tęczowy', undefined, opts), /^Masz smoka!/);
    assert.strictEqual(got[1], 'Dziecko mówi: „tęczowy”');
    await git(dir, 'reset -q --hard HEAD~1');
  }

  // Nowa rzecz w niepustym modzie: Claude odpisuje NOWY_MOD → aplikacja zakłada nowy mod i tam robi tę samą prośbę.
  {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-claude2-'));
    await git(other, 'init -q'); await git(other, 'config user.name t'); await git(other, 'config user.email t@t');
    fs.writeFileSync(path.join(other, 'Mod.java'), 'pusty'); await git(other, 'add -A'); await git(other, 'commit -q -m "Nowy mod"');
    const calls = [];
    const splitter = async (prompt, d) => {
      calls.push([prompt, d]);
      if (d === dir) return { text: 'NOWY_MOD', session: 'x' };
      fs.writeFileSync(path.join(d, 'Fontanna.java'), 'f');
      return { text: 'Masz fontannę!', session: 'y' };
    };
    const before = await git(dir, 'rev-parse HEAD');
    assert.match(await change('chcę fontannę', undefined, { dir, claude: splitter, build: async () => {}, install, select: () => {},
      describe: async () => ['Ognisty miecz'], fresh: async () => other }), /^Masz fontannę!/);
    assert.match(calls[0][0], /jest już: Ognisty miecz[\s\S]*NOWY_MOD/);
    assert.strictEqual(calls[1][1], other);
    assert.doesNotMatch(calls[1][0], /jest już/); // w nowym modzie zwykła prośba
    assert.strictEqual(await git(dir, 'rev-parse HEAD'), before); // stary mod bez zmian
    assert.strictEqual(await git(other, 'log -1 --format=%s'), 'chcę fontannę');
    fs.rmSync(other, { recursive: true, force: true });
  }

  // Minecraft trzyma pliki moda: zmiana zapisana, dziecko dostaje wskazówkę, żeby zamknąć grę.
  const edit = async (p, d) => { fs.writeFileSync(path.join(d, 'Inny.java'), 'x'); return { text: 'Masz kilof!' }; };
  const locked = async () => { throw new Error('EBUSY'); };
  assert.match(await change('kilof', undefined, { dir, claude: edit, build: async () => {}, install: locked, select: () => {} }),
    /^Masz kilof! Zamknij Minecrafta/);
  assert.strictEqual(await git(dir, 'log -1 --format=%s'), 'kilof');
  await git(dir, 'reset -q --hard HEAD~1');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
