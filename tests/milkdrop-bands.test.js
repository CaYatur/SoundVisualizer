'use strict';
/* MilkDrop'un KENDİ bant zinciri: `bass/mid/treb` ve `_att`ler.
 *
 * Zincir plugin.cpp DoCustomSoundAnalysis'ten (jecassis/foo_vis_milk2
 * 5b44cea). Testler "sayı çıkıyor mu"yu değil kaynağın ADIMLARINI sınıyor:
 * hangi örnekler okunuyor, bantların sınırları, toplamın FFT'den bağımsız
 * bir DFT ile tutması, katsayıların 30 fps'teki değerleri ve kare hızına
 * uyarlanması, sessizlik, tohumlama ve tavan. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../src/shared/milkdrop-audio.js');

const KEYS = ['bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att'];

// 2048 örneklik kronolojik tampon (en yeni örnek sonda); fn ±128 biriminde
function buf(fn) {
  const tb = new Uint8Array(2048);
  for (let j = 0; j < 2048; j++) tb[j] = Math.max(0, Math.min(255, Math.round(128 + fn(j))));
  return tb;
}
// 1024 noktalı dönüşümün `bin`. gözüne düşen sinüs
const tone = (bin, amp) => buf((j) => amp * Math.sin(2 * Math.PI * bin * j / 1024));
// Üç bandın üçüne de düşen karışım (~11, ~99 ve ~212. gözler)
const mix = (amp) => buf((j) => amp * (Math.sin(j * 0.07) + 0.6 * Math.sin(j * 0.61 + 1) +
  0.4 * Math.sin(j * 1.3)));
const close = (got, want, msg) => assert.ok(
  Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), msg + ': ' + got + ' / ' + want);

test('sabitler MilkDrop\'unkiler', () => {
  // NUM_FFT_SAMPLES * i / 6, C'nin tam sayı bölmesiyle
  for (let i = 0; i <= 3; i++) assert.strictEqual(A.BAND_EDGES[i], Math.floor(512 * i / 6));
  assert.deepStrictEqual(A.BAND_EDGES, [0, 85, 170, 256]);
  assert.strictEqual(A.RATE_ATT_UP, 0.2);
  assert.strictEqual(A.RATE_ATT_DOWN, 0.5);
  assert.strictEqual(A.RATE_LONG_FAST, 0.9);
  assert.strictEqual(A.RATE_LONG, 0.992);
  assert.strictEqual(A.FAST_FRAMES, 50);
  assert.strictEqual(A.BAND_GUARD, 0.001);
});

/* Bant toplamları FFT kodundan BAĞIMSIZ bir yoldan, doğrudan DFT ile
   yeniden hesaplanıyor: pencere, sıfır doldurma, eşitleyici ve bant
   sınırları tek seferde doğrulanıyor. */
test('bant toplamları doğrudan DFT ile tutuyor', () => {
  const b = new A.MilkdropBands();
  const tb = mix(40);
  b._analyze(tb);
  const off = tb.length - 576;
  const ref = [0, 0, 0];
  for (let k = 0; k < 256; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < 576; n++) {
      const x = (tb[off + n] - 128) * (0.5 + 0.5 * Math.sin(n * 2 * Math.PI / 576 - Math.PI / 2));
      re += x * Math.cos(2 * Math.PI * k * n / 1024);
      im -= x * Math.sin(2 * Math.PI * k * n / 1024);
    }
    ref[k < 85 ? 0 : k < 170 ? 1 : 2] += -0.02 * Math.log((512 - k) / 512) * Math.hypot(re, im);
  }
  for (let i = 0; i < 3; i++) {
    assert.ok(ref[i] > 0, 'bant ' + i + ' boş');
    assert.ok(Math.abs(b.imm[i] / ref[i] - 1) < 1e-3, 'bant ' + i + ': ' + b.imm[i] + ' / ' + ref[i]);
  }
});

/* MilkDrop'un bantları `fWaveform[0]`dan, yani o anki EN YENİ 576 örnekten.
   2048'lik tamponun başından okumak ~30 ms eski sesi okumak olurdu. */
