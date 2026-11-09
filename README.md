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
- `src/preload.js` – mosty do procesu głównego: `window.tools` (check/install/onProgress), `window.mod` (create/build/install/play/change/undo/onProgress), `window.voice` (transcribe/speak).
- `src/tools.js` – kreator startowy: sprawdza Minecrafta (+launcher, wersje), JDK, Fabric (+profil), Claude Code (+logowanie), Codex (opcjonalny), whisper.cpp (z kartą NVIDIA – wykrytą przez `nvidia-smi` – build CUDA 12.4 + model large-v3-turbo q8_0; bez karty build CPU + model small), Piper (opcjonalny lektor: piper.exe + głos mc_speech); doinstalowuje brakujące albo podaje instrukcję dla dorosłego.
- `src/voice.js` – słuchanie w procesie głównym: próbki 16 kHz → WAV → `whisper-cli -l pl` → tekst; lektor: tekst przez stdin → `piper.exe --model … --output_file …` → WAV.
- `src/talk.js` – ekran Rozmowa w rendererze: lektor (`speak()`: WAV z Pipera przez AudioContext, zapas `speechSynthesis`) i przycisk „Mów”; prośba dziecka idzie do `window.mod.change`.
- `src/mod.js` (+ `src/mod-template/`) – mod dziecka: szablon Fabric, build, instalacja, „Zagraj”, „Cofnij”.
- `src/claude.js` – pętla tworzenia: prośba → Claude Code w folderze moda → tekstury → build z naprawą błędów → commit → instalacja.
- `src/textures.js` – tekstury pixel-art 16x16 od Codexa dla nowych przedmiotów i bloków.

## Głos

