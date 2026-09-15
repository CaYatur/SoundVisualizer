'use strict';
/* İKİ KANAL, YAKALAMADAN EKRANA (#566).
 *
 * Yakalama yardımcısı işletim sisteminin verdiği sol ve sağ kanalı halka
 * tampona yazmadan önce ortalıyordu. Sonuç zincirin her halkasında görünür
 * bir eksiklikti ve hiçbiri hata vermiyordu:
 *   - analysis.js stereo genişliğini ve korelasyonu hesaplayabiliyor, ama
 *     audio.js dördüncü argümanı hiç vermediği için genişlik 0'da, korelasyon
 *     1'de sabit kalıyordu;
 *   - gonyometre sağ kanalı mono diziden uyduruyor ve her şarkıda dikey bir
 *     çizgi çiziyordu;
 *   - yayın katmanı ve dışa aktarım da tek kanal taşıyordu.
 *
 * Bu testler kanalların her halkadan AYRI geçtiğini ve mono dizinin eskisiyle
 * birebir aynı kaldığını doğruluyor: mono okuyan hiçbir şeyin sayısı
 * değişmemeli.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');
const F = require('../src/main/audio-frame.js');

// Tohumlu, tekrarlanabilir örnekler
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296 * 2 - 1;
  };
}

/* Eski yardımcının aygıt geri çağrısı, olduğu gibi: mono tamponun eskiden
   nasıl dolduğunun referansı. */
function oldPush(ring, f, nCh) {
  const samples = (f.length / nCh) | 0;
  ring.copyWithin(0, samples);
  let w = F.FFT_SIZE - samples;
  if (w < 0) w = 0;
  for (let i = 0, idx = 0; i < samples; i++, idx += nCh) {
    let m = f[idx];
    if (nCh > 1) m = (f[idx] + f[idx + 1]) * 0.5;
    if (w + i < F.FFT_SIZE) ring[w + i] = m;
  }
}

// ------------------------------------------------------------ kare biçimi

test('kare yerleşimi: işaret, hız, tayf, mono, sol, sağ', () => {
  assert.strictEqual(F.FFT_SIZE, 2048);
  assert.strictEqual(F.BINS, 1024);
  assert.strictEqual(F.OFFSET.freq, 6);
  assert.strictEqual(F.OFFSET.time, F.OFFSET.freq + F.BINS);
  assert.strictEqual(F.OFFSET.left, F.OFFSET.time + F.FFT_SIZE);
  assert.strictEqual(F.OFFSET.right, F.OFFSET.left + F.FFT_SIZE);
  assert.strictEqual(F.FRAME_BYTES, F.OFFSET.right + F.FFT_SIZE);
  assert.strictEqual(F.FRAME_BYTES, 7174);
});

test('aygıt tamponu: mono eskisiyle bit bit aynı, iki kanal ayrı', () => {
  const r = rng(7);
  const src = new F.SourceRings();
  const ref = new Float32Array(F.FFT_SIZE);
  // Farklı parça boyları, tamponu birkaç kez dolaşacak kadar
  for (const n of [512, 512, 100, 777, 512, 1, 2047, 2048, 512]) {
    const f = new Float32Array(n * 2);
    for (let i = 0; i < f.length; i++) f[i] = r();
    src.pushFloat32(f, 2);
    oldPush(ref, f, 2);
    assert.deepStrictEqual(Array.from(src.mono), Array.from(ref), n + ' örneklik parçadan sonra mono farklı');
    // En yeni örnek sonda, kanallar karışmadan
    assert.strictEqual(src.left[F.FFT_SIZE - 1], f[(n - 1) * 2]);
    assert.strictEqual(src.right[F.FFT_SIZE - 1], f[(n - 1) * 2 + 1]);
  }
});

test('tek kanallı aygıt: sol ve sağ aynı örnek', () => {
  const src = new F.SourceRings();
  const f = new Float32Array([0.25, -0.5, 0.75]);
  src.pushFloat32(f, 1);
  const tail = (a) => Array.from(a.subarray(F.FFT_SIZE - 3));
  assert.deepStrictEqual(tail(src.mono), [0.25, -0.5, 0.75]);
  assert.deepStrictEqual(tail(src.left), [0.25, -0.5, 0.75]);
  assert.deepStrictEqual(tail(src.right), [0.25, -0.5, 0.75]);
});

