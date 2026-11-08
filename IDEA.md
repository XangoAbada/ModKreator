# ModKreator

> Aplikacja dla dzieci do tworzenia modów do Minecrafta głosem i prostym językiem, napędzana lokalnym Claude Code (i opcjonalnie Codexem do grafik).

## Notatki z brainstormingu

## Założenia od użytkownika (2026-11-08)
- Odbiorca: dzieci. Prosty język, aplikacja robi wszystko sama albo mówi „poproś dorosłego o pomoc”.
- Start: sprawdza, czy jest Minecraft i narzędzia do modów; jeśli brak, pyta, czy pobrać.
- Silnik: lokalna subskrypcja Claude Code. Jeśli jest Codex, używany do generowania grafik (tekstury) do moda.
- Głos: text-to-speech do dziecka, mikrofon (speech-to-text) do mówienia, co chce zbudować.

## Otwarte pytania
- Edycja Minecrafta (Java / Bedrock), loader (Fabric / Forge / NeoForge), wersja gry.
- Platforma i stack aplikacji.
- TTS/STT: lokalnie czy chmurowo, język polski.
- Bezpieczeństwo: co dziecko może zrobić samo, a co wymaga dorosłego (instalacje, uprawnienia Claude Code).

## Decyzje (2026-11-08)
- Minecraft Java + Fabric. Odbiorcy: dzieci 8-10 lat, interfejs głównie głosowy, duże przyciski, mało tekstu.
- Aplikację instaluje i konfiguruje dorosły. Ryzyka regulaminu/nadzoru świadomie pomijamy.
- Stack: aplikacja desktopowa (Electron lub Tauri), TTS przez systemowe głosy Windows (polski), STT lokalnie whisper.cpp.
- Rdzeń MVP: dziecko mówi, co chce → Claude Code buduje moda → Codex (jeśli jest) robi teksturę → aplikacja instaluje moda i uruchamia grę.

- Wersja Minecrafta: wykrywana automatycznie; dopasowanie szablonu Fabric do wersji robi agent AI, gdy trzeba.
- Electron.
- Jeden rosnący mod na dziecko; git commit po każdej udanej zmianie, przycisk „cofnij”.
- Instalacja: .jar do .minecraft/mods + uruchomienie launchera na profilu Fabric (prawdziwe światy dziecka).
- Poza MVP: własne modele 3D mobów, serwery/multiplayer, publikacja (Modrinth), wiele profili dzieci, Forge/NeoForge.
