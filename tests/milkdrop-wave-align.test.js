'use strict';
/* DALGALAR EN YENİ SESİ, İKİ KANALDAN, HİZALANMIŞ OKUYOR.
 *
 * Varsayılan dalga ve özel dalgalar 2048'lik tamponun en eski 576 örneğini
 * okuyordu — sesin ~30 ms gerisinden; sağ kanal yerine tek kanalın 128
 * örnek ötesi çiziliyordu; ve MilkDrop'un dalgayı ekranda yerinde tutan
 * hizalaması yoktu.
 *
 * `MilkdropWaves` (src/shared/milkdrop-audio.js) MilkDrop'un yolunu
 * kuruyor: kanal başına en yeni 576 örnek, pluginshell.cpp:1526-1667'deki
 * kaba-inceye hizalama, 480 geçerli örnek ve sıfırlanan kuyruk. Buradaki
 * testlerin çoğu onu ÇALIŞTIRIYOR: indis politikası ve hizalamanın
 * davranışı render ölçümünde görünmez — bir dalganın ucundaki 16 örnek
 * bir presetin canlı mı ölü mü olduğunu değiştirmiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const A = require('../src/shared/milkdrop-audio.js');
const W = A.WAVE_ALIGN;

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const method = (sig) => {
  const m = new RegExp(sig.replace(/[()]/g, '\\$&') + ' \\{[\\s\\S]*?\\n    \\}').exec(BODY);
  assert.ok(m, sig + ' bulunamadı');
  return m[0];
};

// 128 merkezli bayt dizisi: sig(t) örnek başına -1..1
function bytes(len, sig) {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (128 + Math.max(-1, Math.min(1, sig(i))) * 127) | 0;
  return b;
}
const smooth = (t) => 0.45 * Math.sin(t * 0.0211) + 0.3 * Math.sin(t * 0.0537 + 0.7)
  + 0.15 * Math.sin(t * 0.1291 + 2.1);

// ------------------------------------------------------------ sabitler

test('hizalama: MilkDrop\'un sabitleri', () => {
  assert.strictEqual(A.WAVE_BUF, 576, 'NUM_AUDIO_BUFFER_SAMPLES');
  assert.strictEqual(A.WAVE_VALID, 480, 'NUM_WAVEFORM_SAMPLES');
  // floor(log2(576 - 480)) = 6
  assert.strictEqual(A.ALIGN_LEVELS, Math.floor(Math.log2(576 - 480)));
  assert.deepStrictEqual(W.size, [576, 288, 144, 72, 36, 18]);
  assert.deepStrictEqual(W.slack, [96, 48, 24, 12, 6, 3]);
});

/* Ağırlık üçgen: `n < cs/2` (tam sayı bölmesi) için 2n/cs, sonra
   (cs-1-n)*2/cs; ardından (w - 0,8)*5 + 0,8 ve [0, 1]'e kırpma. Ortası
   1, kenarları 0 — pencere ortasının eşleşmesi kenarlardan önemli. */
test('hizalama: ağırlıklar ve sıfır olmayan aralık', () => {
  assert.deepStrictEqual(W.first, [154, 77, 39, 20, 10, 5]);
  assert.deepStrictEqual(W.last, [325, 162, 80, 39, 19, 9]);
  for (let o = 0; o < 6; o++) {
    const w = W.weight[o];
    const cs = W.size[o] - W.slack[o];
    assert.strictEqual(w.length, cs);
    assert.strictEqual(w[cs >> 1], 1, 'orta 1, kat ' + o);
    assert.strictEqual(w[W.first[o] - 1], 0, 'ilkten önce 0, kat ' + o);
    assert.strictEqual(w[W.last[o] + 1], 0, 'sondan sonra 0, kat ' + o);
    for (let n = 0; n < cs; n++) {
      assert.ok(w[n] >= 0 && w[n] <= 1, 'aralık dışı ağırlık');
      assert.strictEqual(w[n], w[cs - 1 - n], 'simetri, kat ' + o + ' n ' + n);
      if (n >= W.first[o] && n <= W.last[o]) assert.ok(w[n] > 0, 'aralıkta sıfır ağırlık');
    }
  }
  // Uçtaki değer 32 bitlik aritmetikle: (308/480 - 0,8) * 5 + 0,8
  const f = Math.fround;
  const e = f(f(f(f(308 / 480) - f(0.8)) * 5) + f(0.8));
  assert.strictEqual(W.weight[0][154], e);
});

