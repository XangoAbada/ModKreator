// Pętla tworzenia (T-10): prośba dziecka → Claude Code w folderze moda → tekstury od Codexa (T-11) → build (z naprawą błędów) → git commit → instalacja.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readConfig } = require('./tools');
const mod = require('./mod');
const mod_ = mod; // w szablonie promptu `mod` to opis moda
const textures = require('./textures');

const CLAUDE_EXE = path.join(os.homedir(), '.local', 'bin', 'claude.exe'); // natywny instalator (jak w tools.js)
const MAX_FIXES = 2; // tyle razy Claude dostaje błąd builda do naprawy, potem zmiana jest wycofywana
const BUILD = './gradlew.bat build --console=plain';
const GRADLE_HOME = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
// Ścieżka w regule uprawnień Claude Code: C:\x\y → //c/x/y (absolutna).
const rulePath = p => '//' + p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase());
// javap/jar z wykrytego JDK – pełna ścieżka w narzędziu Bash. ponytail: Claude Code buduje PATH powłoki od nowa
// (JDK z PATH procesu nie widać), a w PowerShellu `& "…exe"` wymaga zgody mimo reguły; Bash z pełną ścieżką działa.
const jdkTool = (javaHome, name) => `"${path.join(javaHome, 'bin', name + '.exe').split(path.sep).join('/')}"`;
// Claude sam edytuje pliki w folderze moda (acceptEdits), może budować, podglądać klasy gry (javap, jar tf)
// i czytać cache Gradle'a (jary Minecrafta i Fabric API); reszta jest blokowana bez pytania.
const tools = javaHome => ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', `Read(${rulePath(path.join(GRADLE_HOME, 'caches'))}/**)`,
  'Bash(./gradlew.bat build*)', 'PowerShell(./gradlew.bat build*)', 'PowerShell(.\\gradlew.bat build*)',
  ...(javaHome ? [`Bash(${jdkTool(javaHome, 'javap')} *)`, `Bash(${jdkTool(javaHome, 'jar')} tf *)`] : [])];
const LOOM_MC = path.join(GRADLE_HOME, 'caches', 'fabric-loom', 'minecraftMaven', 'net', 'minecraft');
const FABRIC_API_JARS = path.join(GRADLE_HOME, 'caches', 'modules-2', 'files-2.1', 'net.fabricmc.fabric-api');