- Lektor: [Piper](https://github.com/rhasspy/piper) (MIT, wydanie 2023.11.14-2, CPU) z głosem `pl_PL-mc_speech-medium` (~63 MB) w `%APPDATA%\ModKreator\piper`, pobierany na ekranie Start („Lektor”, opcjonalny). Krótkie zdanie zaczyna brzmieć po ok. 0,5 s (nowy proces na każdą wypowiedź). Bez Pipera albo gdy zawiedzie: `speechSynthesis` z polskim głosem Windows (Paulina/Adam). Nowa wypowiedź przerywa poprzednią. Czyta odpowiedzi w rozmowie, powitanie i braki na ekranie Start.
- Licencja głosu: nagrania mc_speech są na CC0, ale model dostrojono z angielskiego głosu lessac, którego dane (Blizzard 2013) mają licencję tylko do badań, bez użycia komercyjnego – do domowego, niekomercyjnego użytku przyjmujemy to ryzyko, przed sprzedażą/dystrybucją komercyjną aplikacji trzeba głos wymienić.
- „Mów”: klik zaczyna nagrywanie (maks. 30 s), drugi klik kończy. Nagranie idzie do whisper.cpp lokalnie, bez internetu, a rozpoznany tekst pokazuje się w rozmowie.
- Do użycia przez T-10/T-13 w rendererze: `ask(tekst)` (prośba dziecka do rozmowy → pętla tworzenia T-10) i `say(tekst)` (odpowiedź aplikacji: dymek + lektor). Z preloadu: `window.voice.transcribe(Float32Array)`.

## Mod dziecka (T-9)

`src/mod.js` (+ szablon `src/mod-template/`), w preload `window.mod` (create/build/install/play/onProgress). Przycisk „Zagraj” na ekranie „Mój mod” robi po kolei:

- **create** – tylko raz: `%APPDATA%\ModKreator\mod` z szablonu Fabric (id `modkreator_mod`, jeden `ModInitializer`). Wersje dla `minecraftVersion`: loader z meta.fabricmc.net, Fabric API z Modrinth, Loom i Gradle wrapper z gałęzi [fabric-example-mod](https://github.com/FabricMC/fabric-example-mod) dla tej wersji (albo najnowszej). Minecraft 26.x+ bez remapowania, starsze z mapowaniami Mojanga. Potem `git init` + pierwszy commit.
- **build** – `gradlew build` z `JAVA_HOME=javaHome`.
- **install** – `build/libs/*.jar` (bez `-sources`) do `<minecraftDir>/mods`, stara wersja moda usuwana; brakujące Fabric API (ta sama wersja co w modzie) pobierane z maven.fabricmc.net.
- **play** – ustawia profil Fabric jako ostatnio używany (`lastUsed` w `launcher_profiles.json`) i otwiera launcher. Ograniczenie: oficjalny launcher nie umie sam włączyć gry z profilem, dziecko klika „Graj”; gdy launcher był już otwarty, może pokazać inny profil.

## Pętla tworzenia (T-10)

`src/claude.js`, w preload `window.mod.change(tekst)` → odpowiedź dla lektora. Kolejno:

- `claude -p --output-format json` w folderze moda, prośba przez stdin, prompt dla dzieci 8–10 lat w `--append-system-prompt` (prosty język, robi wszystko sam, „poproś dorosłego”). Uprawnienia: `--permission-mode acceptEdits` (edycja plików tylko w folderze moda) i `--allowedTools` – czytanie, WebSearch/WebFetch i jedynie `./gradlew.bat build`; reszta jest odrzucana bez pytania.
- Gdy pliki się zmieniły: build; błąd kompilacji wraca do tej samej sesji Claude'a (`--resume`) do naprawy, najwyżej 2 razy. Potem dalej źle albo inny błąd → `git reset --hard` + `git clean`, mod zostaje w ostatnim dobrym stanie.
- Udany build → `git commit` (treść: słowa dziecka) → instalacja do `mods`. Gdy gra trzyma plik, odpowiedź mówi „zamknij Minecrafta i kliknij Zagraj”.
- „Cofnij” (`window.mod.undo`) – `git reset --hard HEAD~1` (pierwszego commita „Nowy mod” nie rusza), build, instalacja.
- Wszystkie operacje na modzie (`mod:*`) idą w procesie głównym po kolei, jedna kolejka.

## Tekstury (T-11)

`src/textures.js`, wołane z pętli tworzenia po zmianie Claude'a, przed buildem:

- Claude nie rysuje PNG: w modelu nowego przedmiotu/bloku wpisuje podobną teksturę z Minecrafta (np. `minecraft:item/diamond_sword`).
- Każdy nowy (nieśledzony w gicie) model w `models/item|block/` z teksturą spoza moda dostaje własny obrazek: `codex exec` (prompt przez stdin, folder tymczasowy, logowanie ChatGPT, bez klucza API) generuje duży pixel-art (~1254 px, ok. 45 s); przedmioty na magentowym tle, bloki jako kafelek bez tła. Wszystkie obrazki naraz.
- Zmniejszanie w czystym Node (zlib, bez bibliotek): siatka 16x16, każde pole bierze kolor większości (bez rozmycia); u przedmiotów (i roślin z `parent` „cross”) pole, w którym ponad połowa to kolor rogu, jest przezroczyste. Wynik: `textures/<item|block>/<id>.png`, a model wskazuje `modkreator_mod:<item|block>/<id>`. Model przedmiotu dla bloku dostaje teksturę bloku, bez drugiego obrazka.
- Bez Codexa (brak, niezalogowany, limit, błąd): zostaje tekstura z Minecrafta wybrana przez Claude'a – działa od razu i wygląda jak gra, bez kolejnego kodu.

## Konfiguracja wykryta przy starcie

Kreator zapisuje `%APPDATA%\ModKreator\config.json` (dla szablonu moda, T-9):
`minecraftDir`, `minecraftVersion` (najnowsze zainstalowane wydanie), `launcherExe`/`launcherAppx`, `javaVersion` (wymagana przez tę wersję gry), `javaHome` (JDK do Gradle; co najmniej 25, bo wymaga tego Loom 1.19, także dla starszych wersji gry), `fabricVersionId` (profil Fabric w launcherze), `whisperVariant` (`cuda` albo `cpu`), `whisperModel`, `whisperCli`, `piperExe`, `piperVoice` (null, gdy brak Pipera).
Czytaj przez `require('./tools').readConfig()`.

## Test

```
node test/tools.check.js
node test/mod.check.js
node test/voice.check.js
node test/claude.check.js
node test/textures.check.js          # z prawdziwym Codexem: node test/textures.check.js codex
```