test('tampondan uzun parça: EN YENİ 2048 örnek kalıyor', () => {
  /* Eski yol burada kaydırmayı atlayıp parçanın EN ESKİ örneklerini
     yazıyordu. Aygıt 512'lik parça verdiği için yalnız uygulama
     yakalamasında, boru bir an tıkandığında görülürdü. */
  const n = 3000;
  const f = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { f[i * 2] = i / n; f[i * 2 + 1] = -i / n; }
  const src = new F.SourceRings();
  src.pushFloat32(f, 2);
  assert.strictEqual(src.left[0], Math.fround((n - F.FFT_SIZE) / n));
  assert.strictEqual(src.left[F.FFT_SIZE - 1], Math.fround((n - 1) / n));
  assert.strictEqual(src.right[F.FFT_SIZE - 1], Math.fround(-(n - 1) / n));
});

test('uygulama akışı: hizalanmamış tampondan okuma aygıt yoluyla aynı', () => {
  const r = rng(11);
  const frames = 600;
  const f = new Float32Array(frames * 2);
  for (let i = 0; i < f.length; i++) f[i] = r();
  // byteOffset'i 4'ün katı OLMAYAN bir tampon: Node'un havuzu böyle veriyor
  const big = Buffer.alloc(frames * 8 + 3);
  const buf = big.subarray(3);
  for (let i = 0; i < f.length; i++) buf.writeFloatLE(f[i], i * 4);
  const a = new F.SourceRings();
  const b = new F.SourceRings();
  a.pushStereoLE(buf, frames);
  b.pushFloat32(f, 2);
  assert.deepStrictEqual(Array.from(a.mono), Array.from(b.mono));
  assert.deepStrictEqual(Array.from(a.left), Array.from(b.left));
  assert.deepStrictEqual(Array.from(a.right), Array.from(b.right));
  a.reset();
  assert.ok(a.left.every((v) => v === 0) && a.mono.every((v) => v === 0));
});

test('karışım: mono eskisiyle aynı, kanallar kendi toplamı', () => {
  const r = rng(3);
  const sources = [new F.SourceRings(), new F.SourceRings(), new F.SourceRings()];
  const refRings = sources.map(() => new Float32Array(F.FFT_SIZE));
  sources.forEach((s, k) => {
    const f = new Float32Array(1500 * 2);
    for (let i = 0; i < f.length; i++) f[i] = r();
    s.pushFloat32(f, 2);
    oldPush(refRings[k], f, 2);
  });
  const norm = 1 / Math.sqrt(3);
  const out = new F.SourceRings();
  F.mixSources(out, sources, norm);
  // Eski zamanlayıcının karışımı
  const ref = new Float32Array(F.FFT_SIZE);
  for (let i = 0; i < F.FFT_SIZE; i++) {
    let s = 0;
    for (let k = 0; k < refRings.length; k++) s += refRings[k][i];
    ref[i] = s * norm;
  }
  assert.deepStrictEqual(Array.from(out.mono), Array.from(ref));
  const i = 2000;
  assert.strictEqual(out.left[i], Math.fround((sources[0].left[i] + sources[1].left[i] + sources[2].left[i]) * norm));
  assert.strictEqual(out.right[i], Math.fround((sources[0].right[i] + sources[1].right[i] + sources[2].right[i]) * norm));
});

test('kare yazılıp okununca üç zaman dizisi de ayrı geliyor', () => {
  const buf = Buffer.alloc(F.FRAME_BYTES);
  buf[0] = F.MARKER0; buf[1] = F.MARKER1;
  buf.writeUInt32LE(44100, F.OFFSET.sampleRate);
  for (let i = 0; i < F.BINS; i++) buf[F.OFFSET.freq + i] = i & 0xff;
  const mono = new Float32Array(F.FFT_SIZE).fill(0);
  const left = new Float32Array(F.FFT_SIZE).fill(0.5);
  const right = new Float32Array(F.FFT_SIZE).fill(-0.5);
  left[0] = 2; right[0] = NaN; // kırpma ve NaN eski yolun kuralıyla
  F.writeTime(buf, F.OFFSET.time, mono);
  F.writeTime(buf, F.OFFSET.left, left);
  F.writeTime(buf, F.OFFSET.right, right);
  const fr = F.parseFrame(buf);
  assert.strictEqual(fr.sampleRate, 44100);
  assert.strictEqual(fr.freq.length, 1024);
  assert.strictEqual(fr.freq[300], 300 & 0xff);
  assert.strictEqual(fr.time[5], 128);
  assert.strictEqual(fr.left[5], (128 + 0.5 * 127) | 0);
  assert.strictEqual(fr.right[5], (128 - 0.5 * 127) | 0);
  assert.strictEqual(fr.left[0], 255, '1 üstü kırpılıyor');
  assert.strictEqual(fr.right[0], 0, 'NaN 0 baytına düşüyor, eskisi gibi');
  // Kopya: kaynak tampon değişince okunan kare değişmemeli
  buf[F.OFFSET.left + 5] = 1;
  assert.strictEqual(fr.left[5], (128 + 0.5 * 127) | 0);
});

