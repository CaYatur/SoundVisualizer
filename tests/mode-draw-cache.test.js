'use strict';
/* En yavaş sahnelerin çizim hızlandırması (#905). Segment Barlar ve Nokta Matris tema renklerini
   önbellekten alıyor, Voronoi hücreleri tek bir görüntüde topluyor, Dalga Girişimi sinüsü çizelgeden
   okuyor, Dalga Alanı dolgusunu dalga bandıyla sınırlıyor, Nabız Halkaları düz uçla çiziyor. Burada
   her birinin sonucu eski formülle ya da çizimle karşılaştırılıyor: hız için görüntü değişmedi
   (Voronoi'deki ızgara izleri ve Dalga Alanı'nın ekran kenarındaki çerçevesi bilerek gitti). */
const test = require('node:test');
const assert = require('node:assert');

function recorder(W, H) {
  const log = { styles: [], calls: {} };
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return () => { log.calls[k] = (log.calls[k] || 0) + 1; };
    },
    set(o, k, v) { if (k === 'fillStyle') log.styles.push(v); o[k] = v; return true; },
  });
  return { log, canvas: { width: W, height: H, getContext: () => ctx } };
}

function env() {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const w = global.window;
  w.SVGlow = class { apply() {} };
  w.SVOnset = require('../src/shared/onset.js');
  global.document = { createElement: () => recorder(0, 0).canvas };
  for (const f of ['blocks', 'dots', 'generative']) {
    const p = require.resolve('../src/visualizer/modes/' + f + '.js');
    delete require.cache[p];
    require(p);
  }
  return w;
}

function themeCfg(w, n) {
  const cfg = w.SV.defaultConfig();
  Object.assign(cfg.visualizer, { colorMode: 'theme', barCount: n, sensitivity: 1, glow: 0 });
  return cfg;
}

function countSamples(w) {
  const real = w.SV.sampleThemeColor;
  const box = { n: 0, real };
  w.SV.sampleThemeColor = (c, p) => { box.n++; return real(c, p); };
  return box;
}

test('Segment Barlar: her hücrenin rengi eskisiyle aynı, renkler ikinci karede yeniden hesaplanmıyor', () => {
  const w = env();
  const { log, canvas } = recorder(1920, 1080);
  const m = new w.SVModes.blocks(canvas);
  const cfg = themeCfg(w, 24);
  const bars = Array.from({ length: 24 }, (_, i) => (i % 5) / 4);
  const S = countSamples(w);
  m.draw({ getBars: () => bars }, cfg, 0);
  const segs = Math.max(6, Math.min(40, Math.round(1080 / 26)));
  const exp = [];
  for (let i = 0; i < 24; i++) {
    const lit = Math.round(Math.min(1, bars[i]) * segs);
    for (let s = 0; s < segs; s++) exp.push(s < lit ? S.real(cfg, (i / 24) * 0.7 + (s / (segs - 1)) * 0.3) : 'rgba(255,255,255,0.06)');
    if (bars[i] * segs > 0.4) exp.push('#ffffff');
  }
  assert.deepStrictEqual(log.styles, exp);
  assert.strictEqual(S.n, 24 * segs, 'ilk karede her hücre bir kez');
  m.draw({ getBars: () => bars }, cfg, 0.016);
  assert.strictEqual(S.n, 24 * segs, 'ikinci karede yeni renk hesabı yok');
  cfg.background.gradient.colors = ['#ff0000', '#00ff00', '#0000ff'];
  m.draw({ getBars: () => bars }, cfg, 0.032);
  assert.strictEqual(S.n, 2 * 24 * segs, 'tema değişince renkler yeniden kuruluyor');
  w.SV.sampleThemeColor = S.real;
});