/* Önceki pencereden yalnız 480 örnek kopyalanıyor ve kaynakta gerisi
   başlatılmamış bellek. Ağırlıkların sıfır olmayan aralığı hiçbir katta
   oraya uzanmamalı; yeni pencerede de kaydırma payıyla birlikte dizinin
   içinde kalmalı. */
test('hizalama: okumalar kopyalanan 480 örneğin ve katın içinde', () => {
  for (let o = 0; o < 6; o++) {
    assert.ok((W.last[o] + 1) << o <= 480, 'önceki pencere, kat ' + o);
    assert.ok(W.last[o] + W.slack[o] - 1 < W.size[o], 'yeni pencere, kat ' + o);
  }
  // Davranışla da: önceki pencerenin kullanılmayan kısmı sonucu değiştirmiyor
  const a = new A.MilkdropWaves(), b = new A.MilkdropWaves();
  const f1 = bytes(2048, (t) => smooth(t));
  a.update(f1, f1); b.update(f1, f1);
  for (let ch = 0; ch < 2; ch++) {
    const p = b._prev[ch], old = b._old[ch];
    for (let i = 0; i < 576; i++) if (i < p || i >= p + 480) old[i] = 1e6 * ((i % 7) - 3);
  }
  const f2 = bytes(2048, (t) => smooth(t + 13));
  a.update(f2, f2); b.update(f2, f2);
  assert.deepStrictEqual(b.offset, a.offset);
  assert.deepStrictEqual(Array.from(b.data), Array.from(a.data));
});

// ------------------------------------------------------------ davranış

test('hizalama: aynı ses tekrarlanınca kaydırma ve çıktı değişmiyor', () => {
  const w = new A.MilkdropWaves();
  const f = bytes(2048, (t) => 0.8 * Math.sin(t * 0.05));
  w.update(f, f);
  const first = w.offset.slice();
  const out = Array.from(w.data);
  for (let k = 0; k < 5; k++) {
    w.update(f, f);
    assert.deepStrictEqual(w.offset, first);
    assert.deepStrictEqual(Array.from(w.data), out);
  }
});

/* Ses kare başına bir örnek kayarsa doğru kaydırma bir öncekinin bir
   eksiği ve hizalanmış pencere bir öncekinin AYNISI — ekrandaki dalga
   yerinde duruyor. */
test('hizalama: yavaş kayan ses yerinde duruyor', () => {
  const w = new A.MilkdropWaves();
  let prevOff = -1, prev = null;
  for (let f = 0; f < 40; f++) {
    const b = bytes(2048, (t) => smooth(t + f));
    w.update(b, b);
    if (prev) {
      assert.strictEqual(w.offset[0], prevOff - 1, 'kare ' + f);
      assert.deepStrictEqual(Array.from(w.left.subarray(0, 480)), prev, 'kare ' + f);
    }
    prevOff = w.offset[0];
    prev = Array.from(w.left.subarray(0, 480));
  }
});

/* Periyodik bir ses (64 örnek) kareler arasında ne kadar kayarsa kaysın
   96'lık payın içinde bir periyot hep bulunuyor ve pencere her karede
   aynı. */
test('hizalama: periyodik ses her kaymada yerinde duruyor', () => {
  const sig = (t) => 0.8 * Math.sin(2 * Math.PI * t / 64) + 0.1 * Math.sin(4 * Math.PI * t / 64 + 1);
  for (const step of [5, 37, 200, 1001]) {
    const w = new A.MilkdropWaves();
    let prev = null;
    for (let f = 0; f < 30; f++) {
      const b = bytes(2048, (t) => sig(t + f * step));
      w.update(b, b);
      const cur = Array.from(w.left.subarray(0, 480));
      if (prev) assert.deepStrictEqual(cur, prev, 'kayma ' + step + ' kare ' + f);
      prev = cur;
    }
  }
});

