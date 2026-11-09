// Rozmowa (T-8), w rendererze: lektor i przycisk „Mów”.
// speak(text) – czyta na głos: Piper (głos mc_speech), a bez niego polski głos Windows (np. Paulina).
// say(text) – odpowiedź aplikacji: dymek + lektor. ask(text) – prośba dziecka (z głosu albo z pisania, T-13).
const talkList = document.querySelector('#talk .talk');
const speakBtn = document.getElementById('speak');
const writeForm = document.getElementById('write');
const writeText = document.getElementById('write-text');
const sendBtn = writeForm.querySelector('button[type=submit]');
const newModBtn = document.getElementById('new-mod');

// Zapas, gdy Piper niedostępny lub zawiedzie: głos systemowy Windows.
// ponytail: bez fallbacku przez PowerShell – Chromium na Windows i tak bierze głosy SAPI (te same co System.Speech)
function systemSpeak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pl-PL';
  u.voice = speechSynthesis.getVoices().find(v => v.lang === 'pl-PL') || null;
  speechSynthesis.speak(u);
}

// Lektor (T-87): Piper (głos mc_speech) z procesu głównego; nowa wypowiedź przerywa poprzednią.
const audioCtx = new AudioContext();
let playing = null, speechId = 0;
function stopSpeaking() {
  speechId++;
  speechSynthesis.cancel();
  playing?.stop();
  playing = null;
}

// Przełącznik „Lektor wł./wył.” (T-13): wyłączony = speak() milczy, dymki zostają. Wybór pamiętany między uruchomieniami.
const lektorBtn = document.getElementById('lektor');
let lektorOn = localStorage.getItem('lektor') !== 'off';
function setLektor(on) {
  lektorOn = on;
  localStorage.setItem('lektor', on ? 'on' : 'off');
  lektorBtn.setAttribute('aria-pressed', on);
  lektorBtn.innerHTML = on ? '<span class="icon">🔊</span>Lektor wł.' : '<span class="icon">🔇</span>Lektor wył.';
}
setLektor(lektorOn);
lektorBtn.onclick = () => {
  setLektor(!lektorOn);
  lektorOn ? speak('Lektor włączony.') : stopSpeaking();
};

async function speak(text) {
  stopSpeaking();
  if (!lektorOn) return;
  const id = speechId;
  try {
    const wav = await window.voice.speak(text); // null bez Pipera → catch → głos systemowy
    const buf = await audioCtx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
    if (id !== speechId) return; // w międzyczasie przyszła nowsza wypowiedź
    await audioCtx.resume();
    playing = audioCtx.createBufferSource();
    playing.buffer = buf;
    playing.connect(audioCtx.destination);
    playing.start();
  } catch {
    if (id === speechId) systemSpeak(text);
  }
}

function bubble(text, me) {
  const d = document.createElement('div');
  d.className = me ? 'bubble me' : 'bubble';
  d.textContent = me ? text : '🔊 ' + text;
  talkList.append(d);
  talkList.scrollTop = talkList.scrollHeight;
}

function say(text) { bubble(text); speak(text); }

// „Komputer myśli”: duży, ruchomy dymek w rozmowie na czas pracy (Claude, budowanie, obrazki, kopiowanie do gry).
// Ikona i tekst idą za postępem z mod:progress, żeby dziecko widziało, że coś się dzieje.
let thinking = null;
const PHASES = [[/rysuj/i, '🎨'], [/buduj|poprawiam/i, '🔨'], [/wkładam|pobieram|przygotowuję mody/i, '📦'], [/zakładam nowy mod/i, '✨'], [/./, '🤔']];
function setThinking(text) {
  if (!thinking) return;
  thinking.querySelector('.think-icon').textContent = PHASES.find(([re]) => re.test(text))[1];
  thinking.querySelector('.think-text').textContent = text;
}
function startThinking() {
  thinking = document.createElement('div');
  thinking.className = 'bubble thinking';
  thinking.setAttribute('role', 'status');
  thinking.innerHTML = '<span class="think-icon"></span><span class="think-text"></span><span class="dots"><i></i><i></i><i></i></span>';
  setThinking('Myślę…');
  talkList.append(thinking);
  talkList.scrollTop = talkList.scrollHeight;
}
function stopThinking() { thinking?.remove(); thinking = null; }
window.mod.onProgress(text => setThinking(text));

// Pętla tworzenia (T-10): prośba idzie do Claude Code, odpowiedź czyta lektor. Postęp mówi mod:progress (index.html).
async function ask(text) {
  bubble(text, true);
  setSpeakBtn('⏳', 'Buduję…', true);
  sendBtn.disabled = newModBtn.disabled = writeText.disabled = true; // jedna prośba naraz
  startThinking();
  let reply;
  try { reply = await window.mod.change(text); }
  catch (e) {
    console.error(e);
    reply = 'Coś nie wyszło. Poproś dorosłego o pomoc.';
  }
  stopThinking();
  say(reply);
  writeText.disabled = false;
  setSpeakBtn('🎤', 'Mów');
  sendBtn.disabled = newModBtn.disabled = false;
  refreshMods(); // nazwa moda mogła się zmienić (index.html)
}

