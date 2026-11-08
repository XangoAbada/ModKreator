// Szybki test słuchania: node test/voice.check.js
const assert = require('assert');
const { wav, whisperArgs, cleanText, piperText } = require('../src/voice');

const b = wav(new Float32Array([0, 1, -1, 2, 0.5]));
assert.strictEqual(b.length, 44 + 10);
assert.strictEqual(b.toString('ascii', 0, 4), 'RIFF');
assert.strictEqual(b.readUInt32LE(4), b.length - 8);
assert.strictEqual(b.toString('ascii', 8, 16), 'WAVEfmt ');
assert.strictEqual(b.readUInt16LE(22), 1); // mono
assert.strictEqual(b.readUInt32LE(24), 16000);
assert.strictEqual(b.readUInt16LE(34), 16);
assert.strictEqual(b.readUInt32LE(40), 10);
assert.deepStrictEqual([0, 1, 2, 3, 4].map(i => b.readInt16LE(44 + i * 2)), [0, 32767, -32767, 32767, 16384]);

assert.deepStrictEqual(whisperArgs('m.bin', 'a.wav').slice(0, 6), ['-m', 'm.bin', '-f', 'a.wav', '-l', 'pl']);
assert.strictEqual(cleanText(' Chcę miecz,\n który strzela ogniem! [BLANK_AUDIO]\n'), 'Chcę miecz, który strzela ogniem!');
assert.strictEqual(cleanText('[BLANK_AUDIO]\n(muzyka)'), '');

assert.strictEqual(piperText(' Cześć!\r\nZbudujmy  coś.\n'), 'Cześć! Zbudujmy coś.'); // jedna linia = jedna wypowiedź Pipera

console.log('ok');