test('en yeni 576 örnek okunuyor, eskiler değil', () => {
  const b = new A.MilkdropBands();
  const LAST = 2048 - 576;
  b._analyze(buf((j) => (j < LAST ? 60 * Math.sin(j * 0.5) : 0)));
  assert.deepStrictEqual(b.imm, [0, 0, 0], 'ses yalnız eski kısımda');
  b._analyze(buf((j) => (j >= LAST ? 60 * Math.sin(j * 0.5) : 0)));
  assert.ok(b.imm[0] > 1, 'ses en yeni kısımda: ' + b.imm);
});

/* "only look at bottom half of spectrum (hence divide by 6 instead of 3)":
   512 gözün üst yarısı hiçbir banda girmiyor. */
test('bir ton kendi bandına düşüyor; 256. gözün üstü sayılmıyor', () => {
  const b = new A.MilkdropBands();
  const at = (bin) => { b._analyze(tone(bin, 100)); return b.imm.slice(); };
  const lo = at(40), md = at(128), hi = at(213), top = at(380);
  assert.ok(lo[0] > 4 * Math.max(lo[1], lo[2]), 'bas: ' + lo);
  assert.ok(md[1] > 4 * Math.max(md[0], md[2]), 'orta: ' + md);
  assert.ok(hi[2] > 4 * Math.max(hi[0], hi[1]), 'tiz: ' + hi);
  assert.ok(top[0] + top[1] + top[2] < 0.1 * hi[2], 'üst yarı: ' + top);
});

test('sabit seste oranlar tam 1', () => {
  const b = new A.MilkdropBands();
  for (let i = 0; i < 600; i++) {
    const r = b.update(1 / 60, mix(40));
    for (const k of KEYS) close(r[k], 1, k + ' kare ' + i);
  }
});

/* AudioEngine ilk kare gelene kadar SIFIRLARLA dolu (128 değil). Sabit bir
   tampon ses sayılsaydı pencerelenmiş doğru akım alt gözlere sızar ve
   gerçek ses gelmeden ortalamaları tohumlardı. Hızlı evre de sessizlikte
   harcanmamalı. */
test('sessizlik ve sabit tampon tohumlamıyor; ilk sesli kare 1', () => {
  const b = new A.MilkdropBands();
  const quiet = new Uint8Array(2048).fill(128);
  const zeros = new Uint8Array(2048);
  for (let i = 0; i < 100; i++) {
    const r = b.update(1 / 60, i % 2 ? quiet : zeros);
    for (const k of KEYS) assert.strictEqual(r[k], 1, k);
  }
  assert.strictEqual(b.seeded, false);
  assert.strictEqual(b.frames, 0, 'hızlı evre sessizlikte harcanmıyor');
  const r = b.update(1 / 60, mix(40));
  assert.strictEqual(b.seeded, true);
  for (const k of KEYS) close(r[k], 1, k);
});

test('30 fps\'te bir karenin güncellemesi kaynaktaki formül', () => {
  const b = new A.MilkdropBands();
  for (let i = 0; i < 200; i++) b.update(1 / 30, mix(20)); // hızlı evre bitti
  const avg0 = b.avg.slice(), long0 = b.long.slice();
  b.update(1 / 30, mix(60));
  const imm = b.imm.slice();
  for (let i = 0; i < 3; i++) {
    assert.ok(imm[i] > avg0[i], 'yükseliş, bant ' + i);
    close(b.avg[i], avg0[i] * 0.2 + imm[i] * 0.8, 'avg yükselişte 0,2, bant ' + i);
    close(b.long[i], long0[i] * 0.992 + imm[i] * 0.008, 'long_avg 0,992, bant ' + i);
  }
  const avg1 = b.avg.slice();
  b.update(1 / 30, mix(20));
  for (let i = 0; i < 3; i++) {
    close(b.avg[i], avg1[i] * 0.5 + b.imm[i] * 0.5, 'avg düşüşte 0,5, bant ' + i);
  }
});

/* MilkDrop `GetFrame() < 50` diyor: 0. kare ve sonraki 49. Burada 0. kare
   tohum karesi. */
test('hızlı evre: tohumdan sonraki 49 güncelleme 0,9, sonra 0,992', () => {
  const b = new A.MilkdropBands();
  for (let i = 0; i < 49; i++) b.update(1 / 30, mix(20));
  assert.strictEqual(b.frames, 49);
  let l0 = b.long.slice();
  b.update(1 / 30, mix(60));
  close(b.long[0], l0[0] * 0.9 + b.imm[0] * (1 - 0.9), '49. güncelleme hâlâ hızlı');
  l0 = b.long.slice();
  b.update(1 / 30, mix(60));
  close(b.long[0], l0[0] * 0.992 + b.imm[0] * (1 - 0.992), '50. kareden sonra yavaş');
});

