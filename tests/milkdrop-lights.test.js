'use strict';
/* IŞIKLARA MILKDROP RENKLERİ (#589).
 *
 * Işıklar arkaplanın ya da temanın renklerini alabiliyordu, MilkDrop'unkini
 * değil: örneklenmiş palet yalnız arkaplan katmanlarından okunuyordu. Yeni
 * renk kaynağı `milkdrop` paleti MilkDrop'un o anki karesinden dolduruyor:
 * kare soldan sağa sekiz dilime bölünüyor, dilimin rengi parlaklığın
 * karesiyle ağırlıklı ortalama, ton korunup parlaklık tama çekiliyor.
 * Dynamic Lighting, OpenRGB ve Art-Net aynı paleti kullanıyor; OpenRGB
 * kareden gelen renkleri eskiden hiç almıyordu.
 *
 * Motorun örnekleyicisi sahte bir tuvalle, ışık oluşturucusu ve Art-Net'in
 * kanal üreticisi gerçek kodla sınanıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

global.window = global.window || {};
const L = require('../src/visualizer/layers.js');
const LR = require('../src/shared/lighting-render.js');
const ART = require('../src/main/artnet.js');

/* 64x16'lık küçültülmüş kare: `paint(x, y)` her pikselin rengini veriyor.
   Sahte tuval, motorun istediği küçültmeyi bu işlevden dolduruyor. */
function engineWith(paint) {
  const calls = [];
  // Hangi tuvale ne yapıldı: sık okumaya ayrılmış mı, kaynak ne boyda
  const ops = [];
  const canvas = (w, h) => {
    const c = { width: w || 0, height: h || 0, addEventListener() {} };
    c.getContext = (k, opts) => {
      if (k !== '2d') return null;
      if (opts) c.opts = opts;
      const freq = () => !!(c.opts && c.opts.willReadFrequently);
      return {
        clearRect() {},
        drawImage(src, x, y, dw, dh) {
          calls.push([src === c ? 'self' : 'src', dw, dh]);
          ops.push(['draw', freq(), src.width]);
        },
        getImageData(x0, y0, w2, h2) {
          ops.push(['read', freq(), w2 * h2]);
          const data = new Uint8ClampedArray(w2 * h2 * 4);
          for (let yy = 0; yy < h2; yy++) {
            for (let xx = 0; xx < w2; xx++) {
              const rgb = paint(xx, yy);
              const o = (yy * w2 + xx) * 4;
              data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
            }
          }
          return { data };
        },
      };
    };
    return c;
  };
  const ctx = { window: {}, document: { createElement: () => canvas() }, console, performance };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(read('src/visualizer/modes/milkdrop.js'), ctx, { filename: 'milkdrop.js' });
  const m = new ctx.window.SVModes.milkdrop(canvas(1920, 1080));
  return { m, calls, ops };
}

// ------------------------------------------------------------ örnekleyici

test('renkler soldan sağa dilimlerden: sol yarı kırmızı, sağ yarı mavi', () => {
  const { m, calls } = engineWith((x) => (x < 32 ? [200, 0, 0] : [0, 0, 180]));
  const c = Array.from(m.sampleColors(8));
  assert.deepStrictEqual(c, ['#ff0000', '#ff0000', '#ff0000', '#ff0000', '#0000ff', '#0000ff', '#0000ff', '#0000ff']);
  // Kare 64x16'ya küçültülüyor; tam kare geri okunmuyor
  assert.deepStrictEqual(Array.from(calls[0]), ['src', 64, 16]);
});