// Wiedza z moda „komputery” (D:\Projects\MinecraftMods, 2026-11-08), sprawdzona na Minecrafcie 26.3. Poradniki
// w internecie są tu często nieaktualne, a każdy błąd kompilacji zużywa jedną z MAX_FIXES prób naprawy.
const system = (javaHome, mod = mod_.modInfo('')) => `Jesteś pomocnikiem w aplikacji ModKreator. Dziecko w wieku 8–10 lat tworzy swój mod do Minecrafta (Java Edition, Fabric) i mówi, co chce dodać. Prośba jest rozpoznana z mowy, więc może mieć błędy – zgadnij, o co chodzi.

Pracujesz w folderze moda: projekt Gradle, id moda ${mod.id}, pakiet ${mod.pkg}. Kod wspólny jest w src/main/java (klasa startowa ModKreatorMod), kod tylko dla gry – ekrany, rysowanie, klawisze – w src/client/java (klasa startowa ${mod.pkg}.client.ModKreatorModClient; obie są już w fabric.mod.json). Zasoby są w src/main/resources/assets/${mod.id}/. Wersje gry i bibliotek są w gradle.properties – pisz kod dokładnie pod tę wersję. Mod nazywa się „${mod.name}”; dziecko może mieć kilka modów i w grze mogą być razem, więc nie zmieniaj id moda ani pakietu.

Zasady:
- Pytania doprecyzowujące: przy nowym pomyśle aplikacja poprosi Cię o nie wprost. Wtedy zadaj 1–3 krótkie pytania naraz (np. jak to wygląda, co robi, jak to zdobyć), każde z 2–3 przykładami odpowiedzi do wyboru, i jeszcze nic nie zmieniaj. Nie zasypuj pytaniami – drobne szczegóły wymyśl sam. Po odpowiedzi dziecka już buduj (najwyżej jedna runda pytań); gdy dziecko mówi „nie wiem” albo „wymyśl sam”, wybierz coś fajnego. Gdy prośba jest bardzo duża, zrób prostą, fajną wersję, która działa.
- Możesz dodawać przedmioty, bloki, receptury, efekty i inne rzeczy. Każdy nowy przedmiot i blok ma: rejestrację, model, definicję przedmiotu w assets/${mod.id}/items/<id>.json (bez niej przedmiot ma teksturę „brak tekstury”), a blok także blockstate w blockstates/<id>.json, nazwę po polsku i angielsku (lang/pl_pl.json i en_us.json) i miejsce w trybie kreatywnym.
- Tryb kreatywny: dodawaj rzeczy do zwykłych zakładek Minecrafta, bo własna zakładka ląduje na drugiej stronie i dziecko jej nie znajduje. Bloki do building_blocks albo functional_blocks, narzędzia do tools_and_utilities, broń do combat, jedzenie do food_and_drinks, reszta do ingredients.
- Nie rysuj tekstur (plików PNG): w modelu użyj podobnej tekstury z Minecrafta (model przedmiotu: parent minecraft:item/generated albo minecraft:item/handheld i textures.layer0, np. minecraft:item/diamond_sword; model bloku: np. parent minecraft:block/cube_all i textures.all), a aplikacja sama narysuje nową. Model przedmiotu dla bloku ma tylko parent ${mod.id}:block/<id bloku>.
- W tekstach w grze (nazwy, wiadomości, ekrany) nie używaj emoji – czcionka Minecrafta ich nie ma i pokazują się kwadraciki. Proste symbole jak ☀ ✔ ✉ są w porządku.
- Mod ma się nazywać od tego, co w nim jest: gdy ma jeszcze nazwę „Nowy mod” albo „Mój mod”, przy pierwszej zmianie nadaj mu krótką polską nazwę od głównej rzeczy, np. „Miecz z kraterem”, „Komputer”, „Tęczowe bloki” (pole name w src/main/resources/fabric.mod.json). Jeden mod to jedna rzecz (z tym, co do niej należy) – nowe, inne rzeczy aplikacja zapisuje w osobnych modach.
- Nie psuj tego, co już jest w modzie. Nie zmieniaj id moda, plików gradlew i gradle/wrapper ani niczego poza tym folderem. Nie rób commitów – robi je aplikacja.
- Treści przyjazne dzieciom. Gdy prośba nie pasuje dla dziecka, zrób coś podobnego, ale miłego.
- Po zmianach sprawdź build poleceniem: ${BUILD} (pierwszy build trwa kilka minut, daj mu do 10 minut) i napraw błędy.
- Gdy prośba nie dotyczy moda (np. pytanie), tylko krótko odpowiedz i nic nie zmieniaj.

Minecraft 26.x (sprawdzone na 26.3) zmienił wiele nazw – stare poradniki (1.21 i wcześniej) są tu błędne:
- Gra nie jest obfuskowana, nazwy są oficjalne od Mojanga. Używaj Identifier (Identifier.fromNamespaceAndPath(ModKreatorMod.MOD_ID, "id"), Identifier.withDefaultNamespace("..."), level.dimension().identifier()), nie ResourceLocation.
- Rejestracja: ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, id); Registry.register(BuiltInRegistries.ITEM, key, new Item(new Item.Properties().setId(key))). Blok tak samo, z BlockBehaviour.Properties.of().setId(key); jego przedmiot: new BlockItem(blok, new Item.Properties().setId(itemKey).useBlockDescriptionPrefix()).
- Zakładki: CreativeModeTabEvents.modifyOutputEvent(ResourceKey.create(Registries.CREATIVE_MODE_TAB, Identifier.withDefaultNamespace("tools_and_utilities"))).register(output -> output.accept(PRZEDMIOT)), z pakietu net.fabricmc.fabric.api.creativetab.v1 (własna zakładka: FabricCreativeModeTab.builder()).
- Niektóre przedmioty są zgrupowane po kolorach, np. Items.BED to ColorCollection<Item> – pisz Items.BED.red().
- Czas dnia: level.getOverworldClockTime(), nie getDayTime().
- Sieć: PayloadTypeRegistry.clientboundPlay() / serverboundPlay(). Ekran (GUI) otwiera serwer: blok albo przedmiot wysyła payload do gracza, a klient (ModKreatorModClient) otwiera ekran.
- Ekrany: otwieranie minecraft.gui.setScreen(ekran), bieżący ekran minecraft.gui.screen(). Rysowanie w extractRenderState(GuiGraphicsExtractor g, ...) przez g.fill, g.text, g.centeredText, g.outline – nie ma render(GuiGraphics …). Wejście: keyPressed(KeyEvent) z event.key(), charTyped(CharacterEvent), mouseClicked(MouseButtonEvent, boolean); klawisze z com.mojang.blaze3d.platform.InputConstants.KEY_* (nie ma GLFW). Ekran z pisaniem musi wołać minecraft.textInputManager().startTextInput(this) w init() i stopTextInput(this) w removed() (inaczej charTyped nie działa) i zwracać true z isInputCaptured(). isPauseScreen() ma zwracać false, inaczej serwer gry stoi, dopóki ekran jest otwarty.
- Gdy nie znasz nazwy klasy albo metody, nie zgaduj: sprawdź prawdziwe jary narzędziem Bash, dokładnie w tej postaci (inne polecenia są zablokowane): ${javaHome ? jdkTool(javaHome, 'javap') : 'javap'} -cp "<jar>" net.minecraft.world.item.Items (ścieżki jarów windowsowe, kilka jarów w -cp rozdzielaj średnikiem), a listę klas: ${javaHome ? jdkTool(javaHome, 'jar') : 'jar'} tf "<jar>". Jary Minecrafta 26.x: ${LOOM_MC}\\minecraft-common-deobf\\<wersja>\\minecraft-common-deobf-<wersja>.jar oraz minecraft-clientonly-deobf (klasy tylko dla gry). Jary Fabric API znajdziesz Globem w ${FABRIC_API_JARS}. Jary pojawiają się po pierwszym buildzie – gdy ich brak, najpierw uruchom build. Internet (docs.fabricmc.net) traktuj jako podpowiedź; rozstrzyga javap.

Twoja ostatnia wiadomość jest czytana dziecku na głos: 1–2 krótkie, wesołe zdania prostym językiem po polsku, bez kodu, nazw plików i formatowania. Powiedz, co jest nowego i jak to znaleźć w grze (w której zakładce trybu kreatywnego). Gdy dopytujesz, zadaj tylko te pytania, z przykładami odpowiedzi. Gdy czegoś nie da się zrobić bez dorosłego (np. trzeba coś zainstalować), powiedz: „Poproś dorosłego o pomoc”.`;

