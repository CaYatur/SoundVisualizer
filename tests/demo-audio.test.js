'use strict';
/* ÖRNEK SES — panel önizlemesi ve render ölçümü aynı sesi duyuyor.
 *
 * Panelin demo sinyali zaman verisini üç alçak sinüsten kuruyordu (2048
 * örnekte 3, 7 ve 17 devir; 48 kHz'de ~70, ~164 ve ~398 Hz). MilkDrop'un
 * bantları ve tayf dalgaları hazır tayfı DEĞİL bu diziyi okuyup kendi
 * FFT'sini hesaplıyor (en yeni 576 örnek; bass 0-4, mid 4-8, treb 8-12 kHz),
 * yani panelde MilkDrop'un orta ve tiz bantlarına yalnız 8 bitlik nicemleme
 * gürültüsü düşüyordu: 45 FPS'te `mid` 0,64-1,38 ve `treb` 0,66-1,30
 * arasında kalıyordu, `bass` 0,52-2,24 gezerken.
 *
 * Tarif artık src/shared/demo-audio.js'te ve ölçüm harness'ı da onu
 * yüklüyor; iki yer aynı dalga biçimini görüyor. Tarif ölçümün kullandığı
 * gömülü hâlinden bayt bayt taşındı: aşağıdaki özetler o hâlinden
 * hesaplandı ve harness'ın 900 presetlik koşusu iki kipte de taşımadan
 * öncekiyle birebir aynı çıktı.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');
const D = require('../src/shared/demo-audio.js');
const A = require('../src/shared/milkdrop-audio.js');

const N = 2048;
const bufs = () => [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
function fnv(arrs) {
  let h = 0x811c9dc5;
  for (const a of arrs) for (const v of a) { h ^= v; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ tarif

test('tarif taşındığı hâliyle aynı — pencere özetleri sabit', () => {
  /* Özetler ölçümün gömülü tarifinden hesaplandı (sıfır ve üstündeki
     indislerde iki uygulama bayt bayt aynı: 2.459.200 örnek, fark yok).
     Buradaki sayı değişirse hem panelin demosu hem 900 presetlik ölçüm
     başka bir ses duyuyor demektir. */
  const golden = [
    [48000, '93c7cafc'],       // harness'ın ilk karesi: t = 1 sn
    [78400, '5e5ff30a'],       // harness'ın son karesi: t = 1 + 19/30 sn
    [492345, 'c2954242'],      // vuruş arası, trampet ve hi-hat açık
    [4147200000, '9d5c1039'],  // 1 gün: panel saatlerce açık kalabiliyor
    [0, 'd4c1862b'],           // pencere eksi zamana düşüyor
    [-19200, '01cdfd78'],      // eksi zamanda tek numaralı vuruş: trampet açık
    [-144000, 'b385cf29'],
  ];
  for (const [end, want] of golden) {
    const [t, l, r] = bufs();
    D.fill(end, t, l, r);
    assert.strictEqual(fnv([t, l, r]), want, 'pencere ' + end);
  }
});

test('pencere kronolojik ve indise bağlı: kaydırınca örnekler kayıyor', () => {
  const [a] = bufs();
  const [b] = bufs();
  D.fill(600000, a);
  D.fill(600000 + 100, b);
  for (let k = 0; k < N - 100; k++) {
    assert.strictEqual(b[k], a[k + 100], 'örnek ' + k);
  }
  // en yeni örnek sonda
  assert.strictEqual(a[N - 1], D.toByte(D.sampleAt(600000)));
  assert.strictEqual(a[0], D.toByte(D.sampleAt(600000 - (N - 1))));
});

test('eksi indisler tanımlı — panel ilk kareyi t = 0 için istiyor', () => {
  /* Eski tarif nota dizisini `% 4` ile indisliyordu: eksi zamanda NOTES[-1]
     undefined, sinüs NaN, bayt 0. Ölçüm 1. saniyeden başladığı için hiç
     görünmüyordu; panel ilk kareyi t = 0'da istiyor. */
  for (const end of [0, -1, -144000]) {
    const [t, l, r] = bufs();
    D.fill(end, t, l, r);
    assert.ok(t.every((v) => v > 0), 'pencere ' + end + ' sıfır bayt içeriyor');
    assert.ok(Math.max(...t) - Math.min(...t) > 4, 'pencere ' + end + ' düz');
    assert.ok(l.some((v, i) => v !== r[i]), 'pencere ' + end + ' tek kanal');
  }
  for (let j = -48000; j < 48000; j++) {
    assert.ok(Number.isFinite(D.sampleAt(j)) && Number.isFinite(D.sideAt(j)), 'örnek ' + j);
  }
});

