'use strict';
/* SAHNE GEÇİŞİNDE SÜREKLİ KATMANLAR.
 *
 * Geçiş eski sahnenin katmanlarını giden yığına devredip varış sahnesinin
 * hepsini SIFIRDAN kuruyordu. MilkDrop için bu; presetin baştan başlaması,
 * geri besleme izinin silinmesi ve otomatik geçişin elle seçilen presete
 * dönmesi demekti. Dinamik renk teması her parçada paleti değiştiriyor ve
 * palet sahne imzasında — dinamik tema ve sahne geçişi açık bir kullanıcıda
 * bu HER PARÇADA oluyordu, oysa MilkDrop o renkleri hiç okumuyor.
 *
 * Yığın burada DOM'suz sınanıyor: tuval ve mod sahte, olan her şey bir
 * günlüğe düşüyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

function fakeCanvas(log, name) {
  const c = { name, parentNode: null };
  c.parentNode = { removeChild(x) { log.push('sök:' + x.name); x.parentNode = null; } };
  return c;
}
function fakeMode(log, name, keep) {
  const m = {
    dispose() { log.push('at:' + name); },
    draw() { log.push('çiz:' + name); },
  };
  if (keep) m.keepAcrossTransitions = true;
  return m;
}
function entry(log, key, keep) {
  return {
    layer: { id: key, kind: 'visualizer', type: key },
    key, canvas: fakeCanvas(log, key), ctx: null, mode: fakeMode(log, key, keep),
  };
}
const SPEC = { type: 'crossfade', duration: 0.7 };

test('sürekli katman varış yığınında KALIYOR, giden yığına vekil gidiyor', () => {
  const log = [];
  const md = entry(log, 'md', true);
  const bg = entry(log, 'bg', false);
  const s = new L.LayerStack(null, {});
  s.entries = [bg, md];
  s.beginTransition({}, SPEC, new Set(['bg', 'md']));
  assert.deepStrictEqual(s.entries, [md], 'yalnız sürekli katman kalmalı — AYNI örnek');
  const out = s.trans.stack.entries;
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0], bg, 'katılmayan katman eskisi gibi devrediliyor');
  assert.strictEqual(out[1].proxyOf, md, 'giden yığında vekil');
  assert.strictEqual(out[1].canvas, md.canvas, 'vekil AYNI tuvali gösteriyor');
  assert.strictEqual(out[1].mode, null, 'vekilin modu yok');
  assert.deepStrictEqual(log, ['sök:bg'], "canlı tuval DOM'dan sökülmemeli: " + log.join(','));
});

test('varış sahnesinde OLMAYAN sürekli katman sönüp atılıyor', () => {
  const log = [];
  const md = entry(log, 'md', true);
  const s = new L.LayerStack(null, {});
  s.entries = [md];
  s.beginTransition({}, SPEC, new Set(['baska']));
  assert.deepStrictEqual(s.entries, []);
  assert.strictEqual(s.trans.stack.entries[0], md, 'kalmıyorsa giden yığına devredilmeli');
  s.endTransition();
  assert.ok(log.includes('at:md'), 'geçiş bitince atılmalı: ' + log.join(','));
});

test('katılmayan mod, anahtarı kalsa da eskisi gibi yeniden kuruluyor', () => {
  /* Varsayılan davranış DEĞİŞMİYOR: yalnız açıkça katılan modlar kalıyor.
     Çubuklar gibi durumsuz bir modun geçişte iki kez çizilmesi, çapraz
     geçişin kendisi. */
  const log = [];
  const bars = entry(log, 'bars', false);
  const s = new L.LayerStack(null, {});
  s.entries = [bars];
  s.beginTransition({}, SPEC, new Set(['bars']));
  assert.deepStrictEqual(s.entries, []);
  assert.strictEqual(s.trans.stack.entries[0], bars);
});

test('geçiş bitince yalnız giden katman atılıyor, canlıya dokunulmuyor', () => {
  const log = [];
  const md = entry(log, 'md', true);
  const bg = entry(log, 'bg', false);
  const s = new L.LayerStack(null, {});
  s.entries = [bg, md];
  s.beginTransition({}, SPEC, new Set(['bg', 'md']));
  log.length = 0;
  s.endTransition();
  assert.deepStrictEqual(log, ['at:bg'], 'yalnız giden katman atılmalı: ' + log.join(','));
  assert.ok(md.canvas.parentNode, "canlı tuval DOM'da kalmalı");
  assert.deepStrictEqual(s.entries, [md]);
});

test('vekil ne çiziliyor ne atılıyor', () => {
  /* Çizilseydi eski sahnenin maskesi ve katman efekti canlı tuvalin
     üstüne İKİNCİ kez binerdi; atılsaydı canlı tuval silinirdi. */
  const log = [];
  const md = entry(log, 'md', true);
  const s = new L.LayerStack(null, {});
  s.entries = [md];
  s.beginTransition({}, SPEC, new Set(['md']));
  const vekil = s.trans.stack.entries[0];
  s.trans.stack._drawEntry(vekil, {}, {}, 0, 0.016);
  s.trans.stack._disposeEntry(vekil);
  assert.deepStrictEqual(log, [], 'vekile dokunulmamalı: ' + log.join(','));
  assert.ok(md.canvas.parentNode);
});

test('arka arkaya iki geçiş canlı katmanı atmıyor', () => {
  /* İki hızlı palet değişimi: ikinci beginTransition ilkini endTransition
     ile kapatıyor. Vekil atılmasaydı bile bu yol canlı örneğe gitmemeli. */
  const log = [];
  const md = entry(log, 'md', true);
  const s = new L.LayerStack(null, {});
  s.entries = [md];
  s.beginTransition({}, SPEC, new Set(['md']));
  s.beginTransition({}, SPEC, new Set(['md']));
  assert.ok(!log.includes('at:md'), 'canlı MilkDrop atılmış: ' + log.join(','));
  assert.deepStrictEqual(s.entries, [md]);
  assert.strictEqual(s.trans.stack.entries[0].proxyOf, md);
});

test('anahtar kümesi verilmezse eski davranış', () => {
  // Geriye uyum: üçüncü argümanı olmayan bir çağıran hiçbir şeyi tutmuyor
  const log = [];
  const md = entry(log, 'md', true);
  const s = new L.LayerStack(null, {});
  s.entries = [md];
  s.beginTransition({}, SPEC);
  assert.deepStrictEqual(s.entries, []);
  assert.strictEqual(s.trans.stack.entries[0], md);
});

// ------------------------------------------------------------ bağlantılar

const LAYERS = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'layers.js'), 'utf-8');

test('setConfig varış katmanlarını geçişten ÖNCE çözüp anahtarlarını veriyor', () => {
  const fn = /setConfig\(cfg\) \{[\s\S]*?\n    \}/.exec(LAYERS)[0];
  const w = fn.indexOf('const wanted = resolve(cfg);');
  const b = fn.indexOf('this.beginTransition(');
  assert.ok(w > 0 && b > w, 'varış katmanları geçişten önce çözülmeli');
  assert.match(fn, /\}, wantedKeys\);/);
  assert.strictEqual(fn.split('const wanted = resolve(cfg);').length, 2, 'bir kez çözülmeli');
});

test('MilkDrop geçişte kalmaya katılıyor', () => {
  const MODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
  assert.match(MODE, /constructor\(canvas\) \{[\s\S]{0,400}this\.keepAcrossTransitions = true;/);
});