test('Nokta Matris: yanan noktaların tema rengi eskisiyle aynı, ikinci karede yeniden hesaplanmıyor', () => {
  const w = env();
  const { log, canvas } = recorder(1280, 720);
  const m = new w.SVModes.dots(canvas);
  const cfg = themeCfg(w, 16);
  const bars = Array.from({ length: 16 }, (_, i) => (i % 4) / 3);
  const S = countSamples(w);
  m.draw({ getBars: () => bars }, cfg, 0);
  const rows = Math.max(5, Math.min(48, Math.round(720 / 30)));
  const exp = [];
  for (let i = 0; i < 16; i++) {
    const lit = Math.min(1, bars[i]) * rows;
    for (let s = 0; s < rows; s++) exp.push(s < lit ? S.real(cfg, (i / 16) * 0.7 + (s / (rows - 1)) * 0.3) : 'rgba(255,255,255,0.06)');
    if (lit > 0.5) exp.push('#ffffff');
  }
  assert.deepStrictEqual(log.styles, exp);
  m.draw({ getBars: () => bars }, cfg, 0.016);
  assert.strictEqual(S.n, 16 * rows, 'ikinci karede yeni renk hesabı yok');
  w.SV.sampleThemeColor = S.real;
});

test('Voronoi: hücreler tek görüntüde, her hücre eski formülün rengi ve opaklığında', () => {
  const w = env();
  const { log, canvas } = recorder(1920, 1080);
  const m = new w.SVModes.voronoi(canvas);
  const cfg = themeCfg(w, 26);
  const bars = Array.from({ length: 26 }, (_, i) => ((i * 7) % 11) / 10);
  m.draw({ getBars: () => bars }, cfg, 2.5);
  assert.strictEqual(log.calls.fillRect, undefined, 'hücre başına dikdörtgen yok');
  assert.strictEqual(log.calls.drawImage, 1, 'tek çizim');
  const v = cfg.visualizer;
  const cell = Math.max(4, Math.round(14 - v.thickness * 8) * (1080 / 900));
  const cols = Math.ceil(1920 / cell);
  const rows = Math.ceil(1080 / cell);
  assert.strictEqual(m.data.width, cols);
  assert.strictEqual(m.data.height, rows);
  const d = m.data.data;
  for (let r = 0; r < rows; r += 7) {
    for (let c = 0; c < cols; c += 9) {
      const x = c * cell + cell * 0.5;
      const y = r * cell + cell * 0.5;
      let best = -1, bd = Infinity, bd2 = Infinity;
      for (let i = 0; i < m.N; i++) {
        const dd = (x - m._sx[i]) ** 2 + (y - m._sy[i]) ** 2;
        if (dd < bd) { bd2 = bd; bd = dd; best = i; } else if (dd < bd2) bd2 = dd;
      }
      const e = Math.min(1, Math.max(0, bars[best]));
      const edge = Math.min(1, Math.max(0, (Math.sqrt(bd2) - Math.sqrt(bd)) / (cell * 3)));
      const o = (r * cols + c) * 4;
      assert.strictEqual(d[o + 3], Math.round((0.12 + e * 0.75) * (0.25 + edge * 0.75) * 255), 'opaklık');
      assert.deepStrictEqual([d[o], d[o + 1], d[o + 2]], Array.from(m._cr.subarray(best * 3, best * 3 + 3)), 'en yakın tohumun rengi');
    }
  }
});

test('Dalga Girişimi: sinüs çizelgesiyle çizilen alan doğrudan Math.sin hesabıyla aynı', () => {
  const w = env();
  const { canvas } = recorder(960, 540);
  const m = new w.SVModes.interference(canvas);
  const cfg = themeCfg(w, 5);
  const bars = [0.8, 0, 0.5, 0.3, 1];
  // Uzun koşudaki büyük t de dahil; boyut ve kalınlık değişince de aynı kalmalı
  const runs = [[1.37, 960, 0.5], [5400.25, 960, 0.5], [2.5, 640, 0.5], [2.5, 640, 0.9]];
  for (const [t, Wc, th] of runs) {
    canvas.width = Wc;
    cfg.visualizer.thickness = th;
    m.draw({ getBars: () => bars }, cfg, t);
    const W = m.img.width;
    const H = m.img.height;
    const d = m.data.data;
    let worst = 0;
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        let s = 0;
        for (let i = 0; i < m.N; i++) {
          const r = Math.sqrt((x - m._px[i]) ** 2 + (y - m._py[i]) ** 2);
          s += Math.sin(r * m._k[i] - t * (2 + i * 0.7)) * m._amp[i];
        }
        const norm = Math.min(1, Math.max(0, s / m.N * 0.5 + 0.5));
        worst = Math.max(worst, Math.abs(d[(y * W + x) * 4 + 3] - ((Math.abs(norm - 0.5) * 2 * 255) | 0)));
      }
    }
    assert.ok(worst <= 1, `t=${t} ${Wc}px kalınlık ${th}: opaklık farkı en çok 1, ölçülen ${worst}`);
  }
});

