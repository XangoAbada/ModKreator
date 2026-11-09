// Tekstury (T-11): nowe modele przedmiotów i bloków dostają teksturę pixel-art 16x16 od Codexa.
// Claude zawsze wpisuje w model podobną teksturę z Minecrafta; gdy Codexa nie ma albo zawiedzie, ta zostaje.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const mod = require('./mod');

const ASSETS = 'src/main/resources/assets/modkreator_mod';
const SIZE = 16;
const KEY = [255, 0, 255]; // tło do wycięcia (magenta), Codex dostaje zakaz używania jej w przedmiocie

// --- PNG bez bibliotek: 8 bitów, RGB albo RGBA, bez przeplotu (tak zapisuje Codex) ---
function decodePng(buf) {
  let w, h, type, idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), name = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') {
      [w, h, type] = [d.readUInt32BE(0), d.readUInt32BE(4), d[9]];
      if (d[8] !== 8 || ![2, 6].includes(type) || d[12]) throw new Error(`Nieobsługiwany PNG (głębia ${d[8]}, typ ${type}).`);
    }
    if (name === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0, b = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + i] = (src[i] + pred) & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) px.copy(rgba, i * 4, i * bpp, i * bpp + bpp);
  return { w, h, rgba };
}

function encodePng(w, h, rgba) {
  const chunk = (name, d) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(name, 'ascii'), d]);
    len.writeUInt32BE(d.length);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), rgba.subarray(y * w * 4, (y + 1) * w * 4)])));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Duży obrazek „w stylu pixel-art” → prawdziwe 16x16. Każda komórka bierze kolor większości (bez rozmycia),
// a gdy `cutout` i ponad połowa komórki to tło (kolor rogu albo przezroczystość) – komórka jest przezroczysta.
// ponytail: siatka Codexa nie zawsze ma równo 16 pól, wtedy obraz lekko się przesuwa; wykrywanie siatki, gdy to razi.
function pixelate({ w, h, rgba }, cutout, size = SIZE) {
  const corner = [...rgba.subarray(0, 3)];
  const isKey = i => rgba[i + 3] < 128 || (cutout && Math.abs(rgba[i] - corner[0]) + Math.abs(rgba[i + 1] - corner[1]) + Math.abs(rgba[i + 2] - corner[2]) < 120);
  const out = Buffer.alloc(size * size * 4);
  for (let cy = 0; cy < size; cy++) for (let cx = 0; cx < size; cx++) {
    const groups = new Map();
    let all = 0, key = 0;
    for (let y = Math.floor(cy * h / size); y < Math.floor((cy + 1) * h / size); y++)
      for (let x = Math.floor(cx * w / size); x < Math.floor((cx + 1) * w / size); x++) {
        const i = (y * w + x) * 4;
        all++;
        if (isKey(i)) { key++; continue; }
        const g = (rgba[i] >> 5) << 6 | (rgba[i + 1] >> 5) << 3 | rgba[i + 2] >> 5; // kolory zgrubnie, 8 poziomów na kanał
        const s = groups.get(g) || groups.set(g, [0, 0, 0, 0]).get(g);
        s[0] += rgba[i]; s[1] += rgba[i + 1]; s[2] += rgba[i + 2]; s[3]++;
      }
    if (key * 2 > all || !groups.size) continue; // przezroczysta (bufor ma zera)
    const [r, g, b, n] = [...groups.values()].reduce((m, s) => s[3] > m[3] ? s : m);
    out.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), 255], (cy * size + cx) * 4);
  }
  return encodePng(size, size, out);
}

const describe = (name, cutout) => `Minecraft ${cutout ? 'item' : 'block'} texture of ${name}, ` +
  'in the style of Minecraft Java Edition: 16x16 pixel art scaled up with hard square pixels on an exact 16x16 grid, ' +
  'no anti-aliasing, no text, limited palette, simple shading, friendly and colorful for children. ' + (cutout
    ? `Single object, dark outline, centered and filling most of the canvas, flat like an inventory icon, on a perfectly flat solid #FF00FF magenta background, no shadows, no magenta in the object.`
    : 'Seamless tileable texture filling the whole square edge to edge, no background, no border, no frame, flat front view of one block face.');