test('hizalama: kaydırma varsa ileri alınıp kuyruk sıfır, yoksa dokunulmuyor', () => {
  const w = new A.MilkdropWaves();
  const raw = (b) => Array.from(b.subarray(2048 - 576), (x) => x - 128);
  let sawShift = false, sawZero = false;
  for (let f = 0; f < 40 && !(sawShift && sawZero); f++) {
    const b = bytes(2048, (t) => smooth(t + f * 3));
    w.update(b, b);
    const r = raw(b), k = w.offset[0];
    if (k > 0) {
      sawShift = true;
      assert.deepStrictEqual(Array.from(w.left.subarray(0, 480)), r.slice(k, k + 480));
      assert.ok(Array.from(w.left.subarray(480)).every((x) => x === 0), 'kuyruk sıfır değil');
    } else {
      sawZero = true;
      assert.deepStrictEqual(Array.from(w.left), r);
    }
  }
  assert.ok(sawShift && sawZero, 'iki durum da görülmeliydi');
});

/* ALTIN DİZİ. Yukarıdaki özellikler aramanın doğru SONUCA vardığını
   sınıyor, ama kaba-inceye aramanın her adımını değil: bir kat
   yanlışlıkla bir sonrakinin aralığını daraltsa düzgün sinyallerde yine
   aynı kaydırma bulunur. Burada gürültü, testere ve ters fazlı kanal
   karışık 120 kare; beklenen kaydırmalar kaynağın algoritmasının ayrıca
   yazılmış bir uygulamasıyla aynı çıktı (3.000 karede de öyle). */
test('hizalama: karışık seste kaydırmalar kaynağın algoritmasıyla aynı', () => {
  let seed = 20260916;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const L = new Uint8Array(2048), R = new Uint8Array(2048);
  const w = new A.MilkdropWaves();
  const got = [];
  let pos = 0;
  for (let f = 0; f < 120; f++) {
    const kind = f % 4;
    for (let i = 0; i < 2048; i++) {
      const t = pos + i;
      let s, r;
      if (kind === 0) { s = 0.6 * Math.sin(t * 0.031) + 0.3 * Math.sin(t * 0.173 + 1); r = 0.5 * Math.sin(t * 0.047 + 2); }
      else if (kind === 1) { s = rnd() * 2 - 1; r = rnd() * 2 - 1; }
      else if (kind === 2) { s = 0.5 * Math.sin(t * 0.0123) + 0.25 * (rnd() * 2 - 1); r = -s; }
      else { s = ((t % 97) / 48.5) - 1; r = Math.sin(t * 0.09) * 0.8; }
      L[i] = (128 + Math.max(-1, Math.min(1, s)) * 127) | 0;
      R[i] = (128 + Math.max(-1, Math.min(1, r)) * 127) | 0;
    }
    pos += 300 + Math.floor(rnd() * 700);
    w.update(L, R);
    got.push(w.offset[0], w.offset[1]);
  }
  const want = '66,17,92,0,85,93,0,43,38,15,92,89,1,5,64,48,18,17,0,0,1,0,67,23,15,1,25,53,93,92,'
    + '55,69,43,88,17,78,90,94,56,56,95,73,11,85,2,5,3,72,14,79,20,48,85,91,61,87,4,0,7,0,'
    + '22,40,11,41,38,0,79,37,0,0,5,60,5,2,21,0,95,92,22,59,83,21,10,2,43,27,1,67,42,0,'
    + '48,62,87,45,61,50,70,54,49,65,18,27,0,92,46,0,73,74,7,7,53,41,23,0,49,23,94,92,82,9,'
    + '71,3,70,68,8,57,82,34,83,43,39,80,0,2,59,57,93,37,20,47,10,0,22,88,54,77,65,17,81,91,'
    + '41,55,85,88,32,0,92,93,28,4,78,85,45,73,6,4,17,41,78,0,44,40,2,1,75,0,81,38,2,0,'
    + '0,2,42,72,7,0,43,7,94,93,44,86,30,61,88,68,88,92,52,26,95,18,18,0,3,8,62,3,0,0,'
    + '3,78,26,42,52,49,49,56,0,94,13,1,34,9,57,0,16,37,92,85,0,49,41,9,15,5,6,5,39,69';
  assert.strictEqual(got.join(','), want);
});

test('hizalama: sessizlikte kaydırma 0', () => {
  const w = new A.MilkdropWaves();
  const z = new Uint8Array(2048).fill(128);
  w.update(z, z);
  assert.deepStrictEqual(w.offset, [0, 0]);
  assert.ok(Array.from(w.data).every((x) => x === 0));
});

