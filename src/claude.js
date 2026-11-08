// Pętla tworzenia (T-10): prośba dziecka → Claude Code w folderze moda → build (z naprawą błędów) → git commit → instalacja.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readConfig } = require('./tools');
const mod = require('./mod');

const CLAUDE_EXE = path.join(os.homedir(), '.local', 'bin', 'claude.exe'); // natywny instalator (jak w tools.js)
const MAX_FIXES = 2; // tyle razy Claude dostaje błąd builda do naprawy, potem zmiana jest wycofywana
const BUILD = './gradlew.bat build --console=plain';
// Claude sam edytuje pliki w folderze moda (acceptEdits) i może tylko budować; reszta jest blokowana bez pytania.
const TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Bash(./gradlew.bat build*)', 'PowerShell(./gradlew.bat build*)', 'PowerShell(.\\gradlew.bat build*)'];

const SYSTEM = `Jesteś pomocnikiem w aplikacji ModKreator. Dziecko w wieku 8–10 lat tworzy swój mod do Minecrafta (Java Edition, Fabric) i mówi, co chce dodać. Prośba jest rozpoznana z mowy, więc może mieć błędy – zgadnij, o co chodzi.

Pracujesz w folderze moda: projekt Gradle, id moda modkreator_mod, pakiet pl.modkreator.mod, klasa startowa ModKreatorMod. Wersje gry i bibliotek są w gradle.properties – pisz kod dokładnie pod tę wersję; gdy nie znasz jej API, sprawdź w internecie (np. docs.fabricmc.net).

Zasady:
- Rób wszystko sam, o nic nie pytaj. Gdy prośba jest niejasna albo bardzo duża, zrób prostą, fajną wersję, która działa.
- Możesz dodawać przedmioty, bloki, receptury, efekty i inne rzeczy. Każdy nowy przedmiot i blok ma: rejestrację, model, nazwę po polsku i angielsku (assets/modkreator_mod/lang/pl_pl.json i en_us.json) i miejsce w zakładce trybu kreatywnego. Bez własnej tekstury użyj w modelu podobnej tekstury z Minecrafta (np. minecraft:item/diamond_sword).
- Nie psuj tego, co już jest w modzie. Nie zmieniaj id moda, plików gradlew i gradle/wrapper ani niczego poza tym folderem. Nie rób commitów – robi je aplikacja.
- Treści przyjazne dzieciom. Gdy prośba nie pasuje dla dziecka, zrób coś podobnego, ale miłego.
- Po zmianach sprawdź build poleceniem: ${BUILD} (pierwszy build trwa kilka minut, daj mu do 10 minut) i napraw błędy.
- Gdy prośba nie dotyczy moda (np. pytanie), tylko krótko odpowiedz i nic nie zmieniaj.

Twoja ostatnia wiadomość jest czytana dziecku na głos: 1–2 krótkie, wesołe zdania prostym językiem po polsku, bez kodu, nazw plików i formatowania. Powiedz, co jest nowego i jak to znaleźć w grze. Gdy czegoś nie da się zrobić bez dorosłego (np. trzeba coś zainstalować), powiedz: „Poproś dorosłego o pomoc”.`;

const askPrompt = request => `Dziecko mówi: „${request}”`;
const fixPrompt = log => `Aplikacja zbudowała mod i build się nie udał. Napraw błędy, nie psując reszty. Dziecko nie wie o błędzie – na koniec znowu powiedz mu 1–2 zdaniami tylko, co jest nowego i jak to znaleźć w grze.\n\nKoniec logu Gradle'a:\n${log}`;

// Wynik `claude -p --output-format json` → { text, session }. Obiekt „result”, a przy "verbose": true
// w ustawieniach użytkownika – tablica wszystkich wiadomości z „result” na końcu.
function parseResult(out) {
  let r = JSON.parse(out.trim());
  if (Array.isArray(r)) r = r.findLast(m => m.type === 'result');
  if (!r || r.is_error || typeof r.result !== 'string') throw new Error(r?.result || r?.subtype || 'Claude nie odpowiedział.');
  return { text: r.result, session: r.session_id };
}

// Lektor nie powinien czytać gwiazdek i kratek z markdowna.
const plain = text => text.replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();

// Jedno wywołanie Claude Code w folderze moda; `session` – ciąg dalszy tej samej rozmowy (naprawa błędów).
function askClaude(prompt, dir, session) {
  const { javaHome } = readConfig();
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
    '--allowedTools', ...TOOLS, '--append-system-prompt', SYSTEM];
  if (session) args.push('--resume', session);
  return new Promise((resolve, reject) => {
    const p = spawn(fs.existsSync(CLAUDE_EXE) ? CLAUDE_EXE : 'claude', args, {
      cwd: dir, windowsHide: true, timeout: 30 * 60000,
      env: javaHome ? { ...process.env, JAVA_HOME: javaHome } : process.env, // JAVA_HOME dla builda Claude'a
    });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => {
      try { resolve(parseResult(out)); }
      catch (e) { reject(new Error(`Claude Code (kod ${code}): ${e.message}\n${err}${out}`.trim())); }
    });
    p.stdin.end(prompt); // prośba przez stdin – bez cytowania w linii poleceń
  });
}

// Wraca do ostatniej udanej zmiany (zbudowane pliki w build/ są w .gitignore, zostają).
const revert = async dir => { await mod.git(dir, 'reset -q --hard'); await mod.git(dir, 'clean -fdq'); };

// Prośba dziecka → zmiana w modzie. Zwraca krótką odpowiedź dla dziecka (do lektora).
async function change(request, say = () => {}, { dir, claude = askClaude, build = mod.build, install = mod.install } = {}) {
  dir = dir || await mod.create(say);
  say('Myślę, jak to zrobić… To może chwilę potrwać.');
  let text, session;
  try {
    ({ text, session } = await claude(askPrompt(request), dir));
    if (!(await mod.git(dir, 'status --porcelain'))) return plain(text); // tylko rozmowa, mod bez zmian
    for (let fix = 0; ; fix++) {
      try { await build(say, dir); break; } catch (e) {
        if (!e.buildLog) throw e; // np. brak Javy – tego Claude nie naprawi
        if (fix === MAX_FIXES) {
          await revert(dir);
          return 'Tym razem nie udało mi się tego zbudować. Powiedz to trochę inaczej albo poproś dorosłego o pomoc.';
        }
        say('Poprawiam mały błąd…');
        ({ text, session } = await claude(fixPrompt(e.buildLog), dir, session));
      }
    }
    // ponytail: wiadomość z pliku, bo git() idzie przez cmd.exe, a tekst dziecka może mieć cudzysłowy
    fs.writeFileSync(path.join(dir, '.git', 'MODKREATOR_MSG'), request);
    await mod.git(dir, 'add -A');
    await mod.git(dir, 'commit -q -F .git/MODKREATOR_MSG');
  } catch (e) {
    await revert(dir);
    throw e;
  }
  try { await install(say, dir); }
  catch (e) { console.error(e); return `${plain(text)} Zamknij Minecrafta i kliknij „Zagraj”, żeby to wypróbować.`; }
  return plain(text);
}

module.exports = { change, askClaude, parseResult, plain, SYSTEM };