test('yardımcı ve ana süreç yerleşimi aynı modülden alıyor', () => {
  const helper = read('src/main/loopback-helper.js');
  assert.match(helper, /require\('\.\/audio-frame\.js'\)/);
  assert.match(helper, /writeTime\(outBuf, OFFSET\.left, mixed\.left\)/);
  assert.match(helper, /writeTime\(outBuf, OFFSET\.right, mixed\.right\)/);
  assert.match(helper, /src\.pushFloat32\(f, nCh\)/);
  assert.match(helper, /src\.pushStereoLE\(buf, frames\)/);
  assert.doesNotMatch(helper, /\(f\[idx\] \+ f\[idx \+ 1\]\) \* 0\.5/, 'kanalları atan eski geri çağrı kalmış');
  const na = read('src/main/native-audio.js');
  assert.match(na, /require\('\.\/audio-frame\.js'\)/);
  assert.match(na, /frameFormat\.parseFrame\(acc\.subarray\(0, FRAME_BYTES\)\)/);
  assert.doesNotMatch(na, /2 \+ 4 \+ 1024 \+ 2048/);
});

// ---------------------------------------------------------- yayın katmanı

function loadShim() {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); }
    send() {}
    close() {}
  }
  const win = {
    location: { search: '?token=t', pathname: '/', protocol: 'http:', host: 'localhost:1' },
    URLSearchParams,
    WebSocket: FakeWS,
    document: { documentElement: { setAttribute() {} } },
    setTimeout: () => 0,
    Date,
  };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/web/web-shim.js'), ctx, { filename: 'web-shim.js' });
  /* İleti sayfanın KENDİ ArrayBuffer'ı olmalı: web-shim `instanceof
     ArrayBuffer` diye bakıyor ve başka bir alemin dizisi onu geçemez.
     Tarayıcıda WebSocket'in verdiği dizi zaten sayfanın. */
  const AB = vm.runInContext('ArrayBuffer', ctx);
  const U8 = vm.runInContext('Uint8Array', ctx);
  const toPage = (b) => {
    const ab = new AB(b.length);
    new U8(ab).set(b);
    return ab;
  };
  return { win, ws: sockets[0], toPage };
}

test('yayın katmanı: kanallar sunucudan sayfaya ayrı geçiyor', () => {
  const S = require('../src/main/stream-server.js');
  const freq = new Uint8Array(1024).map((_, i) => i % 251);
  const time = new Uint8Array(2048).fill(128);
  const left = new Uint8Array(2048).map((_, i) => 100 + (i % 7));
  const right = new Uint8Array(2048).map((_, i) => 150 - (i % 5));
  const { win, ws, toPage } = loadShim();
  const got = [];
  win.api.onNativeAudio((fr) => got.push({
    left: fr.left && Array.from(fr.left), right: fr.right && Array.from(fr.right),
    time: Array.from(fr.time), sr: fr.sampleRate,
  }));

  ws.onmessage({ data: toPage(S.encodeAudio({ freq, time, left, right, sampleRate: 44100 })) });
  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual(got[0].left, Array.from(left));
  assert.deepStrictEqual(got[0].right, Array.from(right));
  assert.deepStrictEqual(got[0].time, Array.from(time));
  assert.strictEqual(got[0].sr, 44100);

  /* Kanalsız kare (sentetik kaynak ya da eski biçim) mono gidiyor ve sayfa
     kanal UYDURMUYOR: ses motoru onları mono diziden kuruyor. */
  const mono = S.encodeAudio({ freq, time, sampleRate: 48000 });
  assert.strictEqual(mono.length, 12 + 1024 + 2048);
  ws.onmessage({ data: toPage(mono) });
  assert.strictEqual(got[1].left, undefined);
  assert.strictEqual(got[1].right, undefined);
});