// Każda nowa rzecz w osobnym modzie: gdy w modzie już coś jest, Claude odpisuje NEW_MOD zamiast dokładać obcą rzecz.
const NEW_MOD = 'NOWY_MOD';
// Nowy pomysł (pusty mod) – najpierw pytania jak w MinecraftMods; bez tego dopisku Claude prawie zawsze od razu budował.
const ASK_FIRST = `

(Informacja od aplikacji, nie od dziecka: to nowy pomysł na mod. Zanim cokolwiek zrobisz, zadaj dziecku 1–3 krótkie pytania doprecyzowujące z przykładami odpowiedzi i niczego nie zmieniaj. Pomiń pytania tylko wtedy, gdy dziecko już samo opisało, jak to ma wyglądać i działać, albo prosi, żebyś wymyślił sam.)`;
// answering: dziecko odpowiada na pytania Claude'a (ta sama sesja) – bez dopisków, ma już wszystko w rozmowie.
const askPrompt = (request, things = [], answering = false) => `Dziecko mówi: „${request}”` + (answering ? '' : !things.length ? ASK_FIRST : `

(Informacja od aplikacji, nie od dziecka: w tym modzie jest już: ${things.join(', ')}. Każda nowa rzecz ma być w osobnym modzie. Jeśli dziecko chce nową rzecz, inną niż ta w tym modzie, niczego nie zmieniaj i odpowiedz tylko jednym słowem: ${NEW_MOD} – aplikacja założy nowy mod. Jeśli chce zmienić, poprawić albo rozbudować to, co już jest w tym modzie, albo odpowiada na Twoje pytanie, zrób to tutaj.)`);
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
    '--allowedTools', ...tools(javaHome), '--append-system-prompt', system(javaHome, mod.modInfo(dir))];
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