test('geri okuma küçük tuvalden; tam boy kare GPU tuvalinde küçültülüyor (#575)', () => {
  /* Tek tuvalde `getImageData` Chromium'un "willReadFrequently" uyarısını
     veriyordu (öz test onu hata sayıyor); tuvali sık okumaya ayırmak ise
     tam boy kareyi her seferinde işlemciye çekerdi. */
  const { m, ops } = engineWith(() => [200, 0, 0]);
  m.sampleColors(8);
  m.sampleColors(8);
  const reads = ops.filter((o) => o[0] === 'read');
  assert.ok(reads.length === 2 && reads.every((o) => o[1] === true && o[2] === 64 * 16), 'okuma sık okumaya ayrılmış 64x16 tuvalden');
  const full = ops.filter((o) => o[0] === 'draw' && o[2] === 1920);
  assert.ok(full.length === 2 && full.every((o) => o[1] === false), 'tam boy kare sık okumaya ayrılmamış tuvalde küçültülüyor');
  const copy = ops.filter((o) => o[0] === 'draw' && o[2] === 64);
  assert.ok(copy.length === 2 && copy.every((o) => o[1] === true), 'küçük kare okuma tuvaline kopyalanıyor');
});

test('koyu arkaplandaki küçük parlak ayrıntı dilimin rengini veriyor', () => {
  /* Düz ortalamada birkaç yeşil piksel griye boğulurdu; ağırlık
     parlaklığın karesi olduğu için dilim yeşil çıkıyor. */
  const { m } = engineWith((x, y) => (x === 3 && y === 7 ? [10, 220, 30] : [6, 6, 6]));
  const c = m.sampleColors(8);
  const g = parseInt(c[0].slice(3, 5), 16);
  const r = parseInt(c[0].slice(1, 3), 16);
  assert.ok(g === 255 && r < 90, 'ilk dilim yeşil olmalı: ' + c[0]);
});

test('ton korunuyor, parlaklık tama çekiliyor; neredeyse siyah siyah kalıyor', () => {
  const dim = Array.from(engineWith(() => [40, 20, 0]).m.sampleColors(4));
  assert.deepStrictEqual(dim, ['#ff8000', '#ff8000', '#ff8000', '#ff8000']);
  const dark = Array.from(engineWith(() => [5, 3, 1]).m.sampleColors(4));
  assert.deepStrictEqual(dark, ['#000000', '#000000', '#000000', '#000000']);
});

test('dilim sayısı sınırlı ve tuval yokken boş', () => {
  const { m } = engineWith(() => [255, 255, 255]);
  assert.strictEqual(m.sampleColors(40).length, 16);
  assert.strictEqual(m.sampleColors(0).length, 8);
  m.canvas = null;
  assert.deepStrictEqual(Array.from(m.sampleColors(8)), []);
});

test('yığın ilk MilkDrop katmanına soruyor, yoksa boş', () => {
  const md = { sampleColors: (n) => Array(n).fill('#123456') };
  const fake = { entries: [{ mode: null }, { mode: {} }, { mode: md }] };
  assert.deepStrictEqual(L.LayerStack.prototype.milkdropColors.call(fake, 3), ['#123456', '#123456', '#123456']);
  assert.deepStrictEqual(L.LayerStack.prototype.milkdropColors.call({ entries: [{ mode: {} }] }, 3), []);
});

// ------------------------------------------------------------- ölçer karesi