test('yayın katmanı: eski bir sayfa yeni iletiyi okuyabiliyor', () => {
  /* Başlık değişmedi; kanallar sona eklendi. Eski sayfanın okuduğu iki
     uzunluk ve iki dizi yerinde duruyor. */
  const S = require('../src/main/stream-server.js');
  const freq = new Uint8Array(1024).fill(9);
  const time = new Uint8Array(2048).fill(77);
  const p = S.encodeAudio({ freq, time, left: new Uint8Array(2048), right: new Uint8Array(2048), sampleRate: 48000 });
  assert.strictEqual(p.readUInt32LE(4), 1024);
  assert.strictEqual(p.readUInt32LE(8), 2048);
  assert.strictEqual(p[12], 9);
  assert.strictEqual(p[12 + 1024], 77);
  assert.strictEqual(p.length, 12 + 1024 + 3 * 2048);
});

// ------------------------------------------------------------ ses motoru

function loadAudio() {
  const win = { performance: { now: () => 1000 } };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/shared/analysis.js'), ctx, { filename: 'analysis.js' });
  vm.runInContext(read('src/visualizer/audio.js'), ctx, { filename: 'audio.js' });
  return win;
}

function frameOf(fnL, fnR) {
  const toB = (s) => (128 + Math.max(-1, Math.min(1, s)) * 127) | 0;
  const time = new Uint8Array(2048), left = new Uint8Array(2048), right = new Uint8Array(2048);
  for (let i = 0; i < 2048; i++) {
    const l = fnL(i), r = fnR(i);
    left[i] = toB(l); right[i] = toB(r); time[i] = toB((l + r) * 0.5);
  }
  const freq = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) freq[i] = i < 40 ? 200 : 20;
  return { freq, time, left, right, sampleRate: 48000 };
}

test('ses motoru: kanallar analize ulaşıyor, genişlik ve korelasyon kıpırdıyor', () => {
  const win = loadAudio();
  const a = new win.SVAudio();
  /* Orta 0,6 × sin(b), yan 0,3 × sin(a), farklı frekanslar. Beklenen:
     korelasyon (0,18 - 0,045) / 0,225 = 0,6; genişlik 2 × 0,045 / 0,225 = 0,4.
     (Tam ters faz seçilmedi: mono karışımı sıfır olur ve çözümleme onu
     haklı olarak sessizlik sayıp ölçüleri sıfırlar.) */
  const mid = (i) => 0.6 * Math.sin(i * 0.031);
  const side = (i) => 0.3 * Math.sin(i * 0.173);
  const fr = frameOf((i) => mid(i) + side(i), (i) => mid(i) - side(i));
  a.ingestFrame(fr);
  assert.strictEqual(a.stereo, true);
  assert.deepStrictEqual(Array.from(a.timeL), Array.from(fr.left));
  assert.deepStrictEqual(Array.from(a.timeR), Array.from(fr.right));
  a.update(1 / 60);
  assert.ok(Math.abs(a.analysis.correlation - 0.6) < 0.05, 'korelasyon ' + a.analysis.correlation);
  assert.ok(Math.abs(a.analysis.width - 0.4) < 0.05, 'genişlik ' + a.analysis.width);
  assert.ok(Math.abs(a.analysis.sources().anWidth - 0.4) < 0.05, 'modülasyon kaynağı da görüyor');
});

test('ses motoru: kanalsız kare mono sayılıyor — genişlik 0, korelasyon 1', () => {
  const win = loadAudio();
  const a = new win.SVAudio();
  const fr = frameOf((i) => 0.5 * Math.sin(i * 0.07), (i) => 0.5 * Math.sin(i * 0.07));
  delete fr.left;
  delete fr.right;
  a.ingestFrame(fr);
  assert.strictEqual(a.stereo, false);
  assert.deepStrictEqual(Array.from(a.timeL), Array.from(fr.time));
  assert.deepStrictEqual(Array.from(a.timeR), Array.from(fr.time));
  a.update(1 / 60);
  assert.ok(Math.abs(a.analysis.correlation - 1) < 1e-6, 'korelasyon ' + a.analysis.correlation);
  assert.ok(a.analysis.width < 1e-6, 'genişlik ' + a.analysis.width);
});

