# Zadania: ModKreator

<!-- Zarządzane przez orkiestratora (orch.py). Można edytować ręcznie w tym formacie.
     Nowe zadanie: nagłówek "## T-? · tytuł", ID zostanie nadane przy następnym odczycie. -->

## T-10 · Zbuduj pętlę tworzenia moda z Claude Code
- status: todo
- agent: claude
- created: 2026-11-08
- after: T-8, T-9

Cel: prośba dziecka zamienia się w zmianę w modzie. Kontekst: IDEA.md. Zależy od głosu i moda dziecka.
Zakres: prośba (głos/tekst) trafia do lokalnego Claude Code uruchomionego w folderze moda, z promptem dla dzieci 8-10 lat (prosty język, robi wszystko sam, w razie potrzeby „poproś dorosłego”); dodawanie przedmiotów, bloków, receptur, efektów; po zmianie build, automatyczna naprawa błędów kompilacji, git commit; przycisk „cofnij ostatnią zmianę”; krótka odpowiedź do dziecka czytana przez TTS.
Gotowe, gdy: dziecko mówi np. „chcę miecz, który strzela ogniem”, a po chwili mod ma taki przedmiot, buduje się i jest zainstalowany; „cofnij” przywraca poprzedni stan.

## T-11 · Generuj tekstury przez Codex
- status: todo
- agent: claude
- created: 2026-11-08
- after: T-10

Cel: nowe przedmioty i bloki w modzie dostają tekstury generowane przez Codex, gdy jest dostępny. Kontekst: IDEA.md. Zależy od pętli tworzenia.
Zakres: przy dodawaniu przedmiotu/bloku generowanie tekstury PNG w stylu Minecrafta (pixel-art, właściwy rozmiar, np. 16x16) przez lokalny Codex CLI i wpięcie jej w zasoby moda.
Gotowe, gdy: nowy przedmiot ma w grze wygenerowaną teksturę.
Pytanie otwarte: co robimy bez Codexa: zwykła tekstura zastępcza czy pixel-art generowany kodem?

## T-13 · Dodaj czat tekstowy obok rozmowy głosowej
- status: todo
- agent: claude
- created: 2026-11-08

Cel: dziecko może pisać do aplikacji zamiast mówić, bo może nie mieć mikrofonu. Kontekst: IDEA.md (dzieci 8-10 lat, duże przyciski, prosty język). Zależy od szkieletu Electron (T-6); powinno współgrać z głosem (T-8) i pętlą tworzenia (T-10), które przyjmują prośbę jako tekst.
Zakres: na ekranie rozmowy pole do pisania z dużym przyciskiem „Wyślij” (i Enter); napisana prośba trafia tam, gdzie rozpoznany głos; gdy aplikacja nie wykryje mikrofonu, przycisk „mów” jest nieaktywny albo ukryty z prostym komunikatem, a pisanie jest domyślnym sposobem.
Gotowe, gdy: na komputerze bez mikrofonu dziecko może napisać prośbę, wysłać ją i zobaczyć odpowiedź w rozmowie.
Pytanie: czy odpowiedzi aplikacji mają być nadal czytane na głos, gdy dziecko pisze (np. przełącznik „lektor wł./wył.”)?

## T-8 · Dodaj głos: TTS i rozpoznawanie mowy
- status: running
- agent: claude
- created: 2026-11-08
- after: T-6

Cel: aplikacja mówi do dziecka i słucha, co chce zbudować. Kontekst: IDEA.md. Zależy od szkieletu Electron.
Zakres: TTS na polskich głosach systemowych Windows (wszystkie komunikaty do dziecka czytane na głos); przycisk „mów” nagrywa z mikrofonu, rozpoznawanie lokalnie przez whisper.cpp (polski), tekst trafia do ekranu rozmowy.
Gotowe, gdy: na ekranie rozmowy dziecko naciska „mów”, mówi po polsku, widzi rozpoznany tekst, a odpowiedź aplikacji jest czytana na głos.

## T-9 · Przygotuj mod dziecka: szablon, build, instalacja, Zagraj
- status: running
- agent: claude
- created: 2026-11-08
- after: T-7

Cel: aplikacja ma jeden rosnący mod dziecka, który umie zbudować i zainstalować w grze. Kontekst: IDEA.md. Zależy od kreatora startowego (wykryta wersja gry).
Zakres: szablon moda Fabric dopasowany do wykrytej wersji Minecrafta (dopasowanie może robić agent AI, jeśli trzeba); folder moda jako repo git; build przez Gradle; kopiowanie .jar do .minecraft/mods; przycisk „Zagraj” uruchamia launcher na profilu Fabric (prawdziwe światy dziecka).
Gotowe, gdy: z aplikacji da się utworzyć mod, zbudować go, zainstalować i uruchomić grę z modem załadowanym.

## T-6 · Postaw szkielet aplikacji Electron
- status: done
- agent: claude
- created: 2026-11-08

Cel: szkielet aplikacji desktopowej ModKreator (Electron) do tworzenia modów Minecraft Java/Fabric przez dzieci 8-10 lat. Kontekst i decyzje: IDEA.md.
Zakres: okno aplikacji z ekranami: start (kreator sprawdzania narzędzi), rozmowa (przycisk „mów”, odpowiedzi lektora), „mój mod” (co już zbudowano, „Zagraj”, „Cofnij”). Na razie same ekrany i nawigacja, bez logiki. Duże przyciski, mało tekstu, przyjazny wygląd w duchu Minecrafta. Skrypty dev i build (Windows).
Gotowe, gdy: `npm install` + skrypt dev uruchamia okno z trzema ekranami i przejściami między nimi; skrypt build tworzy uruchamialną aplikację na Windows; README opisuje uruchomienie.

## T-7 · Zrób kreator startowy sprawdzający narzędzia
- status: done
- agent: claude
- created: 2026-11-08
- after: T-6

Cel: przy uruchomieniu aplikacja sprawdza, czy są wymagane narzędzia, i pomaga je doinstalować. Kontekst: IDEA.md. Zależy od szkieletu Electron.
Sprawdza: Minecraft Java (folder .minecraft, launcher, zainstalowane wersje gry), JDK 21, Fabric Loader i profil Fabric w launcherze, Claude Code CLI i czy jest zalogowany, Codex CLI (opcjonalny, do grafik), model whisper.cpp.
Gdy czegoś brakuje: prostym językiem dla dziecka 8-10 lat pyta „pobrać?” i pobiera/instaluje samodzielnie; gdy się nie da (np. zakup Minecrafta, logowanie do Claude), mówi „poproś dorosłego o pomoc” z krótką instrukcją dla dorosłego.
Gotowe, gdy: ekran startowy pokazuje stan każdego narzędzia, brakujące da się doinstalować z aplikacji albo jest jasny komunikat dla dorosłego; wykryta wersja Minecrafta jest zapisana do użycia przez szablon moda.
