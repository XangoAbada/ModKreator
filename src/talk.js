// Rozmowa (T-8), w rendererze: lektor i przycisk „Mów”.
// speak(text) – czyta na głos polskim głosem Windows (np. Paulina) przez speechSynthesis.
// say(text) – odpowiedź aplikacji: dymek + lektor. ask(text) – prośba dziecka (z głosu, później z czatu T-13).
const talkList = document.querySelector('#talk .talk');
const speakBtn = document.getElementById('speak');

// ponytail: bez fallbacku przez PowerShell – Chromium na Windows i tak bierze głosy SAPI (te same co System.Speech)
function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pl-PL';
  u.voice = speechSynthesis.getVoices().find(v => v.lang === 'pl-PL') || null;
  speechSynthesis.speak(u);
}

function bubble(text, me) {
  const d = document.createElement('div');
  d.className = me ? 'bubble me' : 'bubble';
  d.textContent = me ? text : '🔊 ' + text;
  talkList.append(d);
  talkList.scrollTop = talkList.scrollHeight;
}

function say(text) { bubble(text); speak(text); }

// Pętla tworzenia (T-10): prośba idzie do Claude Code, odpowiedź czyta lektor. Postęp mówi mod:progress (index.html).
async function ask(text) {
  bubble(text, true);
  setSpeakBtn('⏳', 'Buduję…', true);
  try { say(await window.mod.change(text)); }
  catch (e) {
    console.error(e);
    say('Coś nie wyszło. Poproś dorosłego o pomoc.');
  }
  setSpeakBtn('🎤', 'Mów');
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
  speechSynthesis.cancel(); // nie nagrywaj lektora
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
      text ? await ask(text) : say('Nic nie słychać. Naciśnij „Mów” i powiedz jeszcze raz.');
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
