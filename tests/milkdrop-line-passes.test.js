'use strict';
/* ÇİZGİ GEÇİŞLERİ VE NOKTA BOYU (#580).
 *
 * MilkDrop 2 kalın çizgiyi dört kez çiziyor, her seferinde bir öncekinin
 * üstüne bir teksel kaydırarak (x, sonra y, sonra x geri: 2x2'lik blok).
 * Kaç geçiş olduğu çizime göre değişiyor:
 *   - yerleşik dalga: kalın YA DA nokta kipinde, tampon ≥ 512 ise 4
 *     (milkdropfs.cpp:3259), nokta boyu 1;
 *   - özel dalga: kalın ve nokta DEĞİLSE 4; nokta boyu tampon ≥ 1024 ise 2,
 *     değilse 1, kalınsa +1 (milkdropfs.cpp:2650-2654);
 *   - şekil kenarlığı: kalınsa 4 (milkdropfs.cpp:2371);
 *   - hareket vektörleri: tek LINELIST (milkdropfs.cpp:1301).
 * Referans çizicide (BeatDrop'tan derlenen MilkDrop 2) nokta kipindeki
 * dalga bizde hiç görünmüyordu: LINE_VERT `gl_PointSize` yazmıyordu ve
 * WebGL'de yazılmayan nokta boyu tanımsız. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf8').replace(/\r\n/g, '\n');

test('LINE_VERT nokta boyunu yazıyor, alt sınır 1', () => {
  const m = /const LINE_VERT = `([\s\S]*?)`;/.exec(SRC);
  assert.ok(m, 'LINE_VERT bulunamadı');
  assert.match(m[1], /uniform float uPointSize;/);
  assert.match(m[1], /gl_PointSize = max\(1\.0, uPointSize\);/);
  assert.match(SRC, /this\.locLine = \{ uPointSize: gl\.getUniformLocation\(line\.prog, 'uPointSize'\) \};/);
});

/* `_mdPasses` sayılarla koşturuluyor: geçişlerin konumu ve `d`nin geri
   alınması. */
function passes() {
  const m = /_mdPasses\(gl, d, n, its, GW, GH, draw\) \{([\s\S]*?)\n    \}/.exec(SRC);
  assert.ok(m, '_mdPasses bulunamadı');
  return new Function('gl', 'd', 'n', 'its', 'GW', 'GH', 'draw', m[1]);
}
const fakeGl = { ARRAY_BUFFER: 1, bufferSubData() {} };

test('dört geçiş: 2x2 blok, her biri bir teksel (MilkDrop\'un sırası)', () => {
  const run = passes();
  const d = new Float32Array([0.25, -0.5, 1, 1, 1, 1, 0.75, 0.5, 1, 1, 1, 1]);
  const seen = [];
  run(fakeGl, d, 2, 4, 400, 200, () => seen.push([d[0] - 0.25, d[1] + 0.5]));
  const ix = 2 / 400, iy = 2 / 200;
  const want = [[0, 0], [ix, 0], [ix, iy], [0, iy]];
  assert.strictEqual(seen.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(seen[i][0] - want[i][0]) < 1e-6 && Math.abs(seen[i][1] - want[i][1]) < 1e-6,
      i + '. geçiş ' + seen[i] + ' ≠ ' + want[i]);
  }
  assert.ok(Math.abs(d[0] - 0.25) < 1e-6 && Math.abs(d[1] + 0.5) < 1e-6, 'd geri alınmadı');
  assert.ok(Math.abs(d[6] - 0.75) < 1e-6 && Math.abs(d[7] - 0.5) < 1e-6, 'ikinci nokta geri alınmadı');
});

test('tek geçiş: kaydırma yok, tek çizim', () => {
  const run = passes();
  const d = new Float32Array([0.1, 0.2, 1, 1, 1, 1]);
  let k = 0;
  run(fakeGl, d, 1, 1, 400, 200, () => k++);
  assert.strictEqual(k, 1);
  assert.strictEqual(d[0], Math.fround(0.1));
});

function strip() {
  const at = SRC.indexOf('_strip(gl, kind, d, n, breakAt, GW, GH, thickMul, md) {');
  assert.ok(at > 0, '_strip bulunamadı');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at));
}

test('noktalar HER biçimde MilkDrop\'un kuralıyla, AA yolundan önce değil', () => {
  const fn = strip();
  const pts = fn.indexOf('if (kind === gl.POINTS) {');
  assert.ok(pts > fn.indexOf('const draw ='), 'nokta yolu draw tanımından sonra');
  const body = fn.slice(pts, fn.indexOf('return;', pts));
  assert.match(body, /gl\.uniform1f\(this\.locLine\.uPointSize, \(md && md\.pt\) \|\| 1\);/);
  assert.match(body, /this\._mdPasses\(gl, d, n, its, GW, GH, draw\);/);
});

test('çizgiler yalnız milkdrop biçiminde MilkDrop\'un geçişleriyle', () => {
  const fn = strip();
  assert.match(fn, /if \(this\._lineStyle === 'milkdrop' && md\) \{\s*this\._mdPasses\(gl, d, n, its, GW, GH, draw\);\s*return;\s*\}/);
  // Öteki biçimler AA yoluna gidiyor, milkdrop biçimi gitmiyor
  assert.match(fn, /const aa = this\._lineStyle !== 'milkdrop' && this\.aaProg;/);
});

test('çağıranların planı MilkDrop\'un kuralı', () => {
  // Yerleşik dalga
  assert.match(SRC, /its: \(\(thickW \|\| !!P\.get\('wave_usedots'\)\) && GW >= 512\) \? 4 : 1,\s*pt: 1,/);
  // Özel dalga
  assert.match(SRC, /its: \(w\.thick && !w\.useDots\) \? 4 : 1,\s*pt: \(gw >= 1024 \? 2 : 1\) \+ \(w\.thick \? 1 : 0\),/);
  // Şekil kenarlığı ve hareket vektörleri
  assert.match(SRC, /GW, GH, o\.thick \? 2 : 1,\s*\{ its: o\.thick \? 4 : 1 \}\);/);
  assert.match(SRC, /this\._strip\(gl, gl\.LINES, d, count, -1, GW, GH, 1, \{ its: 1 \}\);/);
});

/* Özel dalganın noktası en-boyun tersiyle çarpılıyor (milkdropfs.cpp:
   2612-2613): geniş ekranda y, W/H kadar uzuyor. Uyum kapalıyken çarpan 1. */
test('özel dalga: nokta en-boyun tersiyle (MilkDrop\'un m_fInvAspect\'i)', () => {
  assert.match(SRC, /const invX = acc \? 1 \/ \(this\._aspX \|\| 1\) : 1;/);
  assert.match(SRC, /const invY = acc \? 1 \/ \(this\._aspY \|\| 1\) : 1;/);
  assert.match(SRC, /d\[k\] = \(x \* 2 - 1\) \* invX;\s*d\[k \+ 1\] = this\._toClipY\(y\) \* invY;/);
});
