// Słuchanie (T-8): próbki 16 kHz mono z rendereru → WAV → whisper-cli po polsku → tekst.
// Ścieżki whisper-cli i modelu zapisuje kreator startowy (tools.js) w config.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { readConfig } = require('./tools');

const RATE = 16000; // whisper.cpp chce WAV 16 kHz mono 16-bit

function wav(samples, rate = RATE) {
  const data = samples.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); // PCM, mono
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s || 0)) * 32767), 44 + i * 2));
  return b;
}

const whisperArgs = (model, file) => ['-m', model, '-f', file, '-l', 'pl', '-nt', '-np', '-sns'];

// Bez znaczników typu [BLANK_AUDIO] / (muzyka) i bez łamania linii.
const cleanText = out => out.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

async function transcribe(samples) {
  const { whisperCli, whisperModel } = readConfig();
  if (!whisperCli || !whisperModel) throw new Error('Brak whisper.cpp – pobierz „Słuchanie” na ekranie Start.');
  const file = path.join(os.tmpdir(), `modkreator-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(file, wav(samples));
  try {
    const { stdout } = await promisify(execFile)(whisperCli, whisperArgs(whisperModel, file), { windowsHide: true, timeout: 120000 });
    return cleanText(stdout);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

module.exports = { transcribe, wav, whisperArgs, cleanText };
