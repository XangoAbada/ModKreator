# ModKreator

Aplikacja desktopowa (Electron) dla dzieci 8–10 lat do tworzenia modów Minecraft Java/Fabric głosem. Pomysł i decyzje: [IDEA.md](IDEA.md), zadania: [TASKS.md](TASKS.md).

## Uruchomienie

Wymagany Node.js 20+ (Windows).

```
npm install
npm run dev
```

## Build (Windows)

```
npm run build
```

Wynik: `dist/ModKreator 0.1.0.exe` (przenośny plik, uruchamia się bez instalacji) oraz `dist/win-unpacked/ModKreator.exe`.

## Struktura

- `src/main.js` – proces główny, otwiera okno.
- `src/index.html` – trzy ekrany (Start, Rozmowa, Mój mod) i nawigacja między nimi.
- `src/preload.js` – mosty do procesu głównego: `window.tools` (check/install/onProgress), `window.mod` (create/build/install/play/change/list/activate/select/remove/status/newMod/forget/onProgress), `window.voice` (transcribe/speak).
- `src/tools.js` – kreator startowy: sprawdza Minecrafta (+launcher, wersje), JDK, Fabric (+profil), Claude Code (+logowanie), Codex (opcjonalny), whisper.cpp (z kartą NVIDIA – wykrytą przez `nvidia-smi` – build CUDA 12.4 + model large-v3-turbo q8_0; bez karty build CPU + model small), Piper (opcjonalny lektor: piper.exe + głos mc_speech); doinstalowuje brakujące albo podaje instrukcję dla dorosłego.
- `src/voice.js` – słuchanie w procesie głównym: próbki 16 kHz → WAV → `whisper-cli -l pl` → tekst; lektor: tekst przez stdin → `piper.exe --model … --output_file …` → WAV.
- `src/talk.js` – ekran Rozmowa w rendererze: lektor (`speak()`: WAV z Pipera przez AudioContext, zapas `speechSynthesis`) i przycisk „Mów”, pole do pisania z „Wyślij”/Enter (T-13; bez mikrofonu „Mów” jest ukryty) i przełącznik „Lektor wł./wył.” w górnym pasku (wyłączony = `speak()` milczy, wybór w `localStorage`); prośba dziecka idzie do `window.mod.change`.
- `src/mod.js` (+ `src/mod-template/`) – mod dziecka: szablon Fabric, build, lista modów, instalacja, „Zagraj”, kosz.
- `src/claude.js` – pętla tworzenia: prośba → Claude Code w folderze moda → tekstury → build z naprawą błędów → commit → instalacja.
- `src/textures.js` – tekstury pixel-art 16x16 od Codexa dla nowych przedmiotów i bloków.

## Głos