const newestPng = (dirs, since) => dirs.flatMap(d => fs.existsSync(d) ? fs.readdirSync(d).map(f => path.join(d, f)) : [])
  .filter(f => f.endsWith('.png') && fs.statSync(f).mtimeMs >= since)
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

// Jeden obrazek z Codexa (`codex exec`, logowanie ChatGPT, bez klucza API) → bufor PNG.
async function codexImage(prompt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tex-'));
  const since = Date.now();
  try {
    const log = await new Promise((resolve, reject) => {
      // shell: codex to codex.cmd z npm; prompt idzie przez stdin („-”), więc nic nie trzeba cytować
      const p = spawn('codex', ['exec', '-s', 'workspace-write', '--skip-git-repo-check', '-'],
        { cwd: tmp, shell: true, windowsHide: true, timeout: 10 * 60000 });
      let out = '';
      p.stdout.on('data', d => out += d);
      p.stderr.on('data', d => out += d);
      p.on('error', reject);
      p.on('close', () => resolve(out));
      p.stdin.end('Use the $imagegen image generation tool to generate exactly one image. Save it to the exact path ./texture.png ' +
        `in the current working directory. Do nothing else: no code changes, no extra files, no questions, no commentary. Image description: ${prompt}`);
    });
    // Codex czasem zapisuje pod inną nazwą albo zostawia obrazek tylko w ~/.codex/generated_images/<sesja>/
    const gen = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');
    const sessions = fs.existsSync(gen) ? fs.readdirSync(gen).map(d => path.join(gen, d)) : [];
    const file = newestPng([tmp], since) || newestPng(sessions, since);
    if (!file) throw new Error(`Codex nie zrobił obrazka:\n${log.slice(-2000)}`);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Nowe (jeszcze nie w gicie) modele z teksturą spoza moda → własna tekstura modkreator_mod:<block|item>/<id>.
async function paint(dir, request, say = () => {}, draw = codexImage) {
  const models = (await mod.git(dir, 'ls-files --others --exclude-standard')).split(/\r?\n/)
    .map(f => new RegExp(`^${ASSETS}/models/(block|item)/([a-z0-9_]+)\\.json$`).exec(f)).filter(Boolean)
    .map(([f, kind, id]) => ({ file: path.join(dir, f), kind, id }))
    .filter(m => { try { m.json = JSON.parse(fs.readFileSync(m.file, 'utf8')); } catch { return false; }
      return Object.values(m.json.textures || {}).some(t => !String(t).startsWith('modkreator_mod:')); });
  if (!models.length) return;
  say('Rysuję obrazki do moda…');
  let lang = {};
  try { lang = JSON.parse(fs.readFileSync(path.join(dir, ASSETS, 'lang', 'en_us.json'), 'utf8')); } catch {}
  const set = (m, tex) => {
    for (const k of Object.keys(m.json.textures)) m.json.textures[k] = tex;
    fs.writeFileSync(m.file, JSON.stringify(m.json, null, 2));
  };
  const blocks = new Set(models.filter(m => m.kind === 'block').map(m => m.id));
  const blockItem = m => m.kind === 'item' && blocks.has(m.id); // przedmiot-blok bierze teksturę bloku, bez drugiego obrazka
  const painted = new Set();
  // ponytail: wszystkie obrazki naraz; kolejka, gdy dziecko poprosi o wiele rzeczy i limit Codexa zacznie odmawiać
  await Promise.all(models.filter(m => !blockItem(m)).map(async m => {
    const cutout = m.kind === 'item' || /cross/.test(m.json.parent); // kwiatki i rośliny też z przezroczystym tłem
    const name = lang[`${m.kind}.modkreator_mod.${m.id}`] || m.id.replace(/_/g, ' ');
    try {
      const png = pixelate(decodePng(await draw(`${describe(`"${name}"`, cutout)} The child who made it asked (in Polish): "${request}".`)), cutout);
      const out = path.join(dir, ASSETS, 'textures', m.kind, `${m.id}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, png);
      set(m, `modkreator_mod:${m.kind}/${m.id}`);
      if (m.kind === 'block') painted.add(m.id);
    } catch (e) { console.error(`Tekstura ${m.id}:`, e); } // zostaje tekstura z Minecrafta
  }));
  for (const m of models.filter(m => blockItem(m) && painted.has(m.id))) set(m, `modkreator_mod:block/${m.id}`);
}

module.exports = { paint, codexImage, decodePng, encodePng, pixelate };
