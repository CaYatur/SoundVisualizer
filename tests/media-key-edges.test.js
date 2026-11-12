'use strict';
/* Renk anahtarının kenar işleri (#419): taşma bastırma ve kenar yumuşatma.
 * Ekran kaynağının yenileme hızı ve yayın sayfasına aktarımı (#421). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadKey() {
  const win = {};
  const sandbox = { window: win, document: { createElement: () => ({ getContext: () => null }) }, Math, parseInt, setTimeout, clearTimeout, Uint8Array, Uint32Array };
  vm.createContext(sandbox);
  vm.runInContext(read('src/visualizer/modes/media.js'), sandbox);
  return win;
}

const W = loadKey();
const K = W.SVMediaKey;
const GREEN = { mode: 'chroma', color: '#00ff00', threshold: 0.2, softness: 0 };

test('baskın kanal: yeşil, mavi ve kırmızı bulunur; gri ve sarıda yok', () => {
  assert.strictEqual(K.spillChannel([0, 255, 0]), 1);
  assert.strictEqual(K.spillChannel([10, 40, 230]), 2);
  assert.strictEqual(K.spillChannel([240, 30, 60]), 0);
  assert.strictEqual(K.spillChannel([128, 128, 128]), -1);
  assert.strictEqual(K.spillChannel([255, 255, 0]), -1, 'iki kanal eşit: hangisi kısılacak belli değil');
});

test('taşma bastırma görünür pikselde yeşili öteki kanalların büyüğüne çeker', () => {
  // Ten rengine yeşil yansımış bir piksel: anahtardan uzak, görünür kalıyor
  const skin = new Uint8ClampedArray([150, 190, 120, 255]);
  K.apply(skin, Object.assign({ spill: 1 }, GREEN));
  assert.deepStrictEqual(Array.from(skin), [150, 150, 120, 255], 'tam bastırmada yeşil = max(kırmızı, mavi)');
  const half = new Uint8ClampedArray([150, 190, 120, 255]);
  K.apply(half, Object.assign({ spill: 0.5 }, GREEN));
  assert.deepStrictEqual(Array.from(half), [150, 170, 120, 255], 'yarı bastırmada farkın yarısı');
  // Yeşili zaten düşük olan piksele dokunulmaz
  const red = new Uint8ClampedArray([200, 40, 60, 255]);
  K.apply(red, Object.assign({ spill: 1 }, GREEN));
  assert.deepStrictEqual(Array.from(red), [200, 40, 60, 255]);
});

test('taşma bastırma kapalıyken ve parlaklık anahtarında renge dokunulmaz', () => {
  const a = new Uint8ClampedArray([150, 190, 120, 255]);
  K.apply(a, Object.assign({ spill: 0 }, GREEN));
  assert.deepStrictEqual(Array.from(a), [150, 190, 120, 255]);
  const b = new Uint8ClampedArray([150, 190, 120, 255]);
  K.apply(b, { mode: 'luma', threshold: 0.1, softness: 0, spill: 1 });
  assert.deepStrictEqual(Array.from(b), [150, 190, 120, 255]);
  // Belirgin kanalı olmayan anahtar renginde de dokunulmaz
  const c = new Uint8ClampedArray([150, 190, 120, 255]);
  K.apply(c, { mode: 'chroma', color: '#808080', threshold: 0.02, softness: 0, spill: 1 });
  assert.deepStrictEqual(Array.from(c), [150, 190, 120, 255]);
});

test('taşma bastırma anahtarın sildiği pikseli ve alfa kararını değiştirmez', () => {
  const base = new Uint8ClampedArray(2048 * 4);
  let seed = 11;
  for (let i = 0; i < base.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; base[i] = seed >>> 24; }
  const o = { mode: 'chroma', color: '#00ff00', threshold: 0.3, softness: 0.08 };
  const plain = new Uint8ClampedArray(base);
  const spilled = new Uint8ClampedArray(base);
  const n1 = K.apply(plain, o);
  const n2 = K.apply(spilled, Object.assign({ spill: 0.8 }, o));
  assert.strictEqual(n1, n2, 'aynı sayıda piksel anahtarlandı');
  for (let i = 3; i < base.length; i += 4) assert.strictEqual(spilled[i], plain[i], 'alfa aynı');
  let lowered = 0;
  for (let i = 0; i < base.length; i += 4) {
    assert.strictEqual(spilled[i], plain[i]);
    assert.strictEqual(spilled[i + 2], plain[i + 2]);
    assert.ok(spilled[i + 1] <= plain[i + 1], 'yeşil yalnız azalır');
    if (spilled[i + 1] < plain[i + 1]) lowered++;
  }
  assert.ok(lowered > 100, 'bastırılan piksel var: ' + lowered);
});

/* 16x8 kare: sol yarı saydam (alfa 0), sağ yarı opak (255). */
function halves(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = x < w / 2 ? 0 : 255;
  return d;
}