test('ritim ızgarası sıfırın iki yanında sürüyor', () => {
  /* Trampet tek numaralı vuruşlarda. Yan kanalda trampet, hi-hat ve pedin
     tek sinüsü var; aşağıdaki anların hepsinde hi-hat kapalı, pedi çıkarınca
     geriye yalnız trampet kalıyor. */
  const pad = (j) => 0.5 * 0.03 * Math.sin(2 * Math.PI * 277.2 * (j / D.SR) + 1.1);
  const snare = (j) => D.sideAt(j) - pad(j);
  const at = (sec) => Math.round(sec * D.SR);
  const cases = [[0.6, true], [0.1, false], [-0.4, true], [-0.9, false],
    [1.6, true], [-1.4, true]];
  for (const [sec, on] of cases) {
    const v = Math.abs(snare(at(sec)));
    if (on) assert.ok(v > 1e-6, sec + ' sn: trampet bekleniyordu');
    else assert.strictEqual(v, 0, sec + ' sn: trampet olmamalıydı');
  }
});

test('iki kanal ayrı, ortalaması mono dizinin kendisi', () => {
  let differ = 0;
  for (const end of [48000, 120000, 492345]) {
    const [t, l, r] = bufs();
    D.fill(end, t, l, r);
    for (let k = 0; k < N; k++) {
      if (l[k] !== r[k]) differ++;
      const mid = ((l[k] - 128) + (r[k] - 128)) / 2 + 128;
      assert.ok(Math.abs(mid - t[k]) <= 1, 'pencere ' + end + ' örnek ' + k);
    }
  }
  assert.ok(differ > 2000, 'kanallar ayrışmıyor: ' + differ);
});

// ------------------------------------------------------- panel önizlemesi

/* preview.js'i sahte bir panelde koşturuyor: gerçek ses motoru (audio.js),
   gerisi taklit. Toplanan kareler panelin katmanlara verdiklerinin
   kendisi. */
function runPanel(seconds) {
  const win = { performance: { now: () => 0 }, devicePixelRatio: 1, addEventListener() {} };
  win.window = win;
  const node = () => ({
    style: {}, classList: { toggle() {} },
    getBoundingClientRect: () => ({ width: 320, height: 180 }),
  });
  const nodes = { previewStage: node(), pvStage: node(), pvLogo: node() };
  win.document = { getElementById: (id) => nodes[id] || null, hidden: false };
  let onFrame = null;
  win.requestAnimationFrame = (fn) => { onFrame = fn; return 1; };
  win.SV = { defaultConfig: () => ({ audio: {} }), deepMerge: (a, b) => Object.assign({}, a, b) };
  win.SVModulation = {
    Modulator: class { update() {} apply(c) { return c; } touches() { return false; } },
  };
  win.SVSprites = class { constructor() { this.items = []; } setItems() {} };
  win.SVMedia = class { constructor() { this.video = null; } apply() {} };
  win.SVLayers = {
    stackOn: () => false,
    LayerStack: class {
      resize() {} setConfig() {} setPostFX() {} bindMedia() {}
      setSprites() {} setMedia() {} draw() {}
    },
  };
  const ctx = vm.createContext(win);
  vm.runInContext(read('src/shared/demo-audio.js'), ctx, { filename: 'demo-audio.js' });
  vm.runInContext(read('src/visualizer/audio.js'), ctx, { filename: 'audio.js' });

  // Panelin ses motoruna verdiği kareler
  const frames = [];
  const Real = win.SVAudio;
  let engine = null;
  win.SVAudio = function () {
    engine = new Real();
    const orig = engine.ingestFrame.bind(engine);
    engine.ingestFrame = (f) => {
      frames.push({
        time: Uint8Array.from(f.time),
        left: f.left && Uint8Array.from(f.left),
        right: f.right && Uint8Array.from(f.right),
        sampleRate: f.sampleRate,
      });
      orig(f);
    };
    return engine;
  };

  vm.runInContext(read('src/admin/preview.js'), ctx, { filename: 'preview.js' });
  assert.strictEqual(win.SVPreview.init(), true, 'önizleme başlamadı');

  /* İlk kare init'te üretiliyor (t = 0). Sonrası 45 FPS: gerçek kare
     gelmediği için önizleme 700 ms sonra demo sinyaline düşüyor. */
  const times = [0];
  let now = 700;
  const step = 1000 / 45;
  for (let i = 0; i < Math.round(seconds * 45); i++) {
    const before = frames.length;
    onFrame(now);
    if (frames.length > before) times.push(now / 1000);
    now += step;
  }
  return { frames, times, engine };
}