// Pisanie (T-13): „Wyślij” albo Enter (submit formularza) → ta sama ask(), co rozpoznany głos.
writeForm.onsubmit = e => {
  e.preventDefault();
  const text = writeText.value.trim();
  if (!text || sendBtn.disabled) return;
  writeText.value = '';
  stopSpeaking();
  ask(text);
};

// Bez mikrofonu: chowamy „Mów”, pisanie jest domyślne. devicechange łapie podłączenie/odłączenie w trakcie.
async function checkMic() {
  const hasMic = (await navigator.mediaDevices.enumerateDevices()).some(d => d.kind === 'audioinput');
  speakBtn.hidden = !hasMic;
  document.getElementById('no-mic').hidden = hasMic;
}
navigator.mediaDevices.addEventListener('devicechange', checkMic);
checkMic();

// Mikrofon to sama ikonka obok „Wyślij”; opis stanu w podpowiedzi i dla czytnika ekranu.
function setSpeakBtn(icon, label, disabled = false) {
  speakBtn.innerHTML = `<span class="icon">${icon}</span>`;
  speakBtn.title = label;
  speakBtn.setAttribute('aria-label', label);
  speakBtn.classList.toggle('rec', icon === '⏹️');
  speakBtn.disabled = disabled;
}

let recorder = null;
speakBtn.onclick = async () => {
  if (recorder) return recorder.stop();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return say('Nie słyszę mikrofonu. Poproś dorosłego o pomoc.'); }
  stopSpeaking(); // nie nagrywaj lektora
  const rec = recorder = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    recorder = null;
    setSpeakBtn('⏳', 'Słucham…', true);
    try {
      const ctx = new AudioContext({ sampleRate: 16000 }); // decodeAudioData przelicza na 16 kHz
      const audio = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
      ctx.close();
      const text = await window.voice.transcribe(audio.getChannelData(0)); // mikrofon: pierwszy kanał wystarczy
      text ? await ask(text) : say('Nic nie słychać. Naciśnij mikrofon i powiedz jeszcze raz.');
    } catch (e) {
      console.error(e);
      say('Nie udało się posłuchać. Poproś dorosłego o pomoc.');
    }
    setSpeakBtn('🎤', 'Mów');
  };
  rec.start();
  setTimeout(() => rec.state === 'recording' && rec.stop(), 30000); // whisper i tak słucha po 30 s
  setSpeakBtn('⏹️', 'Gotowe');
};

// Powitanie czytane przy pierwszym wejściu na ekran rozmowy.
let greeted = false;
document.addEventListener('click', e => {
  if (greeted || !e.target.closest('[data-go="talk"]')) return;
  greeted = true;
  speak(talkList.firstElementChild.textContent.replace('🔊', '').trim());
});

// Czyści rozmowę i zaczyna od powitania (nowy mod albo przełączenie na inny mod).
function clearTalk(greeting) {
  stopSpeaking();
  talkList.replaceChildren();
  say(greeting);
}

// „Nowy mod”: gdy pomysł w bieżącym modzie nie jest zapisany (Claude dopytał i czeka na odpowiedź albo zmiana
// nie trafiła do moda), najpierw pytamy. Pusty mod nie jest dublowany – czat zaczyna się w nim od nowa.
const confirmNew = name => new Promise(resolve => {
  const d = document.createElement('div');
  d.className = 'bubble ask';
  d.append(`🔊 Pomysł w „${name}” nie jest jeszcze zapisany. Zacząć nowy mod?`);
  const yes = Object.assign(document.createElement('button'), { className: 'green', innerHTML: '<span class="icon">➕</span>Tak, nowy mod' });
  const no = Object.assign(document.createElement('button'), { innerHTML: '<span class="icon">✏️</span>Nie, dokończę' });
  const done = v => { d.remove(); resolve(v); };
  yes.onclick = () => done(true);
  no.onclick = () => done(false);
  d.append(yes, no);
  talkList.append(d);
  talkList.scrollTop = talkList.scrollHeight;
  speak(`Pomysł w modzie ${name} nie jest jeszcze zapisany. Zacząć nowy mod?`);
});

newModBtn.onclick = async () => {
  newModBtn.disabled = sendBtn.disabled = true;
  try {
    const st = await window.mod.status();
    if (!st.saved && !(await confirmNew(st.name || 'Mój mod'))) return say('Dobrze, dokończmy. Co dalej?');
    if (st.empty) { await window.mod.forget(); clearTalk('Zaczynamy od nowa! Co zbudujemy?'); }
    else clearTalk(await window.mod.newMod());
  } catch (e) {
    console.error(e);
    say('Nie udało się zacząć nowego moda. Poproś dorosłego o pomoc.');
  } finally {
    newModBtn.disabled = sendBtn.disabled = false;
    refreshMods();
  }
};