// ------------------------------------------------------------- gonyometre

function goniometerPoints(audio) {
  const points = [];
  const ctx2d = (record) => new Proxy({}, {
    get(target, k) {
      if (k === 'fillRect') {
        return (x, y, w, h) => { if (record && w === 2 && h === 2) points.push([x, y]); };
      }
      if (k in target) return target[k];
      return () => {};
    },
    set(target, k, v) { target[k] = v; return true; },
  });
  const trail = { width: 0, height: 0, getContext: () => ctx2d(true) };
  const win = { document: { createElement: () => trail } };
  win.window = win;
  vm.runInContext(read('src/visualizer/modes/generative.js'), vm.createContext(win), { filename: 'generative.js' });
  const canvas = { width: 400, height: 400, getContext: () => ctx2d(false) };
  const g = new win.SVModes.goniometer(canvas);
  trail.width = 400; trail.height = 400;
  g.draw(audio, { visualizer: { colorMode: 'rainbow' } }, 0);
  return points;
}

test('gonyometre: sol ve sağı çiziyor, kanal uydurmuyor', () => {
  const wave = (i) => (128 + Math.round(90 * Math.sin(i * 0.05))) & 0xff;
  const L = new Uint8Array(2048).map((_, i) => wave(i));
  const same = goniometerPoints({ timeBytes: L, timeL: L, timeR: L });
  assert.ok(same.length > 1000);
  // L = R: bütün noktalar dikey eksende (x = merkez)
  assert.ok(same.every(([x]) => Math.abs(x - 200) < 1e-9), 'mono dikey çizgi olmalı');

  // L = -R: bütün noktalar yatay eksende (y = merkez)
  const R = L.map((v) => 256 - v);
  const anti = goniometerPoints({ timeBytes: new Uint8Array(2048).fill(128), timeL: L, timeR: R });
  assert.ok(anti.every(([, y]) => Math.abs(y - 200) < 1e-9), 'ters faz yatay çizgi olmalı');
  assert.ok(anti.some(([x]) => Math.abs(x - 200) > 10), 'ters fazda noktalar yana açılmalı');

  const src = read('src/visualizer/modes/generative.js');
  assert.doesNotMatch(src, /s \* \(1 - side\) \+ s2 \* side/, 'uydurma sağ kanal kalmış');
});

// --------------------------------------------------- dışa aktarım, ölçüm

test('dışa aktarım iki kanalı çözüyor ve kareye koyuyor', () => {
  const src = read('src/exporter/exporter.js');
  assert.match(src, /pcmL = buf\.getChannelData\(0\);/);
  assert.match(src, /pcmR = ch <= 1 \? pcmL : buf\.getChannelData\(1\);/);
  assert.match(src, /ring\[i\] = mono \? l : \(l \+ r\) \* 0\.5;/);
  assert.match(src, /audio\.ingestFrame\(\{ freq: freqBytes, time: timeBytes, left: leftBytes, right: rightBytes, sampleRate \}\)/);
});

test('render ölçümü stereo besliyor ve mono dizi orta kanalın kendisi', () => {
  /* Ölçüm harness'ı iki kanal vermeseydi motordaki stereo yolunu hiç
     ölçmezdi. Sol = orta + yan, sağ = orta - yan; orta mono sinyal. */
  const src = read('scripts/milkdrop-render-rate.js');
  const a = src.indexOf('var SR = 48000');
  const b = src.indexOf('/* Bir karenin özeti.');
  assert.ok(a > 0 && b > a, 'harness ses bölümü bulunamadı');
  const win = {};
  new Function('window', src.slice(a, b))(win);
  let differ = 0;
  for (let i = 0; i < 30; i += 7) {
    const f = win.__audio(i);
    assert.strictEqual(f.stereo, true);
    for (let k = 0; k < 2048; k++) {
      if (f.timeL[k] !== f.timeR[k]) differ++;
      const mid = ((f.timeL[k] - 128) + (f.timeR[k] - 128)) / 2 + 128;
      assert.ok(Math.abs(mid - f.timeBytes[k]) <= 1, 'kare ' + i + ' örnek ' + k);
    }
  }
  assert.ok(differ > 1000, 'kanallar ayrışmıyor: ' + differ);
});