test('kenar yumuşatma kenarı içe doğru yumuşatır; saydam taraf saydam kalır', () => {
  const w = 16;
  const h = 8;
  const d = halves(w, h);
  assert.strictEqual(K.feather(d, w, h, 2), true);
  const row = (y) => Array.from({ length: w }, (_, x) => d[(y * w + x) * 4 + 3]);
  const r = row(3);
  for (let x = 0; x < 8; x++) assert.strictEqual(r[x], 0, 'saydam taraf: ' + x);
  assert.deepStrictEqual(r.slice(8, 11), [153, 204, 255], 'kenardan içeri 3/5, 4/5, tam');
  for (let x = 10; x < w; x++) assert.strictEqual(r[x], 255, 'iç kısım opak: ' + x);
  // Her satır aynı (dikey geçiş düz kenarı bozmaz)
  for (let y = 0; y < h; y++) assert.deepStrictEqual(row(y), r);
});

test('kenar yumuşatma: sıfır yarıçap ve eksik boyut hiçbir şey yapmaz; alfa asla artmaz', () => {
  const d = halves(16, 8);
  const before = new Uint8ClampedArray(d);
  assert.strictEqual(K.feather(d, 16, 8, 0), false);
  assert.strictEqual(K.feather(d, 0, 8, 3), false);
  assert.strictEqual(K.feather(d, 64, 64, 3), false, 'tampon boyuttan küçük');
  assert.deepStrictEqual(d, before);
  const noise = new Uint8ClampedArray(40 * 30 * 4);
  let seed = 5;
  for (let i = 0; i < noise.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; noise[i] = seed >>> 24; }
  const src = new Uint8ClampedArray(noise);
  K.feather(noise, 40, 30, 12);
  for (let i = 0; i < noise.length; i += 4) {
    assert.ok(noise[i + 3] <= src[i + 3], 'alfa artmaz');
    assert.strictEqual(noise[i], src[i]);
    assert.strictEqual(noise[i + 1], src[i + 1]);
    assert.strictEqual(noise[i + 2], src[i + 2]);
  }
  // Tümü opak karede hiçbir piksel değişmez
  const solid = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  K.feather(solid, 20, 20, 6);
  assert.ok(solid.every((v) => v === 255));
});

test('anahtar yumuşatmayı boyut verilince uygular, verilmeyince atlar', () => {
  const w = 16;
  const h = 8;
  const make = () => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < w / 2) { d[i + 1] = 255; } else { d[i] = 255; }
      d[i + 3] = 255;
    }
    return d;
  };
  const hard = make();
  K.apply(hard, GREEN);
  assert.strictEqual(hard[(3 * w + 8) * 4 + 3], 255, 'yumuşatmasız kenar keskin');
  const soft = make();
  K.apply(soft, Object.assign({ feather: 2, width: w, height: h }, GREEN));
  assert.strictEqual(soft[(3 * w + 7) * 4 + 3], 0);
  assert.strictEqual(soft[(3 * w + 8) * 4 + 3], 153);
  const noSize = make();
  K.apply(noSize, Object.assign({ feather: 2 }, GREEN));
  assert.deepStrictEqual(noSize, hard);
  // Parlaklık anahtarında da çalışır
  const luma = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = x < w / 2 ? 0 : 255;
    luma[i] = luma[i + 1] = luma[i + 2] = v;
    luma[i + 3] = 255;
  }
  K.apply(luma, { mode: 'luma', threshold: 0.5, softness: 0, feather: 2, width: w, height: h });
  assert.strictEqual(luma[(3 * w + 8) * 4 + 3], 153);
});

test('çizim yolu yeni ayarları imzaya ve anahtara taşır; panel ve çeviri bağlı', () => {
  const src = read('src/visualizer/modes/media.js');
  assert.match(src, /\(m\.keySpill \|\| 0\) \+ '\|' \+ \(m\.keyFeather \|\| 0\)/, 'ayar değişince önbellek geçersiz');
  assert.match(src, /spill: m\.keySpill \|\| 0,/);
  assert.match(src, /feather: \(m\.keyFeather \|\| 0\) \* Math\.max\(dw, dh\) \/ MAX,/);
  const panel = read('src/admin/scene-panels.js');
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Renk Taşmasını Bastır', 'Anahtar Kenar Yumuşatma', 'Yenileme Hızı', 'Varsayılan (30 fps)']) {
    assert.ok(panel.includes("'" + s + "'"), 'panelde yok: ' + s);
    assert.ok(i18n.includes("'" + s + "':"), 'çevirisi yok: ' + s);
  }
  assert.ok(!/keySpill|keyFeather|screenFps/.test(read('src/shared/defaults.js')), 'varsayılan dosyası değişmemeli');
});

