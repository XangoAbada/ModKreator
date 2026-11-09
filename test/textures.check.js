// Szybki test tekstur (podmieniony Codex): node test/textures.check.js
// Z prawdziwym Codexem: node test/textures.check.js codex  → zapisuje 16x16 do folderu tymczasowego
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { paint, codexImage, decodePng, encodePng, pixelate } = require('../src/textures');
const { git } = require('../src/mod');

// Obrazek 64x64: magentowe tło, czerwony kwadrat w środku (pola 4..11 z 16), jak „pixel-art” od Codexa.
const big = Buffer.alloc(64 * 64 * 4);
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const inside = x >= 16 && x < 48 && y >= 16 && y < 48;
  big.set(inside ? [200, 30, 30, 255] : [250, 5, 250, 255], (y * 64 + x) * 4);
}
const png = encodePng(64, 64, big);
assert.deepStrictEqual(decodePng(png), { w: 64, h: 64, rgba: big });
const px = (img, x, y) => [...img.rgba.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

const item = decodePng(pixelate(decodePng(png), true));
assert.strictEqual(item.w, 16);
assert.deepStrictEqual(px(item, 0, 0), [0, 0, 0, 0]); // tło przezroczyste
assert.deepStrictEqual(px(item, 8, 8), [200, 30, 30, 255]);
assert.deepStrictEqual(px(item, 3, 8), [0, 0, 0, 0]);
assert.deepStrictEqual(px(item, 4, 8), [200, 30, 30, 255]);
assert.deepStrictEqual(px(decodePng(pixelate(decodePng(png), false)), 0, 0), [250, 5, 250, 255]); // blok: bez wycinania

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-tex-check-'));
(async () => {
  if (process.argv[2] === 'codex') {
    const out = path.join(tmp, 'ruby.png');
    fs.writeFileSync(out, pixelate(decodePng(await codexImage('Minecraft item texture of a ruby, 16x16 pixel art, on a perfectly flat solid #FF00FF magenta background')), true));
    return console.log(out);
  }
  const A = 'src/main/resources/assets/modkreator_mod';
  const write = (f, v) => { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), typeof v === 'string' ? v : JSON.stringify(v)); };
  await git(tmp, 'init -q');
  await git(tmp, 'config user.name t');
  await git(tmp, 'config user.email t@t');
  write(`${A}/models/item/old_sword.json`, { parent: 'minecraft:item/handheld', textures: { layer0: 'minecraft:item/iron_sword' } });
  await git(tmp, 'add -A');
  await git(tmp, 'commit -q -m "Nowy mod"');

  write(`${A}/lang/en_us.json`, { 'item.modkreator_mod.fire_sword': 'Fire Sword' });
  write(`${A}/models/item/fire_sword.json`, { parent: 'minecraft:item/handheld', textures: { layer0: 'minecraft:item/diamond_sword' } });
  write(`${A}/models/block/ruby_block.json`, { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/redstone_block' } });
  write(`${A}/models/item/ruby_block.json`, { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/redstone_block' } });
  write(`${A}/models/item/rainbow_gem.json`, { parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/emerald' } });
  write(`${A}/models/item/broken_wand.json`, { parent: 'minecraft:item/handheld', textures: { layer0: 'minecraft:item/stick' } });
  write(`${A}/models/block/cloud_block.json`, { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/white_wool' } });
  write(`${A}/models/item/cloud_block.json`, { parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/white_wool' } });
  write(`${A}/models/item/ruby_block_item.json`, { parent: 'modkreator_mod:block/ruby_block' }); // bez tekstur – pomijany

  const prompts = [];
  // T-89: każda awaria Codexa (limit, niezalogowany, zepsuty obrazek, błąd przy bloku) → zostaje tekstura z Minecrafta
  const draw = async p => {
    prompts.push(p);
    if (/rainbow gem/.test(p)) throw new Error('limit Codexa');
    if (/broken wand/.test(p)) return Buffer.from('to nie PNG');
    if (/cloud block/.test(p)) throw new Error('Codex nie zrobił obrazka: niezalogowany');
    return png;
  };
  const err = console.error; console.error = () => {};
  await paint(tmp, 'chcę ognisty miecz', undefined, draw);
  console.error = err;
  const model = f => JSON.parse(fs.readFileSync(path.join(tmp, A, 'models', f), 'utf8')).textures;

  assert.strictEqual(prompts.length, 5); // każdy blok raz, przedmiot-blok bez drugiego obrazka, stary miecz nietknięty
  assert.match(prompts.find(p => /Fire Sword/.test(p)), /item texture.*magenta.*chcę ognisty miecz/s);
  assert.match(prompts.find(p => /ruby block/.test(p)), /block texture.*Seamless/s);
  assert.deepStrictEqual(model('item/fire_sword.json'), { layer0: 'modkreator_mod:item/fire_sword' });
  assert.deepStrictEqual(model('block/ruby_block.json'), { all: 'modkreator_mod:block/ruby_block' });
  assert.deepStrictEqual(model('item/ruby_block.json'), { all: 'modkreator_mod:block/ruby_block' });
  assert.deepStrictEqual(model('item/rainbow_gem.json'), { layer0: 'minecraft:item/emerald' }); // Codex zawiódł → zostaje z Minecrafta
  assert.deepStrictEqual(model('item/broken_wand.json'), { layer0: 'minecraft:item/stick' });
  assert.deepStrictEqual(model('block/cloud_block.json'), { all: 'minecraft:block/white_wool' });
  assert.deepStrictEqual(model('item/cloud_block.json'), { all: 'minecraft:block/white_wool' }); // przedmiot-blok idzie za blokiem
  assert.deepStrictEqual(model('item/old_sword.json'), { layer0: 'minecraft:item/iron_sword' });
  assert.strictEqual(decodePng(fs.readFileSync(path.join(tmp, A, 'textures/item/fire_sword.png'))).w, 16);
  assert.ok(fs.existsSync(path.join(tmp, A, 'textures/block/ruby_block.png')));
  for (const f of ['item/rainbow_gem', 'item/broken_wand', 'block/cloud_block']) assert.ok(!fs.existsSync(path.join(tmp, A, `textures/${f}.png`)));

  // Brak Codexa: prawdziwe codexImage bez codex w PATH odrzuca, więc paint zostawia teksturę z Minecrafta
  const PATH = process.env.PATH; process.env.PATH = '';
  try { await assert.rejects(codexImage('test')); } finally { process.env.PATH = PATH; }
  console.log('ok');
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => process.argv[2] !== 'codex' && fs.rmSync(tmp, { recursive: true, force: true }));