/* AdjustRateToFPS: 30 fps için yazılmış katsayı r, kare başına r^(30/fps).
   Hızlı evre kare SAYISINA bağlı (MilkDrop'ta da), o yüzden karşılaştırma
   yavaş evrede. */
test('yavaş evrede sonuç kare hızından bağımsız', () => {
  const run = (fps) => {
    const b = new A.MilkdropBands();
    let r;
    for (let i = 0; i < fps * 10; i++) r = b.update(1 / fps, mix(20));
    for (let i = 0; i < fps; i++) r = b.update(1 / fps, mix(60));
    return r;
  };
  const a = run(30), c = run(144);
  for (const k of KEYS) {
    assert.ok(Math.abs(a[k] - c[k]) < 1e-4 * a[k], k + ': 30 fps ' + a[k] + ', 144 fps ' + c[k]);
  }
});

test('vuruş: anlık oran fırlıyor, _att arada kalıyor', () => {
  const b = new A.MilkdropBands();
  for (let i = 0; i < 300; i++) b.update(1 / 60, mix(10));
  const r = b.update(1 / 60, mix(60));
  assert.ok(r.bass > 4, 'bass ' + r.bass);
  assert.ok(r.bass_att > 1.5 && r.bass_att < r.bass, 'bass_att ' + r.bass_att);
});

test('sesten sonra sessizlik: oranlar 0 (MilkDrop da 0 veriyor)', () => {
  const b = new A.MilkdropBands();
  for (let i = 0; i < 120; i++) b.update(1 / 60, mix(40));
  const r = b.update(1 / 60, new Uint8Array(2048).fill(128));
  for (const k of ['bass', 'mid', 'treb']) assert.strictEqual(r[k], 0, k);
  assert.ok(r.bass_att > 0.5 && r.bass_att < 1, '_att bir karede sıfırlanmıyor: ' + r.bass_att);
});

/* MilkDrop'ta tavan yok: uzun bir sessizlikte long_avg sıfıra yaklaşıyor
   ve ses döndüğünde oran yüzlerce kata çıkıyor. */
test('uzun sessizlikten sonra ani ses tavanda kalıyor', () => {
  const b = new A.MilkdropBands();
  for (let i = 0; i < 120; i++) b.update(1 / 60, tone(40, 80));
  const quiet = new Uint8Array(2048).fill(128);
  for (let i = 0; i < 60 * 60; i++) b.update(1 / 60, quiet);
  const r = b.update(1 / 60, tone(40, 80));
  for (const k of KEYS) assert.ok(isFinite(r[k]) && r[k] <= A.BAND_MAX, k + '=' + r[k]);
  assert.strictEqual(r.bass, A.BAND_MAX);
});

test('geçersiz ya da kısa girdi nötr, bozuk dt sonlu', () => {
  const b = new A.MilkdropBands();
  for (const bad of [null, undefined, new Uint8Array(0), new Uint8Array(575)]) {
    const r = b.update(1 / 60, bad);
    for (const k of KEYS) assert.strictEqual(r[k], 1, k);
  }
  b.update(1 / 60, mix(40));
  for (const dt of [NaN, -1, 0, Infinity]) {
    const r = b.update(dt, mix(60));
    for (const k of KEYS) assert.ok(isFinite(r[k]), k + ' dt=' + dt);
  }
});

/* Mod tarafı: uyum açıkken ve zaman verisi varken MilkDrop'un bantları,
   yoksa eski yol. Panel önizlemesi ve ölçüm ortamı zaman verisi vermeyebilir. */
test('mod: uyum açıkken ve zaman verisi varken MilkdropBands', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/visualizer/modes/milkdrop.js'), 'utf-8');
  const i = src.indexOf('new MDA.MilkdropBands()');
  assert.ok(i > 0, 'MilkdropBands kurulmuyor');
  const win = src.slice(i - 400, i + 600);
  assert.match(win, /this\._wantAcc !== false && tbA && tbA\.length >= MDA\.SPEC_IN/);
  assert.match(win, /new MDA\.MilkdropAudio\(\)/, 'eski yol düşme yolu olarak kalıyor');
});
