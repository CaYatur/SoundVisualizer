'use strict';
/* Serbest bant kaynakları (fband1..4): kullanıcının seçtiği Hz aralığı ve
 * dB penceresi.
 *
 * İki halka ayrı ölçülüyor: ses motorunun bandDb'si (bayt ölçeği ve güç
 * ortalaması) ve modülatörün dB'yi 0..1'e çevirip atak/bırakmayla izlemesi.
 * Sabit sekiz bant dokunulmadan kalmalı; yeni kaynak yönlendirilmedikçe
 * apply() aynı yapılandırmayı döndürmeli. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('../src/shared/modulation.js');
global.window = global.window || {};
require('../src/shared/defaults.js');
const D = global.window.SV;

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');
const close = (a, b, msg, eps) =>
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${msg}: ${a} ≠ ${b}`);

function loadAudio() {
  const win = { performance: { now: () => 1000 } };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/visualizer/audio.js'), ctx, { filename: 'audio.js' });
  return new win.SVAudio();
}

function frame(fill) {
  const freq = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) freq[i] = fill(i);
  return { freq, time: new Uint8Array(2048).fill(128), sampleRate: 48000 };
}

// Kutu i'nin merkezi i × 48000 / 2048 = i × 23,4375 Hz
const HZ = 48000 / 2048;

test('bandDb: bayt ölçeği -90..-18 dB', () => {
  const a = loadAudio();
  a.ingestFrame(frame(() => 255));
  close(a.bandDb(100, 1000), -18, 'tam bayt', 1e-6);
  a.ingestFrame(frame(() => 0));
  close(a.bandDb(100, 1000), -90, 'sıfır bayt', 1e-6);
  a.ingestFrame(frame(() => 128));
  close(a.bandDb(100, 1000), -90 + (128 / 255) * 72, 'orta bayt', 1e-6);
});

test('bandDb: kutular güçte ortalanır, aralık dışındakiler okunmaz', () => {
  const a = loadAudio();
  // 10. kutu (234 Hz) tam, gerisi sessiz
  a.ingestFrame(frame((i) => (i === 10 ? 255 : 0)));
  // 6..14. kutular: dokuz kutu, biri -18 dB
  const lo = 6 * HZ - 1, hi = 14 * HZ + 1;
  const want = 10 * Math.log10((Math.pow(10, -1.8) + 8 * Math.pow(10, -9)) / 9);
  close(a.bandDb(lo, hi), want, 'güç ortalaması', 1e-6);
  // dB ortalaması alınsaydı -82 dB olurdu; güç ortalaması tepeyi duyurur
  assert.ok(a.bandDb(lo, hi) > -28);
  // Tepe aralığın dışında: yalnız sessiz kutular okunur
  close(a.bandDb(11 * HZ, 20 * HZ), -90, 'aralık dışı tepe', 1e-6);
  // Sınırların sırası önemli değil
  close(a.bandDb(hi, lo), a.bandDb(lo, hi), 'ters sınırlar');
});

test('bandDb: kutu merkezi düşmeyen dar bant en yakın kutuyu okur', () => {
  const a = loadAudio();
  a.ingestFrame(frame((i) => (i === 10 ? 255 : 0)));
  close(a.bandDb(10 * HZ - 3, 10 * HZ + 3), -18, 'dar bant', 1e-6);
  assert.ok(isFinite(a.bandDb(20000, 20000)));
  assert.ok(isFinite(a.bandDb(1, 2)), 'DC kutusu yerine 1. kutu');
});

function cfgWith(freeBands) {
  return { modulation: { enabled: true, routes: [], lfos: [], envelopes: [], macros: [], random: {}, freeBands } };
}
const fixedDb = (db) => ({ bass: 0, mid: 0, treble: 0, level: 0, bandDb: () => db });

test('katalog dört serbest bant listeler', () => {
  const cat = M.catalog(cfgWith());
  for (let i = 1; i <= 4; i++) {
    const c = cat.find((x) => x.id === 'fband' + i);
    assert.ok(c, 'fband' + i + ' yok');
    assert.strictEqual(c.label, 'Serbest Bant ' + i);
    assert.strictEqual(c.group, 'Serbest Bant');
  }
});

test('dB penceresi: tabanda 0, tavanda 1, arada doğrusal', () => {
  const bands = [{ lo: 40, hi: 90, floor: -60, ceil: -20, attack: 0, release: 0 }];
  for (const [db, want] of [[-80, 0], [-60, 0], [-40, 0.5], [-30, 0.75], [-20, 1], [-5, 1]]) {
    const mod = new M.Modulator();
    mod.update(cfgWith(bands), fixedDb(db), 0, 1 / 60);
    close(mod.value('fband1'), want, db + ' dB', 1e-9);
  }
});

test('her bant kendi aralığını okur', () => {
  const seen = [];
  const audio = { bandDb: (lo, hi) => { seen.push([lo, hi]); return -40; } };
  const mod = new M.Modulator();
  mod.update(cfgWith([{ lo: 50, hi: 80 }, { lo: 3000, hi: 200 }]), audio, 0, 1 / 60);
  assert.deepStrictEqual(seen[0], [50, 80]);
  assert.deepStrictEqual(seen[1], [200, 3000], 'ters sınırlar yer değiştirir');
  // Ayarı olmayan bantlar varsayılanları okur
  assert.deepStrictEqual(seen[2], [M.FREE_BAND_DEFAULTS[2].lo, M.FREE_BAND_DEFAULTS[2].hi]);
  assert.deepStrictEqual(seen[3], [M.FREE_BAND_DEFAULTS[3].lo, M.FREE_BAND_DEFAULTS[3].hi]);
});

test('freeBand: bozuk alanlar varsayılana düşer, aralıklar sınırlanır', () => {
  const b = M.freeBand({ freeBands: [{ lo: 'x', hi: 1e6, floor: -200, ceil: -200.5, attack: -1, release: NaN }] }, 0);
  const d = M.FREE_BAND_DEFAULTS[0];
  assert.strictEqual(b.lo, d.lo);
  assert.strictEqual(b.hi, M.FREE_HZ_MAX);
  assert.strictEqual(b.floor, M.FREE_DB_MIN);
  assert.ok(b.ceil - b.floor >= 1, 'pencere en az 1 dB');
  assert.strictEqual(b.attack, 0);
  assert.strictEqual(b.release, d.release);
  assert.deepStrictEqual(M.freeBand({}, 1), Object.assign({}, M.FREE_BAND_DEFAULTS[1]));
});

test('varsayılan ayarlar motorun varsayılanlarıyla aynı', () => {
  assert.deepStrictEqual(D.defaultConfig().modulation.freeBands, M.FREE_BAND_DEFAULTS);
});

test('bandDb taşımayan ses nesnesinde kaynak 0', () => {
  const mod = new M.Modulator();
  mod.update(cfgWith(), { bass: 1, getBars: (n) => new Float32Array(n).fill(1) }, 0, 1 / 60);
  for (let i = 1; i <= 4; i++) assert.strictEqual(mod.value('fband' + i), 0);
  mod.update(cfgWith(), null, 0, 1 / 60);
  assert.strictEqual(mod.value('fband1'), 0);
});

test('atak ve bırakma kare hızından bağımsız', () => {
  const bands = [{ lo: 40, hi: 90, floor: -60, ceil: -20, attack: 0.1, release: 0.4 }];
  const run = (fps) => {
    const mod = new M.Modulator();
    const dt = 1 / fps;
    let up = 0;
    for (let i = 1; i <= Math.round(fps * 0.1); i++) { mod.update(cfgWith(bands), fixedDb(-20), i * dt, dt); }
    up = mod.value('fband1');
    for (let i = 1; i <= Math.round(fps * 0.4); i++) { mod.update(cfgWith(bands), fixedDb(-90), i * dt, dt); }
    return [up, mod.value('fband1')];
  };
  const [u30, d30] = run(30);
  const [u120, d120] = run(120);
  // Bir zaman sabiti sonra 1 - 1/e, sonra onun 1/e'si
  close(u30, 1 - Math.exp(-1), '30 fps atak', 1e-9);
  close(u120, 1 - Math.exp(-1), '120 fps atak', 1e-9);
  close(d30, u30 * Math.exp(-1), '30 fps bırakma', 1e-9);
  close(d120, u120 * Math.exp(-1), '120 fps bırakma', 1e-9);
});

test('yönlendirilmeyen serbest bant yapılandırmayı değiştirmez', () => {
  const cfg = cfgWith();
  cfg.visualizer = { glow: 0.3 };
  const mod = new M.Modulator();
  mod.update(cfg, fixedDb(-20), 0, 1 / 60);
  assert.strictEqual(mod.apply(cfg, 1 / 60), cfg);
});

test('yönlendirilen serbest bant hedefi sürer', () => {
  const cfg = cfgWith([{ floor: -60, ceil: -20, attack: 0, release: 0 }]);
  cfg.visualizer = { glow: 0.3 };
  cfg.modulation.routes = [{ id: 'r', source: 'fband1', target: 'visualizer.glow', min: 0, max: 2 }];
  const mod = new M.Modulator();
  mod.update(cfg, fixedDb(-40), 0, 1 / 60);
  close(mod.apply(cfg, 1 / 60).visualizer.glow, 1, 'yarım düzey, aralığın ortası');
  assert.strictEqual(cfg.visualizer.glow, 0.3, 'saklanan ayar değişmez');
});

test('panel serbest bantları çiziyor ve yeni dizeler çevrili', () => {
  const panel = read('src/admin/modulation-panel.js');
  assert.match(panel, /Serbest Bantlar \(4\)/);
  const dict = read('src/shared/i18n.js');
  for (const s of ['Serbest Bantlar (4)', 'Serbest Bant', 'Serbest Bant 1', 'Serbest Bant 4',
    'Alt Frekans', 'Üst Frekans', 'Taban (0)', 'Tavan (1)']) {
    assert.ok(dict.includes("'" + s + "':"), 'çeviri yok: ' + s);
  }
});