test('iki kanal ayrı hizalanıyor; mono kaynakta sağ kanal solun kopyası', () => {
  const w = new A.MilkdropWaves();
  const L = bytes(2048, smooth), R = bytes(2048, (t) => -0.6 * smooth(t * 1.7 + 50));
  w.update(L, R);
  assert.notDeepStrictEqual(Array.from(w.left), Array.from(w.right));
  // Yalnız sol kanal bir örnek kayınca yalnız onun kaydırması değişiyor
  const before = w.offset.slice();
  w.update(bytes(2048, (t) => smooth(t + 1)), R);
  assert.strictEqual(w.offset[0], before[0] - 1);
  assert.strictEqual(w.offset[1], before[1]);
  const m = new A.MilkdropWaves();
  m.update(L);
  assert.deepStrictEqual(Array.from(m.right), Array.from(m.left));
});

/* En yeni 576 örnek: dizinin SONU. 576'dan kısa bir dizinin eksik eski
   örnekleri sessizlik. */
test('en yeni 576 örnek okunuyor; kısa dizi başta sessizlik', () => {
  const w = new A.MilkdropWaves();
  const b = new Uint8Array(2048).fill(128);
  b[2047] = 228; b[1472] = 28; b[1471] = 255;
  w.update(b, b);
  assert.strictEqual(w.offset[0], 0);
  assert.strictEqual(w.left[575], 100, 'en yeni örnek sonda');
  assert.strictEqual(w.left[0], -100, 'pencerenin ilk örneği');
  const s = new A.MilkdropWaves();
  const short = new Uint8Array(100).fill(178);
  s.update(short, short);
  assert.strictEqual(s.offset[0], 0);
  assert.ok(Array.from(s.left.subarray(0, 476)).every((x) => x === 0));
  assert.ok(Array.from(s.left.subarray(476)).every((x) => x === 50));
});

// ------------------------------------------------------------ dizinin dışı

/* İki kanal bellekte arka arkaya: sağ kanalın önü sol kanalın sonu, sol
   kanalın arkası sağ kanalın başı. İki kanalın dışı 0 — MilkDrop'ta orada
   ses olmayan veri duruyor. Kenarı tekrarlamak (kırpmak) değil. */
test('dizinin dışı: bitişik iki kanal, ötesi 0', () => {
  const w = new A.MilkdropWaves();
  const z = new Uint8Array(2048).fill(128);
  w.update(z, z);
  for (let i = 0; i < 576; i++) { w.left[i] = i + 1; w.right[i] = -(i + 1); }
  assert.strictEqual(w.at(0, 0), 1);
  assert.strictEqual(w.at(1, 575), -576);
  assert.strictEqual(w.at(1, -16), w.left[560], 'sağın önü solun sonu');
  assert.strictEqual(w.at(0, 576), w.right[0], 'solun arkası sağın başı');
  assert.strictEqual(w.at(0, -1), 0, 'solun önü 0, kenar tekrarı değil');
  assert.strictEqual(w.at(1, 576), 0, 'sağın arkası 0');
  assert.strictEqual(w.at(0, -5000), 0);
  assert.strictEqual(w.at(1, 5000), 0);
});

/* milkdropfs.cpp:2433-2434: j0 = (480 - N)/2 - sep/2, j1 = ... + sep/2,
   tam sayı bölmesi sıfıra doğru. */
test('özel dalga indislemesi: MilkDrop\'un j0/j1\'i', () => {
  const w = new A.MilkdropWaves();
  for (let i = 0; i < 1152; i++) w.data[i] = i + 1;
  const a = new Float32Array(512), b = new Float32Array(512);
  const cases = [
    // [N, sep, j0, j1]
    [512, 0, -16, -16],
    [511, 0, -15, -15],
    [480, 0, 0, 0],
    [64, 0, 208, 208],
    [512, 51, -41, 9],
    [100, 256, 62, 318],
  ];
  for (const [N, sep, j0, j1] of cases) {
    a.fill(NaN); b.fill(NaN);
    w.custom(N, sep, a, b);
    for (let i = 0; i < N; i++) {
      assert.strictEqual(a[i], w.at(0, i + j0), 'N ' + N + ' sep ' + sep + ' a[' + i + ']');
      assert.strictEqual(b[i], w.at(1, i + j1), 'N ' + N + ' sep ' + sep + ' b[' + i + ']');
    }
    assert.ok(Number.isNaN(a[N]) || N === 512, 'N ötesine yazılmamalı');
  }
  // N = 512: ilk 16 değer sol kanalın önü, yani 0; sağ kanalınkiler solun kuyruğu
  w.custom(512, 0, a, b);
  assert.strictEqual(a[0], 0);
  assert.strictEqual(a[16], w.left[0]);
  assert.strictEqual(b[0], w.left[560]);
  assert.strictEqual(b[16], w.right[0]);
});

