'use strict';
/* Ayar dosyasının bekçisi (#564): başkası settings.json'ı değiştirdiyse bu
 * kopya üstüne yazmamalı. Gerçek dosyayla sınanıyor, çünkü karar boyut ve
 * değiştirilme zamanına da bakıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SettingsGuard } = require('../src/main/settings-guard.js');

function setup(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-guard-'));
  const file = path.join(dir, 'settings.json');
  if (initial != null) fs.writeFileSync(file, initial, 'utf8');
  return { dir, file, guard: new SettingsGuard(file) };
}

/* Değiştirilme zamanını açıkça ileri al: aynı milisaniyede iki yazım
   dosya sisteminde aynı zamanı taşıyabilir ve test rastlantıya kalırdı. */
function bump(file, ms) {
  const t = new Date(Date.now() + (ms || 5000));
  fs.utimesSync(file, t, t);
}

test('bilinen hâl yokken karar vermiyor', () => {
  const { guard } = setup('{"a":1}');
  assert.strictEqual(guard.changed(), false);
});

test('okunan hâl aynı kaldıkça değişmedi', () => {
  const { file, guard } = setup('{"a":1}');
  guard.remember(fs.readFileSync(file));
  assert.strictEqual(guard.changed(), false);
});

test('başkası yazınca değişti', () => {
  const { file, guard } = setup('{"a":1}');
  guard.remember(fs.readFileSync(file));
  fs.writeFileSync(file, '{"a":2}', 'utf8');
  bump(file);
  assert.strictEqual(guard.changed(), true);
});

test('bu kopyanın kendi yazımı değişiklik sayılmıyor', () => {
  const { file, guard } = setup('{"a":1}');
  guard.remember(fs.readFileSync(file));
  const mine = JSON.stringify({ a: 3 }, null, 2);
  fs.writeFileSync(file, mine, 'utf8');
  guard.remember(mine);
  assert.strictEqual(guard.changed(), false);
});

test('içeriği değiştirmeden dokunmak (yedekleme, tarayıcı) değişiklik sayılmıyor', () => {
  const { file, guard } = setup('{"a":1}');
  guard.remember(fs.readFileSync(file));
  bump(file, 60000);
  assert.strictEqual(guard.changed(), false);
  // ve bir sonraki denetim dosyayı yeniden okumasın diye bilgi tazelendi
  assert.strictEqual(guard.known.mtimeMs, fs.statSync(file).mtimeMs);
});

test('öz testin aynı içeriği geri yazması çakışmayı kendiliğinden bitiriyor', () => {
  const original = '{"layers":[1,2,3]}';
  const { file, guard } = setup(original);
  guard.remember(fs.readFileSync(file));
  fs.writeFileSync(file, '{"layers":[]}', 'utf8'); // deneme yapılandırması
  bump(file, 3000);
  assert.strictEqual(guard.changed(), true);
  fs.writeFileSync(file, original, 'utf8'); // kapanışta aynen geri
  bump(file, 9000);
  assert.strictEqual(guard.changed(), false);
});

test('aynı boyutta farklı içerik de yakalanıyor', () => {
  const { file, guard } = setup('{"a":1}');
  guard.remember(fs.readFileSync(file));
  fs.writeFileSync(file, '{"a":9}', 'utf8');
  bump(file);
  assert.strictEqual(fs.statSync(file).size, 7);
  assert.strictEqual(guard.changed(), true);
});

test('dosya yokken: yazmak kimsenin değişikliğini ezmez; sonradan biri oluşturursa değişti', () => {
  const { file, guard } = setup(null);
  guard.remember(null);
  assert.strictEqual(guard.changed(), false);
  fs.writeFileSync(file, '{"başka":"kopya"}', 'utf8');
  assert.strictEqual(guard.changed(), true);
});

test('bilinen dosya silinirse yazmak onu yeniden kurar — değişiklik sayılmıyor', () => {
  const { file, guard } = setup('{"a":1}');
  guard.remember(fs.readFileSync(file));
  fs.unlinkSync(file);
  assert.strictEqual(guard.changed(), false);
});

test('okunamayan dosyada karar vermiyor (null)', () => {
  const { file } = setup('{"a":1}');
  const fakeFs = {
    statSync: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; },
    readFileSync: () => { throw new Error('busy'); },
  };
  const g = new SettingsGuard(file, fakeFs);
  g.known = { exists: true, hash: 'x', size: 1, mtimeMs: 1 };
  assert.strictEqual(g.changed(), null);
  const statOnly = {
    statSync: () => ({ size: 99, mtimeMs: 99 }),
    readFileSync: () => { const e = new Error('locked'); e.code = 'EBUSY'; throw e; },
  };
  const g2 = new SettingsGuard(file, statOnly);
  g2.known = { exists: true, hash: 'x', size: 1, mtimeMs: 1 };
  assert.strictEqual(g2.changed(), null);
});

test('çözümleme: BOM ayıklanıyor, eski ses kaynağı biçimi çevriliyor', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"audio":{"source":"default"}}')]);
  const s = SettingsGuard.parse(bom);
  assert.deepStrictEqual(s.audio.sources, ['default']);
  assert.deepStrictEqual(SettingsGuard.parse('{"x":1}'), { x: 1 });
  assert.throws(() => SettingsGuard.parse('{bozuk'));
});