function callLog(W, H) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a) => { calls.push([k, ...a]); };
    },
    set(o, k, v) { calls.push(['set', k, v]); o[k] = v; return true; },
  });
  return { calls, ctx, W, H };
}

function loadBackgrounds() {
  env();
  for (const f of ['backgrounds', 'backgrounds-gen']) {
    const p = require.resolve('../src/visualizer/modes/' + f + '.js');
    delete require.cache[p];
    require(p);
  }
  return global.window.SVBackgrounds;
}

test('Dalga Alanı: dolgu yolu dalga bandında biter, altı düz dikdörtgen; çizgi yalnız dalgayı çizer', () => {
  const B = loadBackgrounds();
  const { calls, ctx } = callLog(1920, 1080);
  const m = new B.wavefield();
  const cfg = global.window.SV.defaultConfig();
  for (let k = 0; k < 30; k++) {
    calls.length = 0;
    const bars = Array.from({ length: 96 }, (_, i) => 0.3 + 0.3 * Math.sin(i * 0.2 + k));
    m.draw(ctx, { getBars: () => bars, level: 0.5, bass: 0.5 }, cfg, k / 60, 1920, 1080);
  }
  const layers = m.hist.length;
  const strokes = calls.filter((c) => c[0] === 'stroke').length;
  assert.strictEqual(strokes, layers, 'katman başına bir çizgi');
  let rects = 0;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === 'stroke') {
      let j = i - 1;
      while (j > 0 && calls[j][0] === 'set') j--;
      const last = calls[j];
      assert.deepStrictEqual([last[0], last[1]], ['lineTo', 1920], 'çizgi dalganın son noktasında biter, kenara inmez');
    }
    if (calls[i][0] === 'lineTo' && calls[i][1] === 0) assert.ok(calls[i][2] < 1080, 'dolgu yolu ekranın dibine inmiyor');
    // Dolgunun hemen ardından gelen dikdörtgen (zemin temizliği ve vinyet değil)
    if (calls[i][0] === 'fillRect' && calls[i - 1][0] === 'fill') {
      const yb = calls[i][2];
      assert.strictEqual(yb, Math.round(yb), 'dikdörtgen tam sayı satırdan başlar');
      let j = i - 1;
      while (j > 0 && calls[j][0] !== 'lineTo') j--;
      assert.deepStrictEqual(calls[j].slice(0, 3), ['lineTo', 0, yb], 'dolgu yolu aynı satırda kapanır: boşluk ya da üst üste binme yok');
      assert.strictEqual(calls[i][4], 1080 - yb);
      rects++;
    }
  }
  assert.ok(rects > layers / 2, 'bant altı dikdörtgenleri: ' + rects);
});

test('Nabız Halkaları: halkalar düz uçla çizilir (tam dairede yuvarlak uç görünmüyor, hızlı çizimi kapatıyordu)', () => {
  const B = loadBackgrounds();
  const { calls, ctx } = callLog(1920, 1080);
  const m = new B.rings();
  const cfg = global.window.SV.defaultConfig();
  for (let k = 0; k < 120; k++) m.draw(ctx, { getBars: () => [], level: 0.5, bass: (k % 30) < 3 ? 0.95 : 0.2 }, cfg, k / 60, 1920, 1080, 1 / 60);
  const caps = calls.filter((c) => c[0] === 'set' && c[1] === 'lineCap').map((c) => c[2]);
  assert.ok(caps.length > 0 && caps.every((c) => c === 'butt'), caps.join(','));
  assert.ok(calls.some((c) => c[0] === 'arc' && c[5] === Math.PI * 2), 'halkalar tam daire');
});