- Lektor: [Piper](https://github.com/rhasspy/piper) (MIT, wydanie 2023.11.14-2, CPU) z głosem `pl_PL-mc_speech-medium` (~63 MB) w `%APPDATA%\ModKreator\piper`, pobierany na ekranie Start („Lektor”, opcjonalny). Krótkie zdanie zaczyna brzmieć po ok. 0,5 s (nowy proces na każdą wypowiedź). Bez Pipera albo gdy zawiedzie: `speechSynthesis` z polskim głosem Windows (Paulina/Adam). Nowa wypowiedź przerywa poprzednią. Czyta odpowiedzi w rozmowie, powitanie i braki na ekranie Start.
- Licencja głosu: nagrania mc_speech są na CC0, ale model dostrojono z angielskiego głosu lessac, którego dane (Blizzard 2013) mają licencję tylko do badań, bez użycia komercyjnego – do domowego, niekomercyjnego użytku przyjmujemy to ryzyko, przed sprzedażą/dystrybucją komercyjną aplikacji trzeba głos wymienić.
- „Mów”: klik zaczyna nagrywanie (maks. 30 s), drugi klik kończy. Nagranie idzie do whisper.cpp lokalnie, bez internetu, a rozpoznany tekst pokazuje się w rozmowie.
- Do użycia przez T-10/T-13 w rendererze: `ask(tekst)` (prośba dziecka do rozmowy → pętla tworzenia T-10) i `say(tekst)` (odpowiedź aplikacji: dymek + lektor). Z preloadu: `window.voice.transcribe(Float32Array)`.

## Mod dziecka (T-9)

`src/mod.js` (+ szablon `src/mod-template/`), w preload `window.mod` (create/build/install/play/test/onProgress).

**Mody dziecka (lista):** każdy mod to osobny projekt Gradle z gitem: pierwszy `%APPDATA%\ModKreator\mod` (id `modkreator_mod`, pakiet `pl.modkreator.mod`), kolejne `%APPDATA%\ModKreator\mods\modkreator_<n>` (pakiet `pl.modkreator.mod<n>`) – szablon ma `@MOD_ID@`/`@PACKAGE@`/`@NAME@` i folder `PKG`. `mods.json` w userData trzyma `active` (ten mod zmienia rozmowa), `selected` (mody dziecka w grze) i `ext` (wybór dla modów spoza ModKreatora). Ekran „Moje mody”: checkbox = w grze, klik w nazwę = ten mod zmienia rozmowa (złota ramka), 🗑️ = do `%APPDATA%\ModKreator\kosz` (z pytaniem; da się odzyskać). Pod nazwą – co jest w modzie (polskie nazwy z `lang/pl_pl.json`). Nazwa: Claude nazywa mod od głównej rzeczy przy pierwszej prośbie (`name` w `fabric.mod.json`); dopóki jest zastępcza („Nowy mod”/„Mój mod”), lista pokazuje nazwę pierwszej rzeczy. Lista skanuje też `<minecraftDir>/mods`: mody spoza ModKreatora (📦, nazwa i opis z `fabric.mod.json` w jarze – własny odczyt zipa) można włączać/wyłączać (`.jar` ↔ `.jar.disabled`) i usuwać; Fabric API jest ukryte. Rozmowa: „Nowy mod” czyści czat; gdy pomysł nie jest zapisany (Claude dopytał i czeka albo zmiany poza commitem – `mod:status`), najpierw pyta; pusty mod nie jest dublowany. Mikrofon to ikonka obok „Wyślij”.

**„Zagraj”** = **install** + **play** (prawdziwa gra, zawsze pełna wersja w launcherze):

- **create** – tylko raz: `%APPDATA%\ModKreator\mod` z szablonu Fabric (id `modkreator_mod`). Układ jak w sprawdzonym modzie „komputery” (`D:\Projects\MinecraftMods`): `splitEnvironmentSourceSets` – kod wspólny w `src/main` (`ModKreatorMod`), tylko klienta w `src/client` (`client.ModKreatorModClient`), obie klasy startowe w `fabric.mod.json`. Wersje dla `minecraftVersion`: loader z meta.fabricmc.net, Fabric API z Modrinth, Loom i Gradle wrapper z gałęzi [fabric-example-mod](https://github.com/FabricMC/fabric-example-mod) dla tej wersji (albo najnowszej). Wrapper pobiera Gradle z mirrora `github.com/gradle/gradle-distributions` z przypiętym `distributionSha256Sum`, `networkTimeout=120000` i `retries=3` (services.gradle.org dawał 502/503). Minecraft 26.x+ bez remapowania, starsze z mapowaniami Mojanga. Potem `git init` + pierwszy commit.
- **build** – `gradlew build` z `JAVA_HOME=javaHome`.
- **Czas oczekiwania:** build zapisuje swój czas (`build/modkreator-buildms`), **install** szacuje z tego, ile potrwa (bez pomiaru: 30 s, gdy Gradle ma Minecrafta w cache, inaczej 300 s; +2 s na kopiowanie, 20 s na Fabric API) i wysyła `eta` w `mod:progress`. Każda dłuższa praca na modach (`mod:busy`) wyłącza „Zagraj”, a przycisk odlicza „Jeszcze ok. N s”.
- **install** – zaznaczone mody dziecka budowane (tylko gdy jar starszy niż ostatni commit) i kopiowane do `<minecraftDir>/mods`; odznaczone i stare jary modów dziecka (`modkreator_*`) usuwane, nawet jeśli wcześniej były w grze; mody spoza ModKreatora włączane/wyłączane wg zaznaczenia; Fabric API zostaje, jeśli jest jakiekolwiek dla tej wersji gry; brakujące Fabric API (ta sama wersja co w modzie) pobierane z maven.fabricmc.net.
- **play** – ustawia profil Fabric jako ostatnio używany (`lastUsed` w `launcher_profiles.json`) i otwiera launcher. Ograniczenie: oficjalny launcher nie umie sam włączyć gry z profilem, dziecko klika „Graj”; gdy launcher był już otwarty, może pokazać inny profil.

## Pętla tworzenia (T-10)

`src/claude.js`, w preload `window.mod.change(tekst)` → odpowiedź dla lektora. Kolejno:

- `claude -p --output-format json` w folderze moda, prośba przez stdin, prompt dla dzieci 8–10 lat w `--append-system-prompt` (prosty język, robi wszystko sam, „poproś dorosłego”, wiedza o API 26.x z moda „komputery”: `Identifier`, `setId`, zwykłe zakładki przez `CreativeModeTabEvents`, `items/*.json`, bez emoji, ekrany). Uprawnienia: `--permission-mode acceptEdits` (edycja plików tylko w folderze moda) i `--allowedTools` – czytanie (także cache Gradle'a z jarami Minecrafta i Fabric API), WebSearch/WebFetch, `./gradlew.bat build` oraz `javap` i `jar tf` z `javaHome` (pełna ścieżka w narzędziu Bash – Claude Code buduje PATH powłoki od nowa, a PowerShell z `&` wymaga zgody); reszta jest odrzucana bez pytania.
- Dopytywanie: gdy pomysł jest niejasny, Claude zadaje 1–3 krótkie pytania z przykładami i nic nie zmienia. Następna prośba idzie wtedy do tej samej sesji (`--resume`), a commit ma wszystkie wypowiedzi („nowy blok – czerwony”). Po zmianie w modzie albo błędzie kolejna prośba zaczyna nową sesję.
- **Każda nowa rzecz = osobny mod:** gdy aktywny mod nie jest pusty, prośba dostaje dopisek, co już w nim jest (`mod.contents`: nazwy z `pl_pl.json` albo prośby z historii). Gdy dziecko chce nową, inną rzecz, Claude nic nie zmienia i odpisuje `NOWY_MOD` – aplikacja zakłada nowy mod (`mod.newMod`, od razu aktywny) i powtarza tam tę samą prośbę. Zmiana, poprawka albo odpowiedź na pytanie zostaje w tym samym modzie.
- Gdy pliki się zmieniły: build; błąd kompilacji wraca do tej samej sesji Claude'a (`--resume`) do naprawy, najwyżej 2 razy. Potem dalej źle albo inny błąd → `git reset --hard` + `git clean`, mod zostaje w ostatnim dobrym stanie.
- Udany build → `git commit` (treść: słowa dziecka) → mod zaznaczony → **install** do `.minecraft/mods`. Gdy gra trzyma plik, odpowiedź mówi „zamknij Minecrafta i kliknij Zagraj”.
- Wszystkie operacje na modzie (`mod:*`) idą w procesie głównym po kolei, jedna kolejka.

## Tekstury (T-11)

`src/textures.js`, wołane z pętli tworzenia po zmianie Claude'a, przed buildem:

- Claude nie rysuje PNG: w modelu nowego przedmiotu/bloku wpisuje podobną teksturę z Minecrafta (np. `minecraft:item/diamond_sword`).
- Każdy nowy (nieśledzony w gicie) model w `models/item|block/` z teksturą spoza moda dostaje własny obrazek: `codex exec` (prompt przez stdin, folder tymczasowy, logowanie ChatGPT, bez klucza API) generuje duży pixel-art (~1254 px, ok. 45 s); przedmioty na magentowym tle, bloki jako kafelek bez tła. Wszystkie obrazki naraz.
- Zmniejszanie w czystym Node (zlib, bez bibliotek): siatka 16x16, każde pole bierze kolor większości (bez rozmycia); u przedmiotów (i roślin z `parent` „cross”) pole, w którym ponad połowa to kolor rogu, jest przezroczyste. Wynik: `textures/<item|block>/<id>.png`, a model wskazuje `modkreator_mod:<item|block>/<id>`. Model przedmiotu dla bloku dostaje teksturę bloku, bez drugiego obrazka.
- Bez Codexa (brak, niezalogowany, limit, błąd): zostaje tekstura z Minecrafta wybrana przez Claude'a – działa od razu i wygląda jak gra, bez kolejnego kodu.

## Konfiguracja wykryta przy starcie

Kreator zapisuje `%APPDATA%\ModKreator\config.json` (dla szablonu moda, T-9):
`minecraftDir`, `minecraftVersion` (najnowsze zainstalowane wydanie), `launcherExe`/`launcherAppx`, `javaVersion` (wymagana przez tę wersję gry), `javaHome` (JDK do Gradle; co najmniej 25, bo wymaga tego Loom 1.19, także dla starszych wersji gry; szukane też w JDK launchera Minecrafta, np. `…\runtime\java-runtime-epsilon`, zanim kreator zaproponuje pobranie), `fabricVersionId` (profil Fabric w launcherze), `whisperVariant` (`cuda` albo `cpu`), `whisperModel`, `whisperCli`, `piperExe`, `piperVoice` (null, gdy brak Pipera).
Czytaj przez `require('./tools').readConfig()`.

## Test

```
node test/tools.check.js
node test/mod.check.js
node test/voice.check.js
node test/claude.check.js
node test/textures.check.js          # z prawdziwym Codexem: node test/textures.check.js codex
```