/* milkdropfs.cpp:908-918: ölçek wave_scale/128, ilk örnek yalnız
   ölçekleniyor, sonrakiler bir öncekinin süzülmüş hâliyle karışıyor —
   576 örneğin hepsi, sıfırlanan kuyruk dahil. */
test('varsayılan dalga süzgeci: MilkDrop\'un ölçeği ve karışımı', () => {
  const w = new A.MilkdropWaves();
  const b = bytes(2048, (t) => smooth(t * 3));
  w.update(b, bytes(2048, (t) => smooth(t * 2 + 9)));
  const L = new Float32Array(576), R = new Float32Array(576);
  for (const [scale, sm] of [[1, 0], [1.7, 0.75], [0.4, 0.95]]) {
    w.scaled(scale, sm, L, R);
    const k0 = scale / 128, k1 = k0 * (1 - sm);
    let el = w.left[0] * k0, er = w.right[0] * k0;
    assert.strictEqual(L[0], Math.fround(el));
    assert.strictEqual(R[0], Math.fround(er));
    for (let i = 1; i < 576; i++) {
      el = w.left[i] * k1 + L[i - 1] * sm;
      er = w.right[i] * k1 + R[i - 1] * sm;
      assert.strictEqual(L[i], Math.fround(el));
      assert.strictEqual(R[i], Math.fround(er));
    }
  }
  // Doğru akım kazancı 1: sabit bir girdi ölçekli sabitte kalıyor
  const c = new A.MilkdropWaves();
  const d = new Uint8Array(2048).fill(192);
  c.update(d, d);
  c.scaled(2, 0.9, L, R);
  assert.ok(Math.abs(L[575] - 64 * 2 / 128) < 1e-4, 'L[575] = ' + L[575]);
});

// ------------------------------------------------------------ motor

test('motor: dalga verisi kare başına bir kez, dalgalardan önce', () => {
  const calls = BODY.match(/this\._frameWaves\(audio\);/g) || [];
  assert.strictEqual(calls.length, 1);
  const at = BODY.indexOf('this._frameWaves(audio);');
  assert.ok(at < BODY.indexOf('this._waveSamples(audio,'), '_waveSamples önce koşuyor');
  assert.ok(at < BODY.indexOf('this._drawCustomWaves(gl, audio,'), 'özel dalgalar önce koşuyor');
});

