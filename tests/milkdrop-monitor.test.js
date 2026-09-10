'use strict';
/* `monitor` — PRESETİN KENDİ HATA AYIKLAMA PROBU.
 *
 * Preset dili kare başına yazılabilen bir `monitor` değişkeni tanımlıyor ve
 * tek işi bu: yazarın kendi denklemine koyup değerine bakması. Render
 * girdisi değil, yani okunmadığı sürece o satırlar ölü. Korpusta 4.489
 * preset (%43,4) yazıyor. projectM'in #664'ü aynı isteği yıllardır açık
 * tutuyor; bir preset editörünün ihtiyaç duyduğu tek şey de bu.
 *
 * Yol: motor -> katman yığını -> ses ölçer mesajı -> panel. Yeni bir IPC
 * kanalı açılmadı; değer yazar aracı ve kare başına doğruluk gerekmiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const MODE = strip(read('src/visualizer/modes/milkdrop.js'));
const LAYERS = strip(read('src/visualizer/layers.js'));
const VIS = strip(read('src/visualizer/visualizer.js'));
const ADMIN = strip(read('src/admin/admin.js'));
const PANEL = strip(read('src/admin/milkdrop-panel.js'));

const IN = {
  time: 1, frame: 1, fps: 30, progress: 0.1,
  bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1,
  meshx: 32, meshy: 24, aspectx: 1, aspecty: 1, pixelsx: 320, pixelsy: 240,
};

// -------------------------------------------------------------- havuz.has

test('havuz: dokunulmamış ad ile sıfır yazılmış ad ayrılıyor', () => {
  /* `get` bilinmeyen adda 0 dönüyor ve denklem koşarken doğru olan bu —
     MilkDrop'ta da tanımsız değişken sıfırdır. Ama göstergede "preset
     sıfır yazdı" ile "preset hiç yazmadı" farklı şeyler. */
  const yazan = new MD.Preset('per_frame_1=monitor = 0;\n', { seed: 1 });
  yazan.frame(IN);
  assert.strictEqual(yazan.pool.has('monitor'), true);
  assert.strictEqual(yazan.get('monitor'), 0);

  const yazmayan = new MD.Preset('fDecay=0.9\n', { seed: 1 });
  yazmayan.frame(IN);
  assert.strictEqual(yazmayan.pool.has('monitor'), false);
  assert.strictEqual(yazmayan.get('monitor'), 0, 'get yine 0 dönmeli');
});

test('monitor kare başına SIFIRLANMIYOR', () => {
  /* Yerleşik kare değişkenleri her karede dosyadaki değere dönüyor
     (PF_RESET). `monitor` o listede DEĞİL: MilkDrop onu taşıyor, çünkü
     yazarın biriktirerek kullandığı durumlar var. */
  const p = new MD.Preset('per_frame_1=monitor = monitor + 1;\n', { seed: 1 });
  for (let i = 1; i <= 4; i++) {
    p.frame(IN);
    assert.strictEqual(p.get('monitor'), i, i + '. karede taşınmadı');
  }
});

test('monitor gerçekten presetin yazdığı değer', () => {
  const p = new MD.Preset('per_frame_1=monitor = bass * 2 + 0.5;\n', { seed: 1 });
  p.frame(IN);
  assert.ok(Math.abs(p.get('monitor') - 2.5) < 1e-9);
});

// ------------------------------------------------------------------- yol

test('motor değeri dışarı veriyor, yazılmamışsa null', () => {
  /* 0 dönmek "sıfır yazdı" ile "kimse yazmadı"yı aynı gösterirdi ve
     panelde ikisi çok farklı şeyler. */
  const fn = /monitorValue\(\) \{[\s\S]*?\n    \}/.exec(MODE);
  assert.ok(fn, 'monitorValue bulunamadı');
  assert.match(fn[0], /!P\.pool\.has\('monitor'\)\) return null/);
  assert.match(fn[0], /isFinite\(v\) \? v : null/,
    'NaN da null olmalı — panelde "NaN" yazması bilgi değil gürültü');
});

test('katman yığını ilk MilkDrop katmanını okuyor', () => {
  /* `palette()` ile aynı desen: değeri motor biliyor ama panel motora
     erişemiyor. */
  const fn = /milkdropMonitor\(\) \{[\s\S]*?\n    \}/.exec(LAYERS);
  assert.ok(fn, 'milkdropMonitor bulunamadı');
  assert.match(fn[0], /typeof e\.mode\.monitorValue === 'function'/);
  assert.match(fn[0], /if \(v !== null\) return v;/,
    'null dönen katman aramayı bitirmemeli');
  assert.match(fn[0], /return null;/);
});

test('değer YENİ bir IPC kanalı açmadan taşınıyor', () => {
  /* Ses ölçer mesajı zaten ~30 Hz akıyor. Ek kanal ek bakım demek ve bu
     değer için kare başına doğruluk gerekmiyor. */
  assert.match(VIS, /mdMonitor: stack\.milkdropMonitor\(\)/);
  const yeni = (VIS.match(/window\.api\.send[A-Z]\w*/g) || []);
  assert.ok(yeni.every((s) => !/Monitor/.test(s)),
    'monitor için ayrı bir gönderim eklenmemeli: ' + yeni.join(', '));
});

test('panel değeri paneli yeniden çizmeden güncelliyor', () => {
  /* Panel her karede yeniden çizilseydi ayar alanlarındaki odak ve imleç
     konumu kaybolurdu. */
  assert.match(ADMIN, /getElementById\('mdMonitorVal'\)/);
  assert.match(ADMIN, /window\.SVMdMonitor = d\.mdMonitor;/);
  assert.match(PANEL, /id: 'mdMonitorVal'/);
  const satir = /nodes\.push\(P\(\)\.row\('monitor'[\s\S]*?\)\)\);/.exec(PANEL);
  assert.ok(satir, 'panelde monitor satırı yok');
  assert.match(satir[0], /'—'/, 'yazılmamış preset için tire gösterilmeli');
  assert.match(satir[0], /toFixed\(4\)/);
});
