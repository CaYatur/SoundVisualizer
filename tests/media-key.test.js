'use strict';
/* Medya katmanı renk ve parlaklık anahtarı. Delik kaynak pikselinin alfası
 * olur; kapalıyken tampon değişmez. Ayar varsayılan dosyada durmaz: o dosya
 * mod küçük resminin anahtarına girer, anahtar ise resmi değiştirmez. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function load() {
  const win = {};
  const sandbox = { window: win, document: { createElement: () => ({ getContext: () => null }) }, Math, parseInt, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(read('src/visualizer/modes/media.js'), sandbox);
  return win.SVMediaKey;
}

const K = load();
const px = (r, g, b, a) => new Uint8ClampedArray([r, g, b, a == null ? 255 : a]);

test('renk anahtarı yeşili siler, kırmızıyı bırakır, yumuşaklıkta ara alfa bırakır', () => {
  const green = px(0, 255, 0);
  assert.strictEqual(K.apply(green, { mode: 'chroma', color: '#00ff00', threshold: 0.2, softness: 0 }), 1);
  assert.strictEqual(green[3], 0);
  const red = px(255, 0, 0, 80);
  assert.strictEqual(K.apply(red, { mode: 'chroma', color: '#00ff00', threshold: 0.2, softness: 0 }), 0);
  assert.strictEqual(red[3], 80);
  const near = px(0, 255, 0);
  near[2] = 12;
  K.apply(near, { mode: 'chroma', color: '00ff00', threshold: 0, softness: 24 / (255 * Math.sqrt(3)) });
  assert.ok(near[3] > 100 && near[3] < 160, 'ara alfa: ' + near[3]);
});

test('parlaklık anahtarı karanlığı siler, tersi aydınlığı siler, eski alfayı çarpar', () => {
  const black = px(0, 0, 0, 200);
  K.apply(black, { mode: 'luma', threshold: 0.4, softness: 0, invert: false });
  assert.strictEqual(black[3], 0);
  const white = px(255, 255, 255, 180);
  K.apply(white, { mode: 'luma', threshold: 0.4, softness: 0, invert: false });
  assert.strictEqual(white[3], 180);
  K.apply(white, { mode: 'luma', threshold: 0.4, softness: 0, invert: true });
  assert.strictEqual(white[3], 0);
  const dim = px(0, 0, 0, 100);
  assert.strictEqual(K.apply(dim, { mode: 'off' }), 0);
  assert.strictEqual(dim[3], 100);
  assert.strictEqual(K.active({}), false);
  assert.strictEqual(K.active({ keyMode: 'chroma' }), true);
});

test('kapalıyken çizim yolu anahtar tuvali açmaz; panel ve çeviri bağlı', () => {
  const src = read('src/visualizer/modes/media.js');
  assert.match(src, /const frame = this\._keyed\(pic, vw, vh, m\) \|\| pic/);
  assert.match(src, /if \(!K \|\| !K\.active\(m\)/);
  const panel = read('src/admin/scene-panels.js');
  for (const s of ['Renk Anahtarı', 'Seçilen Renk', 'Anahtar Rengi', 'Saydam Kalan', 'Anahtar Eşiği', 'Anahtar Yumuşaklığı']) {
    assert.ok(panel.includes(s), s);
  }
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Renk Anahtarı', 'Seçilen Renk', 'Anahtar Rengi', 'Saydam Kalan', 'Anahtar Eşiği', 'Anahtar Yumuşaklığı']) {
    assert.ok(i18n.includes("'" + s + "':"), s);
  }
  assert.ok(!/keyMode:/.test(read('src/shared/defaults.js')), 'varsayılan dosyası anahtar yüzünden değişmemeli');
});

/* Hızlı yol (uzaklık karesi, karekök yalnız geçiş payında) eski tanımla aynı
 * sonucu vermeli: rastgele pikseller, renk ve parlaklık, eşik ve yumuşaklığın
 * uç değerleri. Eski tanım burada başvuru olarak duruyor. */
test('anahtarın hızlı yolu Math.hypot tanımıyla birebir aynı', () => {
  const KEY_MAX = 255 * Math.sqrt(3);
  const clamp = (v) => { const n = Number(v); return !(n > 0) ? 0 : n > 1 ? 1 : n; };
  function reference(data, o) {
    const thr = clamp(o.threshold);
    const soft = clamp(o.softness);
    let n = 0;
    if (o.mode === 'chroma') {
      const v = parseInt(o.color.slice(1), 16);
      const rgb = [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      const cut = thr * KEY_MAX;
      const fade = soft * KEY_MAX;
      for (let i = 0; i < data.length; i += 4) {
        const dist = Math.hypot(data[i] - rgb[0], data[i + 1] - rgb[1], data[i + 2] - rgb[2]);
        let keep = 1;
        if (dist <= cut) keep = 0;
        else if (fade > 0 && dist < cut + fade) keep = (dist - cut) / fade;
        if (keep < 1) { data[i + 3] = Math.round(data[i + 3] * keep); n++; }
      }
      return n;
    }
    for (let i = 0; i < data.length; i += 4) {
      const y = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const side = o.invert ? (y - thr) : (thr - y);
      let keep = 1;
      if (soft === 0) keep = side > 0 ? 0 : 1;
      else if (side >= soft) keep = 0;
      else if (side > 0) keep = 1 - side / soft;
      if (keep < 1) { data[i + 3] = Math.round(data[i + 3] * keep); n++; }
    }
    return n;
  }
  const base = new Uint8ClampedArray(4096 * 4);
  let seed = 7;
  for (let i = 0; i < base.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; base[i] = seed >>> 24; }
  let cases = 0;
  for (const mode of ['chroma', 'luma']) {
    for (const threshold of [0, 0.05, 0.3, 0.7, 1]) {
      for (const softness of [0, 0.02, 0.08, 0.5]) {
        for (const invert of [false, true]) {
          for (const color of ['#00ff00', '#3a7bd5', '#ffffff']) {
            const o = { mode, color, threshold, softness, invert };
            const a = new Uint8ClampedArray(base);
            const b = new Uint8ClampedArray(base);
            assert.strictEqual(K.apply(a, o), reference(b, o), JSON.stringify(o));
            assert.deepStrictEqual(a, b, JSON.stringify(o));
            cases++;
          }
        }
      }
    }
  }
  assert.strictEqual(cases, 240);
  // Duran videoda aynı kare ve ayarla yeniden işlenmiyor; plaka (aynı tuval, yeni içerik) hep işleniyor
  const src = read('src/visualizer/modes/media.js');
  assert.match(src, /const stamp = pic === this\.video && typeof pic\.currentTime === 'number' \? pic\.currentTime : NaN;/);
  assert.match(src, /if \(stamp === this\._keyStamp && sig === this\._keySig\) return c;/);
});
