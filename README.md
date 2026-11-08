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
- `src/preload.js` – mosty do procesu głównego: `window.tools` (check/install/onProgress), `window.mod` (create/build/install/play/change/undo/onProgress), `window.voice` (transcribe).
- `src/tools.js` – kreator startowy: sprawdza Minecrafta (+launcher, wersje), JDK, Fabric (+profil), Claude Code (+logowanie), Codex (opcjonalny), whisper.cpp (whisper-cli + model small); doinstalowuje brakujące albo podaje instrukcję dla dorosłego.
- `src/voice.js` – słuchanie w procesie głównym: próbki 16 kHz → WAV → `whisper-cli -l pl` → tekst.
- `src/talk.js` – ekran Rozmowa w rendererze: lektor i przycisk „Mów”; prośba dziecka idzie do `window.mod.change`.
- `src/mod.js` (+ `src/mod-template/`) – mod dziecka: szablon Fabric, build, instalacja, „Zagraj”, „Cofnij”.
- `src/claude.js` – pętla tworzenia: prośba → Claude Code w folderze moda → build z naprawą błędów → commit → instalacja.

## Głos

- Lektor: `speechSynthesis` z polskim głosem Windows (Paulina/Adam). Czyta odpowiedzi w rozmowie, powitanie i braki na ekranie Start.
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

## Konfiguracja wykryta przy starcie

Kreator zapisuje `%APPDATA%\ModKreator\config.json` (dla szablonu moda, T-9):
`minecraftDir`, `minecraftVersion` (najnowsze zainstalowane wydanie), `launcherExe`/`launcherAppx`, `javaVersion` (wymagana przez tę wersję gry), `javaHome` (JDK do Gradle; co najmniej 25, bo wymaga tego Loom 1.19, także dla starszych wersji gry), `fabricVersionId` (profil Fabric w launcherze), `whisperModel`, `whisperCli`.
Czytaj przez `require('./tools').readConfig()`.

## Test

```
node test/tools.check.js
node test/mod.check.js
node test/voice.check.js
node test/claude.check.js
```