test('ölçer karesi: kaynak milkdrop ise palet MilkDrop\'tan, her ışık çıkışı için', () => {
  const V = bare(read('src/visualizer/visualizer.js'));
  assert.match(V, /const lightsOut = !!cfg\.lighting\?\.enabled \|\| !!cfg\.openrgb\?\.enabled \|\| !!cfg\.artnet\?\.enabled;/);
  assert.match(V, /if \(lightSrc === 'milkdrop' && lightsOut\) \{\s*backgroundColors = stack\.milkdropColors\(8\);\s*if \(!backgroundColors\.length\) backgroundColors = stack\.palette\(cfg\);/);
  // Arkaplan kaynağı eskisi gibi yalnız Dynamic Lighting istediğinde okunuyor
  assert.match(V, /\} else if \(!!cfg\.lighting\?\.enabled && lightSrc === 'background'\) \{\s*backgroundColors = stack\.palette\(cfg\);/);
  assert.match(V, /window\.api\.sendAudioMeter\(\{[\s\S]*?\bbackgroundColors,/);
});

// ------------------------------------------------------------ ışık çizimi

test('oluşturucu: milkdrop kaynağı örneklenmiş paleti kullanıyor', () => {
  const R = LR.createRenderer();
  const lighting = R.normalizeLighting({ enabled: true, paletteSource: 'milkdrop', saturation: 1 });
  const vc = LR.withSampledColors({ background: { type: 'solid', solidColor: '#00ff00' } },
    { backgroundColors: ['#ff0000', '#0000ff'] });
  assert.strictEqual(R.sourceColor('milkdrop', 0, 0.5, 0, lighting, vc), '#ff0000');
  assert.strictEqual(R.sourceColor('milkdrop', 1, 0.5, 0, lighting, vc), '#0000ff');
  // Örnek yoksa arkaplanın kendi rengine düşüyor, ışık sönmüyor
  const none = LR.withSampledColors({ background: { type: 'solid', solidColor: '#00ff00' } }, { backgroundColors: [] });
  assert.strictEqual(R.sourceColor('milkdrop', 0, 0.5, 0, lighting, none), '#00ff00');
});

test('withSampledColors: renk varsa yeni nesne, yoksa aynı nesne', () => {
  const vc = { a: 1 };
  assert.strictEqual(LR.withSampledColors(vc, null), vc);
  assert.strictEqual(LR.withSampledColors(vc, { backgroundColors: [] }), vc);
  const out = LR.withSampledColors(vc, { backgroundColors: ['#ffffff'] });
  assert.notStrictEqual(out, vc);
  assert.deepStrictEqual(out.__lightingBackgroundColors, ['#ffffff']);
  assert.strictEqual(vc.__lightingBackgroundColors, undefined, 'girdi değişmemeli');
});

test('Dynamic Lighting ve OpenRGB aynı yoldan: kareden gelen palet çizime gidiyor', () => {
  const DL = bare(read('src/main/dynamic-lighting.js'));
  assert.match(DL, /const renderConfig = withSampledColors\(visualConfig, frame\);/);
  assert.match(DL, /renderPixel\(lighting\.mode, position, bars, lighting, renderConfig, state\)/);
  const OR = bare(read('src/main/openrgb.js'));
  assert.match(OR, /const renderConfig = withSampledColors\(visualConfig, frame\);/);
  assert.match(OR, /renderer\.renderPixel\(lighting\.mode, position, bars, lighting, renderConfig, st\)/);
});

test('Art-Net palet kipi MilkDrop renklerini soldan sağa dağıtıyor', () => {
  const colors = ['#ff0000', '#ff0000', '#ff0000', '#ff0000', '#0000ff', '#0000ff', '#0000ff', '#0000ff'];
  const data = ART.buildChannels({ fixtures: 8, channelsPerFixture: 3, mode: 'palette', brightness: 1, startChannel: 1 },
    { level: 1, backgroundColors: colors });
  const fix = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  assert.ok(fix(0)[0] > 200 && fix(0)[2] === 0, 'ilk armatür kırmızı: ' + fix(0));
  assert.ok(fix(7)[2] > 200 && fix(7)[0] === 0, 'son armatür mavi: ' + fix(7));
});

// ---------------------------------------------------------------- arayüz

test('panel: MilkDrop seçimi önceki kaynağı saklıyor, geri dönüş onu getiriyor', () => {
  const P = bare(read('src/admin/milkdrop-panel.js'));
  assert.match(P, /P\(\)\.row\('Işık Renkleri', selOf\(\[/);
  assert.match(P, /if \(light\.paletteSource !== 'milkdrop'\) light\.paletteSourceSaved = light\.paletteSource \|\| 'background';\s*light\.paletteSource = 'milkdrop';/);
  assert.match(P, /light\.paletteSource = back && back !== 'milkdrop' \? back : 'background';/);
  assert.match(read('src/admin/lighting-general.js'), /\{ value: 'milkdrop', label: 'MilkDrop Görüntüsü \(Canlı\)' \}/);
});

test('yeni metinlerin İngilizcesi var', () => {
  const I = read('src/shared/i18n.js');
  const PANEL = read('src/admin/milkdrop-panel.js');
  for (const k of ['Işık Renkleri', 'Işık ayarındaki kaynak', 'MilkDrop görüntüsü (canlı)', 'MilkDrop Görüntüsü (Canlı)']) {
    assert.ok(I.includes("'" + k + "':"), k + ' sözlükte yok');
  }
  for (const start of ['MilkDrop görüntüsü seçiliyken', 'Işık çıkışı kapalı:']) {
    const m = new RegExp("text: '(" + start + "[^\\n]*?)',\\r?\\n").exec(PANEL);
    assert.ok(m, start + ' panelde yok');
    assert.ok(I.includes("'" + m[1] + "':"), start + ' notunun İngilizcesi yok ya da metin uyuşmuyor');
  }
});

/* Motorun WebGL2 bağlamı yerine kayıt tutan sahte bir bağlam: çit durumu
   testten sürülüyor, okunan piksel verisi `gpuColor`dan geliyor. */
function fakeGL(state) {
  const C = { TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, READ_FRAMEBUFFER: 3, READ_FRAMEBUFFER_BINDING: 4,
    PIXEL_PACK_BUFFER: 5, SYNC_STATUS: 6, SIGNALED: 7, UNSIGNALED: 8, RGB8: 9, RGBA: 10,
    UNSIGNED_BYTE: 11, COLOR_ATTACHMENT0: 12, STREAM_READ: 13, SYNC_GPU_COMMANDS_COMPLETE: 14 };
  const log = [];
  const bind = { tex: 'motor-doku', read: 'motor-fb', pack: null };
  const gl = Object.assign({}, C, {
    log, bind,
    isContextLost: () => false,
    getParameter: (p) => (p === C.TEXTURE_BINDING_2D ? bind.tex : p === C.READ_FRAMEBUFFER_BINDING ? bind.read : null),
    createTexture: () => ({ t: 'tex' }), createFramebuffer: () => ({ t: 'fbo' }), createBuffer: () => { log.push(['createBuffer']); return { t: 'pbo' }; }, deleteBuffer: () => log.push(['deleteBuffer']),
    bindTexture: (k, t) => { bind.tex = t; }, bindFramebuffer: (k, f) => { bind.read = f; },
    bindBuffer: (k, b) => { bind.pack = b; },
    texStorage2D: (...a) => log.push(['texStorage2D', ...a.slice(1)]),
    bufferData: (k, n) => log.push(['bufferData', n]),
    copyTexSubImage2D: (...a) => log.push(['copy', a[6], a[7], bind.read]),
    generateMipmap: () => log.push(['mip']),
    framebufferTexture2D: (...a) => log.push(['attach', a[4]]),
    readPixels: (x, y, w, h, fmt, type, off) => log.push(['readPixels', w, h, off, !!bind.pack]),
    fenceSync: () => { log.push(['fence']); return { s: 'sync' }; },
    flush: () => {},
    getSyncParameter: () => (state.signaled ? C.SIGNALED : C.UNSIGNALED),
    getBufferSubData: (k, off, out) => {
      log.push(['getBufferSubData', out.length]);
      for (let i = 0; i < out.length; i += 4) { out[i] = state.gpuColor[0]; out[i + 1] = state.gpuColor[1]; out[i + 2] = state.gpuColor[2]; out[i + 3] = 255; }
    },
    deleteSync: () => log.push(['deleteSync']),
  });
  return gl;
}

test('ışık rengi okuması bekletmiyor: çit geçilmeden veri alınmıyor (#621)', () => {
  /* 2B tuvalden eşzamanlı okuma GPU'nun karenin bütün işini bitirmesini
     bekliyordu (OpenRGB + MilkDrop kaynağında ana iş parçacığının ~%16'sı). */
  const { m, ops } = engineWith(() => [200, 0, 0]);
  const state = { signaled: false, gpuColor: [0, 0, 200] };
  const gl = fakeGL(state);
  m.gl = gl;
  m.gl2 = { width: 1920, height: 1080 };
  const cpuReads = () => ops.filter((o) => o[0] === 'read').length;
  const red = ['#ff0000', '#ff0000', '#ff0000', '#ff0000'];

  assert.deepStrictEqual(Array.from(m.sampleColors(4)), red, 'ilk çağrı eşzamanlı eski yoldan');
  assert.strictEqual(cpuReads(), 1);

  assert.deepStrictEqual(Array.from(m.sampleColors(4)), red, 'okuma başladı, eski renkler dönüyor');
  const rp = gl.log.find((l) => l[0] === 'readPixels');
  assert.ok(rp, 'GL okuması başlamalı');
  assert.deepStrictEqual(rp, ['readPixels', 120, 67, 0, true], '1080p: genişliği >= 64 olan mip seviyesi (4), tampona');
  assert.deepStrictEqual(gl.log.find((l) => l[0] === 'texStorage2D'), ['texStorage2D', 5, gl.RGB8, 1920, 1080], 'RGB doku, 5 seviye');
  assert.deepStrictEqual(gl.log.find((l) => l[0] === 'attach'), ['attach', 4]);
  assert.deepStrictEqual(gl.log.find((l) => l[0] === 'copy'), ['copy', 1920, 1080, null], 'kopya çizim tamponundan');
  assert.strictEqual(gl.bind.tex, 'motor-doku', 'doku bağı geri konmalı');
  assert.strictEqual(gl.bind.read, 'motor-fb', 'okuma çerçevesi bağı geri konmalı');
  assert.strictEqual(gl.bind.pack, null);

  assert.deepStrictEqual(Array.from(m.sampleColors(4)), red, 'çit geçilmedi: bekleme yok, eski renkler');
  assert.ok(!gl.log.some((l) => l[0] === 'getBufferSubData'), 'çit geçilmeden okunmamalı');
  assert.strictEqual(gl.log.filter((l) => l[0] === 'readPixels').length, 1, 'bekleyen varken yenisi başlamıyor');
  assert.strictEqual(cpuReads(), 1, 'eşzamanlı okumaya düşülmedi');

  state.signaled = true;
  assert.deepStrictEqual(Array.from(m.sampleColors(4)), ['#0000ff', '#0000ff', '#0000ff', '#0000ff'], 'çit geçince yeni renkler');
  assert.deepStrictEqual(gl.log.find((l) => l[0] === 'getBufferSubData'), ['getBufferSubData', 120 * 67 * 4]);
  // Eşik ve ağırlık 64x16'ya göre ayarlı: mip verisi aynı ızgaraya indiriliyor
  assert.deepStrictEqual([m._colorW, m._colorH, m._colorData.length], [64, 16, 64 * 16 * 4]);
  m.sampleColors(4);
  assert.strictEqual(gl.log.filter((l) => l[0] === 'readPixels').length, 2, 'okuma bitince yenisi başlıyor');
  /* Her okumaya yeni tampon, okununca siliniyor: aynı tampona yeniden yazmak
     Chromium'un performans uyarısını her okumada veriyordu (öz test onu hata
     sayıyor). */
  assert.strictEqual(gl.log.filter((l) => l[0] === 'createBuffer').length, 2, 'her okumaya yeni tampon');
  assert.strictEqual(gl.log.filter((l) => l[0] === 'deleteBuffer').length, 1, 'okunan tampon silindi');
});
