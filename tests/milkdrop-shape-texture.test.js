'use strict';
/* DOKULU ŞEKLİN ÖRNEKLEME PENCERESİ (#560).
 *
 * MilkDrop şeklin köşelerini kendi açısıyla (`ang`) yerleştiriyor ama
 * dokudan okuduğu pencereyi o açıyla DÖNDÜRMÜYOR (milkdropfs.cpp:2198-2200):
 *   tu = 0,5 + 0,5·cos(t·2π + tex_ang + π/4) / tex_zoom · aspectY
 *   tv = 0,5 + 0,5·sin(t·2π + tex_ang + π/4) / tex_zoom
 * Motor `ang`i doku açısına da ekliyordu (şekil dönünce görüntü de dönüyordu)
 * ve X'teki en-boy düzeltmesi hiç yoktu. Korpusun %64,1'i dokulu şekil
 * çiziyor; 3.388 preset (%32,8) sıfırdan farklı bir açı kullanıyor.
 *
 * Test motorun kendi `_drawShapes` gövdesini sahte bir `this` ile koşturuyor
 * ve tepe tamponuna yazılan doku koordinatlarını okuyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'src/visualizer/modes/milkdrop.js'), 'utf-8');
const MD = require('../src/shared/milkdrop.js');

function method(sig) {
  const i = SRC.indexOf('    ' + sig + ' {');
  assert.ok(i > 0, sig + ' bulunamadı');
  const end = SRC.indexOf('\n    }', i);
  return SRC.slice(i, end + 6);
}
const body = (src) => src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));

const glStub = new Proxy({}, {
  get(_, k) {
    if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
    return () => {};
  },
});

/* Tek, dokulu bir şekil çizdirir ve tepe tamponunu döndürür. */
function drawShape(opts) {
  const fn = new Function('gl', 'GW', 'GH', 'preset', 'am', 'window',
    body(method('_drawShapes(gl, GW, GH, preset, am)')));
  const vals = Object.assign({
    x: 0.5, y: 0.5, rad: 0.3, ang: 0, tex_ang: 0, tex_zoom: 1,
    r: 1, g: 1, b: 1, a: 1, r2: 1, g2: 1, b2: 1, a2: 1,
    border_a: 0, border_r: 1, border_g: 1, border_b: 1, thick: 0,
  }, opts.vals || {});
  const shape = { enabled: true, instances: 1, sides: opts.sides || 4, textured: true, additive: false };
  const preset = { shapes: [shape], shapeFrame: (s, inst, out) => Object.assign(out || {}, vals) };
  const self = {
    _wantAcc: opts.acc !== false,
    lineData: new Float32Array(4096 * 6),
    shapeTexData: new Float32Array(512 * 8),
    // tek satırlık yöntem: gövdesi kaynaktan sökülüyor
    _toClipY: new Function('y', /_toClipY\(y\) \{([^}]*)\}/.exec(SRC)[1]),
    _blend() {}, _strip() {},
    lineProg: 1, lineVao: 1, lineVbo: 1,
    shapeTexProg: 2, shapeTexVao: 2, shapeTexVbo: 2,
    locShapeTexSrc: 0, _shapeSrcTex: 0,
  };
  fn.call(self, glStub, opts.GW || 1920, opts.GH || 1080, preset, 1, { SVMilkdrop: MD });
  return self.shapeTexData;
}

// i. kenar noktasının doku koordinatı (0 merkez, 1'den itibaren kenar)
const uv = (td, i) => [td[(i + 1) * 8 + 6], td[(i + 1) * 8 + 7]];
const xy = (td, i) => [td[(i + 1) * 8], td[(i + 1) * 8 + 1]];
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg + ': ' + a + ' / ' + b);

test('doku penceresi şeklin açısıyla dönmüyor', () => {
  const sides = 4;
  const a = drawShape({ sides, vals: { ang: 0 } });
  const b = drawShape({ sides, vals: { ang: 1.1 } });
  for (let i = 0; i <= sides; i++) {
    const [u0, v0] = uv(a, i), [u1, v1] = uv(b, i);
    close(u1, u0, 'u' + i);
    close(v1, v0, 'v' + i);
  }
  // Köşeler ise gerçekten döndü
  assert.ok(Math.abs(xy(a, 0)[0] - xy(b, 0)[0]) > 0.01, 'köşeler dönmeliydi');
});

test('doku koordinatı MilkDrop\'un formülünü veriyor', () => {
  const sides = 5, GW = 1920, GH = 1080;
  const aspY = GH / GW;
  const texAng = 0.7, texZoom = 1.4;
  const td = drawShape({ sides, GW, GH, vals: { ang: 0.9, tex_ang: texAng, tex_zoom: texZoom } });
  for (const i of [0, 2, sides]) {
    const t = (i / sides) * Math.PI * 2 + texAng + Math.PI * 0.25;
    const [u, v] = uv(td, i);
    close(u, 0.5 + 0.5 * Math.cos(t) / texZoom * aspY, 'u' + i);
    // v ekseni bizde yukarı: MilkDrop'un aşağı artan tv'si burada aynalı
    close(v, 0.5 - 0.5 * Math.sin(t) / texZoom, 'v' + i);
  }
});

test('uyum kapalıyken eski pencere duruyor', () => {
  const sides = 4, GW = 1920, GH = 1080;
  const td = drawShape({ sides, GW, GH, acc: false, vals: { ang: 0.9, tex_ang: 0.2 } });
  for (const i of [0, 3]) {
    const t = 0.9 + Math.PI * 0.25 + (i / sides) * Math.PI * 2 + 0.2;
    const [u, v] = uv(td, i);
    close(u, 0.5 + 0.5 * Math.cos(t), 'eski u' + i);   // en-boy düzeltmesi yok
    close(v, 0.5 - 0.5 * Math.sin(t), 'eski v' + i);
  }
});

test('köşe konumları iki yolda da aynı', () => {
  const sides = 6, GW = 1280, GH = 720;
  const a = drawShape({ sides, GW, GH, vals: { ang: 0.4 } });
  const b = drawShape({ sides, GW, GH, acc: false, vals: { ang: 0.4 } });
  for (let i = 0; i <= sides; i++) {
    close(xy(a, i)[0], xy(b, i)[0], 'x' + i);
    close(xy(a, i)[1], xy(b, i)[1], 'y' + i);
  }
  // ve yarıçap X'te en-boyla ölçekli, Y'de değil (milkdropfs.cpp:2195-2196)
  const [x0, y0] = xy(a, 0);
  close(x0, 0 + Math.cos(0.4 + Math.PI * 0.25) * 0.3 * (GH / GW), 'x yarıçapı');
  close(y0, 0 + Math.sin(0.4 + Math.PI * 0.25) * 0.3, 'y yarıçapı');
});