test('motor: uyum açıkken iki kanal hizalanıyor, kapalıyken durum atılıyor', () => {
  const fw = method('_frameWaves(audio)');
  assert.match(fw, /this\._specStale = true;/);
  assert.match(fw, /if \(this\._wantAcc === false \|\| !tb \|\| tb\.length < 8\) \{\s*this\._waves = null;/);
  assert.match(fw, /new window\.SVMilkdropAudio\.MilkdropWaves\(\)/);
  assert.match(fw, /this\._waves\.update\(audio\.timeL \|\| tb, audio\.timeR \|\| tb\);/);
});

test('motor: varsayılan dalga hizalanmış diziden, eski yol olduğu gibi', () => {
  const ws = method('_waveSamples(audio, scale, smoothing)');
  assert.match(ws, /if \(this\._wantAcc !== false && this\._waves\) return this\._waves\.scaled\(s, sm, L, R\);/);
  // Eski yol: en eski örnekler ve 128 örnek ötesi
  assert.match(ws, /R\[0\] = raw\(128\) \* s;/);
  // Süzgeç parametreleri iki yolda da aynı denetimden geçiyor
  assert.ok(ws.indexOf('if (sm < 0) sm = 0;') < ws.indexOf('this._waves.scaled'));
});

test('motor: tayf kanal başına ve kare başına bir kez', () => {
  const cw = method('_drawCustomWaves(gl, audio, preset, am)');
  assert.match(cw, /if \(this\._specStale\) \{[\s\S]*?this\._specStale = false;/);
  assert.match(cw, /this\._specPair = \{ left: this\._specL\.out, right: this\._specR\.out \};/);
});

/* Nokta sayısı MilkDrop'un geçerli örnek sayısından: 480 (milkdropfs.cpp:
   2666). Mod 0 ve 6/7'nin yarım sayısı ve kayması da ondan türüyor —
   satırlar kaynaktan sökülüp HESAPLANIYOR: uyum açıkken MilkDrop'un 240
   noktası ve 120 örnek kayması, kapalıyken eski 256 ve 128. */
test('motor: varsayılan dalganın nokta sayısı geçerli 480 örnekten', () => {
  const dw = method('_drawWaveModes(gl, GW, GH)');
  assert.match(dw, /const acc = this\._wantAcc !== false;/);
  assert.match(dw, /const SAMPLES = acc \? 480 : 512;/);
  const m0 = /if \(mode === 0\) \{\s*n = ([^;]+);\s*off = ([^;]+);/.exec(dw);
  assert.ok(m0, 'mod 0 satırları bulunamadı');
  /* Mod 6/7'nin sayısı render genişliğiyle de sınırlanıyor (ayrı test
     dosyası); buradaki soru sınırsız hâlde geçerli örnek sayısından
     türeyip türemediği. */
  const m6 = /let half = ([^;]+);[\s\S]*?off = (Math\.trunc\(\(SAMPLES - half\) \/ 2\));/.exec(dw);
  assert.ok(m6, 'mod 6/7 satırları bulunamadı');
  const mode0 = new Function('SAMPLES', 'const n = ' + m0[1] + '; return [n, ' + m0[2] + '];');
  const mode6 = new Function('SAMPLES', 'const half = ' + m6[1] + '; return [half, ' + m6[2] + '];');
  assert.deepStrictEqual(mode0(480), [240, 120]);
  assert.deepStrictEqual(mode6(480), [240, 120]);
  assert.deepStrictEqual(mode0(512), [256, 128]);
  assert.deepStrictEqual(mode6(512), [256, 128]);
  for (const S of [480, 512]) {
    // En ileri bakan okumalar 576'lık dizinin içinde: mod 2/3/5 i+32, mod 4 i+25
    assert.ok(S - 1 + 32 < 576 && S - 1 + 25 < 576, 'SAMPLES ' + S);
    const [half, off] = mode6(S);
    assert.ok(off + half - 1 < S, 'mod 6/7, SAMPLES ' + S);
  }
});

/* Özel dalganın örnekleri motorun kendi yönteminden, sahte bir `this` ile
   ÇALIŞTIRILARAK: uyum açıkken MilkdropWaves'in indislemesi ve genliği,
   kapalıyken eski yolun bayt okuması. */
test('motor: özel dalga örnekleri iki yolda', () => {
  const src = method('_customWaveSamples(tb, N, w, audio, preset)');
  const inner = src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));
  const fn = new Function('tb', 'N', 'w', 'audio', 'preset', inner);
  const tb = bytes(2048, (t) => smooth(t * 5));
  const waves = new A.MilkdropWaves().update(tb, bytes(2048, (t) => smooth(t * 4 + 3)));
  const preset = { get: (k) => (k === 'wave_scale' ? 1 : 0) };
  const wave = { sep: 0, smoothing: 0, scaling: 1, spectrum: 0 };
  const acc = { _wantAcc: true, _waves: waves, _specData: null, preset };
  fn.call(acc, tb, 512, wave, {}, preset);
  for (let i = 0; i < 512; i++) {
    assert.strictEqual(acc._cw1[i], Math.fround(waves.at(0, i - 16) * 0.004), 'a[' + i + ']');
    assert.strictEqual(acc._cw2[i], Math.fround(waves.at(1, i - 16) * 0.004), 'b[' + i + ']');
  }
  const old = { _wantAcc: false, _waves: null, _specData: null, preset };
  fn.call(old, tb, 512, wave, {}, preset);
  for (let i = 0; i < 512; i++) {
    assert.strictEqual(old._cw1[i], Math.fround((tb[i] - 128) / 128), 'eski a[' + i + ']');
  }
});
