// Rozmowa (T-8), w rendererze: lektor i przycisk „Mów”.
// speak(text) – czyta na głos: Piper (głos mc_speech), a bez niego polski głos Windows (np. Paulina).
// say(text) – odpowiedź aplikacji: dymek + lektor. ask(text) – prośba dziecka (z głosu, później z czatu T-13).
const talkList = document.querySelector('#talk .talk');
const speakBtn = document.getElementById('speak');

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

async function speak(text) {
  stopSpeaking();
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

// ponytail: echo zamiast AI – pętlę tworzenia podłączy tu T-10
function ask(text) {
  bubble(text, true);
  say(`Słyszę: „${text}”. Już niedługo nauczę się to budować!`);
}

function setSpeakBtn(icon, label, disabled = false) {
  speakBtn.innerHTML = `<span class="icon">${icon}</span>${label}`;
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
      text ? ask(text) : say('Nic nie słychać. Naciśnij „Mów” i powiedz jeszcze raz.');
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
