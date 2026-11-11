'use strict';
/* Boş görünen önizlemeler (#905). Kullanıcı mod seçicide Havai Fişek, Şimşek ve Spektrogram'ın
   boş, birkaç modun yarım göründüğünü bildirdi. Ölçülen nedenler:
     - Örnek seste bas hep tavandaydı (SVAudio basi 1,00-1,00): vuruş algılayıcı 5 saniyede bir
       kez tetikleniyordu. Vuruşla çalışan modlar panel demosunda da küçük resimde de boştu.
     - Küçük resim 1,5. saniyedeki tek kareydi: kayan ve biriken modlar henüz dolmamıştı.
     - İpler fiziği kare hızına bağlıydı, ipler ekranın dışına sarkıyordu (canlıda da).
     - Dalgalı ızgarada halka tepesi cephede sıfırdı; küçük boyda halka görünmüyordu.
     - Havai fişekte sürtünme patlamayı kısa kenarın %5-8'inde durduruyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const D = require('../src/shared/demo-audio.js');

// ------------------------------------------------------------------ örnek ses tayfı

test('örnek tayf: bas tavana dayanmıyor, vuruş bas kutularında iz bırakıyor', () => {
  const out = new Uint8Array(1024);
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < 240; i++) {
    D.spectrum(i / 60, out);
    let s = 0;
    for (let k = 0; k < 16; k++) s += out[k];
    const m = s / 16;
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
    assert.ok(out[0] < 255 && out[4] < 255, 't=' + (i / 60).toFixed(2) + ' bas kutusu tavanda');
  }
  assert.ok(hi - lo > 60, 'vuruş bas bandında görünür bir fark yaratıyor: ' + lo + '-' + hi);
});

test('örnek tayf: vuruş yalnız 0-140 Hz, üst kutular vuruşla tavana vurmuyor', () => {
  const peak = new Uint8Array(1024);
  const before = new Uint8Array(1024);
  D.spectrum(2.0, peak); // vuruşun tam başı
  D.spectrum(1.49, before); // bir önceki vuruşun sonu
  for (const k of [300, 512, 800, 1000]) {
    assert.ok(peak[k] < 200, 'kutu ' + k + ' vuruşta ' + peak[k]);
    // Tepede hi-hat da var (saniyede dört): ondan gelen artış ~70; eski eğride vuruş bu kutuları 255'e vuruyordu
    if (k <= 512) assert.ok(Math.abs(peak[k] - before[k]) < 60, 'kutu ' + k + ' vuruşla sıçradı: ' + before[k] + ' → ' + peak[k]);
  }
});

test('örnek tayf deterministik ve iki yer aynı eğriyi kullanıyor', () => {
  const a = new Uint8Array(512);
  const b = new Uint8Array(512);
  D.spectrum(3.21, a);
  D.spectrum(3.21, b);
  assert.deepStrictEqual(a, b);
  const pv = read('src/admin/preview.js');
  assert.match(pv, /D\.spectrum\(t, synthFreq\);/, 'panel önizlemesi');
  assert.doesNotMatch(pv, /Math\.pow\(1 - n \* 7, 6\)/, 'eski tavana vuran eğri kalmadı');
  const th = read('src/thumbs/mode-thumbs.js');
  assert.match(th, /DEMO\.spectrum\(t, freq\);/, 'küçük resimler');
  assert.doesNotMatch(th, /Math\.pow\(1 - n \* 7, 6\)/);
});

test('örnek seste vuruş algılayıcı saniyede iki vuruşu yakalıyor (bas bandı ortalamasıyla)', () => {
  const O = require('../src/shared/onset.js');
  const det = new O.Onset({ refractory: 0.14 });
  const out = new Uint8Array(1024);
  let hits = 0;
  for (let i = 0; i < 360; i++) {
    D.spectrum(i / 60, out);
    let s = 0;
    for (let k = 0; k < 12; k++) s += out[k];
    if (det.push(s / 12 / 255, 1 / 60) > 0) hits++;
  }
  // 6 saniye, 120 BPM: 12 vuruş; ısınma için pay
  assert.ok(hits >= 9 && hits <= 13, 'vuruş sayısı ' + hits);
});

// ------------------------------------------------------------------ küçük resim seçimi

test('küçük resim: 6 saniye çiziliyor, en dolu aday kare saklanıyor', () => {
  const M = require('../src/main/mode-thumbs.js');
  assert.strictEqual(M.RECIPE.frames, 180);
  assert.strictEqual(M.RECIPE.pickFrom, 60);
  assert.strictEqual(M.RECIPE.pickEvery, 6);
  const th = read('src/thumbs/mode-thumbs.js');
  assert.match(th, /if \(s > best\) \{ best = s; keep\(R\); \}/);
  assert.match(th, /return \(lit - 2 \* blown\) \/ \(d\.length \/ 4\);/, 'beyaza doymuş flaş karesi seçilmiyor');
  // Kendi başına boş kalan iki mod örnekle çiziliyor
  assert.match(th, /type === 'custom' && window\.SVPresets/);
  assert.match(th, /source: 'manual',\s*manual: \{ title: 'Midnight Signal'/);
});

// ------------------------------------------------------------------ mod harness'ı

function fakeCanvas(W, H, log) {
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'arc') return (x, y, r) => { if (log) log.push({ x, y, r }); };
      return () => {};
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  return { width: W, height: H, getContext: () => ctx };
}

function loadModes() {
  global.window = global.window || {};
  const w = global.window;
  w.SV = w.SV || {};
  w.SV.hexToRgb01 = w.SV.hexToRgb01 || (() => [1, 1, 1]);
  w.SV.sampleThemeColor = w.SV.sampleThemeColor || (() => '#ffffff');
  w.SVGlow = w.SVGlow || class { apply() {} };
  w.SVOnset = require('../src/shared/onset.js');
  for (const f of ['generative.js', 'extras.js']) {
    delete require.cache[require.resolve('../src/visualizer/modes/' + f)];
    require('../src/visualizer/modes/' + f);
  }
  return w.SVModes;
}

const VIS = { color: '#ffffff', color2: '#ffffff', colorMode: 'custom', lineWidth: 3, glow: 0, sensitivity: 1, barCount: 160, thickness: 0.5, gap: 0.2 };
const quietAudio = { bass: 0.4, mid: 0.3, treble: 0.2, level: 0.3, getBars: (n) => new Array(n).fill(0.5) };

test('ipler: sarkma kare hızından ve çözünürlükten bağımsız, en alttaki ip ekranda', () => {
  const Modes = loadModes();
  const sag = {};
  // Sarkma ~3 saniyede oturuyor (ölçüldü); 4 saniye yeterli, test süresi kısa kalsın
  for (const [W, H, fps] of [[1920, 1080, 30], [1920, 1080, 60], [1920, 1080, 144], [480, 270, 30]]) {
    const m = new Modes.ropes(fakeCanvas(W, H));
    for (let i = 0; i < fps * 4; i++) m.draw(quietAudio, { visualizer: Object.assign({}, VIS, { barCount: 100 }) }, i / fps, 1 / fps);
    const top = m.ropes[0];
    const bot = m.ropes[m.ropes.length - 1];
    const mid = (r) => r[(r.length / 2) | 0].y / H;
    sag[W + 'x' + H + '@' + fps] = [mid(top), mid(bot)];
    assert.ok(mid(top) > 0.2 && mid(top) < 0.4, W + 'x' + H + '@' + fps + ' üst ip ' + mid(top).toFixed(2));
    assert.ok(mid(bot) < 1, W + 'x' + H + '@' + fps + ' alt ip ekran dışında: ' + mid(bot).toFixed(2));
  }
  const tops = Object.values(sag).map((s) => s[0]);
  assert.ok(Math.max(...tops) - Math.min(...tops) < 0.08, 'kare hızına bağlı: ' + JSON.stringify(sag));
});

test('havai fişek: tek patlama kısa kenarın en az %10\'una açılıyor', () => {
  const Modes = loadModes();
  const W = 960;
  const H = 540;
  const m = new Modes.fireworks(fakeCanvas(W, H));
  let fired = false;
  m.beat = { hit: () => (fired ? 0 : ((fired = true), 0.2)) };
  let reach = 0;
  for (let i = 0; i < 90; i++) {
    m.draw(quietAudio, { visualizer: VIS }, i / 60, 1 / 60);
    if (i === 0) var c = { x: m.parts[0].x, y: m.parts[0].y }; // eslint-disable-line no-var
    for (const p of m.parts) reach = Math.max(reach, Math.hypot(p.x - c.x, p.y - c.y));
  }
  assert.ok(reach / Math.min(W, H) > 0.1, 'patlama yarıçapı ' + (reach / Math.min(W, H)).toFixed(3));
});

test('dalgalı ızgara: halka küçük boyda da görünüyor (tepe cephede)', () => {
  const Modes = loadModes();
  for (const [W, H] of [[480, 270], [1920, 1080]]) {
    const log = [];
    const m = new Modes.ripplegrid(fakeCanvas(W, H, log));
    m.beat = { hit: () => 0 };
    m.waves = [{ x: W / 2, y: H / 2, r: Math.min(W, H) * 0.3, s: 0.2 }];
    m.draw(quietAudio, { visualizer: VIS }, 0, 1 / 60);
    const base = Math.min(...log.map((a) => a.r));
    const big = log.filter((a) => a.r > base * 1.8).length;
    assert.ok(big >= 6, W + 'x' + H + ': halkada büyüyen nokta ' + big);
  }
});