test('panel demoda ölçümün sesini veriyor — iki kanal birden', () => {
  const { frames, times, engine } = runPanel(2);
  assert.ok(frames.length > 60, 'kare üretilmedi: ' + frames.length);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    assert.strictEqual(f.sampleRate, D.SR);
    const [t, l, r] = bufs();
    D.fill(Math.floor(times[i] * D.SR), t, l, r);
    assert.deepStrictEqual(Array.from(f.time), Array.from(t), 'kare ' + i + ' mono');
    assert.deepStrictEqual(Array.from(f.left), Array.from(l), 'kare ' + i + ' sol');
    assert.deepStrictEqual(Array.from(f.right), Array.from(r), 'kare ' + i + ' sağ');
  }
  // Ses motoru kareyi stereo sayıyor: gonyometre demoda da alan çiziyor
  assert.strictEqual(engine.stereo, true);
  assert.ok(Array.from(engine.timeL).some((v, i) => v !== engine.timeR[i]), 'kanallar aynı');
});

test('panelin demosu MilkDrop bantlarının üçünü de kıpırdatıyor', () => {
  /* Üç alçak sinüsle orta ve tiz bant nicemleme gürültüsünden ibaretti:
     `mid` 0,64-1,38, `treb` 0,66-1,30. Bu seste ikisi de vuruşla tepe
     yapıyor; eşikler iki sinyali ayırt edecek kadar yüksek. */
  const { frames } = runPanel(6);
  const bands = new A.MilkdropBands();
  const range = {
    bass: [Infinity, -Infinity], mid: [Infinity, -Infinity], treb: [Infinity, -Infinity],
  };
  frames.forEach((f, i) => {
    const r = bands.update(1 / 45, f.time);
    if (i < 45 * 2) return; // ısınma: uzun dönem ortalama otursun
    for (const k of ['bass', 'mid', 'treb']) {
      range[k][0] = Math.min(range[k][0], r[k]);
      range[k][1] = Math.max(range[k][1], r[k]);
    }
  });
  assert.ok(range.mid[1] > 4, 'mid tepesi ' + range.mid[1].toFixed(2));
  assert.ok(range.treb[1] > 4, 'treb tepesi ' + range.treb[1].toFixed(2));
  assert.ok(range.bass[1] > 2.5, 'bass tepesi ' + range.bass[1].toFixed(2));
  for (const k of ['mid', 'treb']) {
    assert.ok(range[k][0] < 0.6, k + ' tabanı ' + range[k][0].toFixed(2));
  }
});

test('ölçümün ses penceresi kaymadı — parça 1. saniyeden başlıyor', () => {
  /* Harness kare başına hangi örnekleri verdiğini burada sabitliyor: pencere
     kayarsa 900 presetlik ölçüm başka bir sesi ölçer ve önceki koşularla
     karşılaştırılamaz. */
  const src = read('scripts/milkdrop-render-rate.js');
  const a = src.indexOf('var DEMO = window.SVDemoAudio;');
  const b = src.indexOf('/* Bir karenin özeti.');
  assert.ok(a > 0 && b > a, 'harness ses bölümü bulunamadı');
  const win = { SVDemoAudio: D };
  new Function('window', src.slice(a, b))(win);
  for (const i of [0, 7, 19]) {
    const f = win.__audio(i);
    const [t, l, r] = bufs();
    D.fill(Math.floor((1 + i / 30) * D.SR), t, l, r);
    assert.deepStrictEqual(Array.from(f.timeBytes), Array.from(t), 'kare ' + i + ' mono');
    assert.deepStrictEqual(Array.from(f.timeL), Array.from(l), 'kare ' + i + ' sol');
    assert.deepStrictEqual(Array.from(f.timeR), Array.from(r), 'kare ' + i + ' sağ');
  }
});