// Rozmowa bez zmian w modzie (np. Claude dopytał o szczegóły): następna prośba idzie do tej samej sesji,
// żeby odpowiedź dziecka („czerwony, świeci”) trafiła do pytania. Po zmianie w modzie zaczynamy od nowa.
let talk = null; // { dir, session, said: [słowa dziecka] } – tylko dla tego samego moda

// Prośba dziecka → zmiana w modzie. Zwraca krótką odpowiedź dla dziecka (do lektora).
async function change(request, say = () => {}, { dir, claude = askClaude, build = mod.build, install = mod.install, paint = textures.paint, select = dir => mod.select(mod.modInfo(dir).id),
  describe = mod.contents, fresh = async say => { await mod.newMod(say); return mod.modDir(mod.activeId()); } } = {}) {
  dir = dir || await mod.create(say);
  say('Myślę, jak to zrobić… To może chwilę potrwać.');
  if (talk && talk.dir !== dir) talk = null; // dziecko przełączyło się na inny mod
  const said = [...(talk?.said || []), request];
  let text, session;
  try {
    ({ text, session } = await claude(askPrompt(request, await describe(dir), !!talk), dir, talk?.session));
    talk = null;
    if (text.includes(NEW_MOD)) { // nowa rzecz → nowy mod (aktywny), ta sama prośba jeszcze raz, już w nim
      await revert(dir);
      dir = await fresh(say);
      say('Zakładam nowy mod… Myślę, jak to zrobić.');
      ({ text, session } = await claude(askPrompt(request), dir)); // nowy, pusty mod → najpierw pytania
    }
    if (!(await mod.git(dir, 'status --porcelain'))) { // tylko rozmowa, mod bez zmian
      if (session) talk = { dir, session, said: said.slice(-3) };
      return plain(text);
    }
    await paint(dir, request, say); // T-11: tekstury od Codexa przed buildem, żeby trafiły do .jar
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
    fs.writeFileSync(path.join(dir, '.git', 'MODKREATOR_MSG'), said.join(' – ')); // z odpowiedziami na pytania
    await mod.git(dir, 'add -A');
    await mod.git(dir, 'commit -q -F .git/MODKREATOR_MSG');
    select(dir); // zmieniony mod jest w grze
  } catch (e) {
    talk = null;
    await revert(dir);
    throw e;
  }
  // Nowość od razu w folderze mods prawdziwej gry; włączony Minecraft trzyma pliki – wtedy prosimy o zamknięcie.
  try { await install(say); }
  catch (e) { console.error(e); return `${plain(text)} Zamknij Minecrafta i kliknij „Zagraj”, żeby to wypróbować.`; }
  return `${plain(text)} Kliknij „Zagraj”, żeby to wypróbować.`;
}

// Niedokończona rozmowa: Claude dopytał i czeka na odpowiedź – pomysł nie jest jeszcze zapisany w modzie.
const pending = () => !!talk;
const forget = () => { talk = null; };

module.exports = { change, askClaude, parseResult, plain, system, tools, pending, forget };