test('ekran yenileme hızı: 0 varsayılan, gerisi 5..60 arasına sıkışır', () => {
  const f = W.SVScreenFps;
  assert.strictEqual(f(0), 0);
  assert.strictEqual(f(undefined), 0);
  assert.strictEqual(f('abc'), 0);
  assert.strictEqual(f(-3), 0);
  assert.strictEqual(f(30), 30);
  assert.strictEqual(f('15'), 15);
  assert.strictEqual(f(2), 5);
  assert.strictEqual(f(240), 60);
});

function flush() {
  return new Promise((r) => setImmediate(r));
}

function loadMedia(api, protocol) {
  const calls = [];
  const sent = { status: [], claims: 0 };
  const el = () => ({
    muted: false, playsInline: false, autoplay: false, crossOrigin: '', loop: false, src: '', srcObject: null,
    readyState: 0, videoWidth: 0, videoHeight: 0, onerror: null, onloadeddata: null,
    removeAttribute() {}, load() {}, pause() {}, play() { return Promise.resolve(); }, getContext() { return {}; },
  });
  const timers = [];
  const ctx = {
    document: { createElement: el },
    location: { protocol: protocol || 'file:', search: '' },
    navigator: {
      mediaDevices: {
        getUserMedia(c) {
          calls.push(c);
          return Promise.resolve({ getTracks() { return [{ stop() {} }]; } });
        },
      },
    },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; },
    clearTimeout,
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.push(t); return t; },
    clearInterval,
    URLSearchParams, Promise, Date,
    Image: function Image() { this.naturalWidth = 0; },
    fetch: () => Promise.resolve({ status: 200, body: { cancel() {} } }),
  };
  ctx.window = ctx;
  if (api) {
    ctx.api = Object.assign({
      claimCamRelay: () => { sent.claims++; return Promise.resolve(false); },
      releaseCamRelay: () => {},
      sendCamFrame: () => {},
      sendCamStatus: (m) => sent.status.push(m),
    }, api);
  }
  vm.createContext(ctx);
  vm.runInContext(read('src/visualizer/modes/media.js'), ctx);
  return { Media: ctx.SVMedia, calls, sent, stop: () => timers.forEach((t) => { clearTimeout(t); clearInterval(t); }) };
}

test('yenileme hızı masaüstü kısıtına maxFrameRate olarak girer; 0 iken girmez', async () => {
  const api = { screenSources: () => Promise.resolve({ ok: true, sources: [{ id: 'screen:0:0', name: 'Birinci' }] }) };
  const a = loadMedia(api);
  const m = new a.Media();
  m.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0', screenFps: 15 });
  await flush();
  await flush();
  assert.strictEqual(a.calls.length, 1);
  assert.strictEqual(a.calls[0].video.mandatory.maxFrameRate, 15);
  assert.strictEqual(a.calls[0].video.mandatory.chromeMediaSourceId, 'screen:0:0');
  // Hız değişince kaynak yeniden açılır
  m.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0', screenFps: 30 });
  await flush();
  await flush();
  assert.strictEqual(a.calls.length, 2);
  assert.strictEqual(a.calls[1].video.mandatory.maxFrameRate, 30);
  m.dispose();
  a.stop();

  const b = loadMedia(api);
  const n = new b.Media();
  n.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0' });
  await flush();
  await flush();
  assert.ok(!('maxFrameRate' in b.calls[0].video.mandatory), 'sınır verilmedi');
  n.dispose();
  b.stop();
});

test('uygulamada açılan ekran yayın sayfası için aktarım sahipliğini dener ve durumunu bildirir', async () => {
  const api = { screenSources: () => Promise.resolve({ ok: true, sources: [{ id: 'window:7:0', name: 'Not' }] }) };
  const a = loadMedia(api);
  const m = new a.Media();
  m.apply({ enabled: true, source: 'screen', screenId: 'window:7:0' });
  await flush();
  await flush();
  assert.strictEqual(m.ready, true);
  assert.ok(a.sent.claims >= 1, 'aktarım sahipliği denendi');
  const last = a.sent.status[a.sent.status.length - 1];
  assert.strictEqual(last.key, 'window:7:0');
  assert.strictEqual(last.ready, true);
  m.dispose();
  a.stop();
});

test('yayın sayfası ekranı kendisi açmaz: kareyi uygulamadan bekler', async () => {
  const a = loadMedia(null, 'http:');
  const m = new a.Media();
  m.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0' });
  await flush();
  assert.strictEqual(a.calls.length, 0, 'getUserMedia çağrılmadı');
  assert.strictEqual(m.ready, false);
  assert.strictEqual(m.error, 'Ekran görüntüsü uygulamadan bekleniyor.');
  assert.ok(read('src/shared/i18n.js').includes("'Ekran görüntüsü uygulamadan bekleniyor.':"));
  m.dispose();
  a.stop();
});