// -------------------------------------------------------------- bağlantı

test('panel ve ölçüm aynı dosyayı yüklüyor', () => {
  const html = read('src/admin/index.html');
  const demo = html.indexOf('<script src="../shared/demo-audio.js"></script>');
  const prev = html.indexOf('<script src="preview.js"></script>');
  assert.ok(demo > 0, 'panel demo-audio.js yüklemiyor');
  assert.ok(demo < prev, 'demo-audio.js daha sonra yükleniyor');

  const p = read('src/admin/preview.js');
  assert.match(p, /D\.fill\(Math\.floor\(t \* D\.SR\), synthTime, synthLeft, synthRight\)/);
  assert.match(p, /left: synthLeft, right: synthRight/);
  assert.doesNotMatch(p, /Math\.sin\(p \* 3 \+ t \* 6\)/, 'eski üç sinüs duruyor');

  const h = read('scripts/milkdrop-render-rate.js');
  assert.match(h, /const SIGNAL = 'src\/shared\/demo-audio\.js'/);
  assert.match(h, /window\.SVDemoAudio\)/, 'ölçüm dosyanın yüklendiğini denetlemiyor');
  assert.match(h, /ENGINE\.concat\(SIGNAL\)/);
  assert.match(h, /DEMO\.fill\(end, time, timeL, timeR\)/);
  assert.doesNotMatch(h, /var sampleAt = function/, 'ölçümde tarifin kopyası duruyor');
});

// ------------------------------------------------------- ekran görüntüleri

/* README görsellerini üreten `--shots` zaman verisini kendisi kuruyordu:
   2048 örnekte 4, 6 ve 12 devirlik üç alçak sinüs. Panelin eski demosuyla
   aynı dar bant — üstelik seviye (RMS) de o diziden hesaplanıyor, yani her
   mod README'de başka bir sese tepki veriyordu. */
function shotsFrame() {
  const src = read('src/main/main.js').replace(/\r\n/g, '\n');
  const a = src.indexOf("  const DEMO = require('../shared/demo-audio.js');");
  const end = 'return { freq, time, left, right, sampleRate: DEMO.SR };\n  };';
  const b = src.indexOf(end, a);
  assert.ok(a > 0 && b > a, 'üreticinin ses karesi bulunamadı');
  const body = src.slice(a, b + end.length);
  return new Function('require', body + '\nreturn makeFrame;')(() => D);
}

test('ekran görüntüsü üreticisi de aynı sesi veriyor — iki kanal birden', () => {
  const makeFrame = shotsFrame();
  for (const t of [0, 0.37, 1.25, 7.9]) {
    const f = makeFrame(t);
    assert.strictEqual(f.sampleRate, D.SR);
    const [m, l, r] = bufs();
    D.fill(Math.floor(t * D.SR), m, l, r);
    assert.deepStrictEqual(Array.from(f.time), Array.from(m), t + ' sn mono');
    assert.deepStrictEqual(Array.from(f.left), Array.from(l), t + ' sn sol');
    assert.deepStrictEqual(Array.from(f.right), Array.from(r), t + ' sn sağ');
    assert.strictEqual(f.freq.length, 1024, 'tayf eğrisi yerinde kalmalı');
  }
  const src = read('src/main/main.js');
  assert.doesNotMatch(src, /Math\.sin\(u \* Math\.PI \* 2 \* 4 \+ t \* 5\.2\)/, 'eski üç sinüs duruyor');
});

test('üreticinin tayfında hi-hat sesin ızgarasında: sekizlik, onaltılık değil', () => {
  /* Ortak seste hi-hat her 0,25 sn'de 0,08 sn çalıyor. Tayf onaltılıkta
     çalıyordu; dalga biçimi ile tayf farklı ritim gösterirdi. */
  const makeFrame = shotsFrame();
  const hatBin = (t) => makeFrame(t).freq[780];
  assert.ok(hatBin(0.26) - hatBin(0.2) > 30, 'sekizlikte hi-hat yok');
  assert.ok(Math.abs(hatBin(0.135) - hatBin(0.2)) < 10, 'onaltılıkta hi-hat çalıyor');
  for (const t of [0.51, 1.01, 1.76]) assert.ok(hatBin(t) - hatBin(t - 0.06) > 30, t + ' sn');
});
