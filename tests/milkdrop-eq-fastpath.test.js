'use strict';
/* DENKLEMLERİN HIZLI YOLLARI (#621, genel hız).
 *
 * per_pixel ağın her düğümünde koşuyor; kullanıcının ağır bir presetinde
 * (64x48 ağ, düğüm başına üç pow/acos/sin/cos öbeği) kare başına ~10 ms
 * tutuyordu. Dört değişiklik, hiçbiri sonucu değiştirmeden:
 *   - kırpma kipinde bir basamak küçültme (toZero) tipli dizi yerine tek
 *     çarpmayla (altnormallerde eski yol);
 *   - `+ − ·` işlemlerinde düz değişken ve sayı işlenenleri ayrı kapanış
 *     çağrısı olmadan okunuyor;
 *   - sık işlevler (sin, cos, pow, min...) kendi çağrı noktalarında;
 *   - `pixel` düğüm başına ad aramıyor; deyimleri saran boşa kapanış yok.
 * Ölçüldü (node, en iyi koşular): o preset 9,5 → 6,6 ms, 200 korpus
 * presetinin ortalaması 1,05 → 0,63 ms. Korpusun 10.347 presetinde, uyum
 * açık ve kapalı, eski ve yeni motor bütün kare, düğüm, dalga ve şekil
 * çıktılarında BİT BİT aynı (depoya girmeyen karşılaştırma aracıyla).
 * Buradaki testler o eşitliğin kırılabileceği yerleri tek tek sınıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/milkdrop.js');

function run(src, pre, md2 = true) {
  M.resetGlobals();
  const pool = new M.Pool();
  const c = M.compile(src, pool, { mode: { md2 }, md2Funcs: md2 });
  for (const k in pre || {}) { const i = pool.id(k); pool.values[i] = pre[k]; }
  c.run(pool.values);
  return (k) => pool.get(k);
}

// ------------------------------------------------------------ toZero

test('bir basamak küçültme: çarpma yolu bit yoluyla her girdide aynı', () => {
  const { toZero, toZeroBits } = M._chop;
  const F = new Float64Array(1), U = new Uint32Array(F.buffer);
  const same = (a, b) => Object.is(a, b) || (a !== a && b !== b);
  const vals = [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE,
    2.2250738585072014e-308, 4.450147717014403e-308, 4.4501477170144023e-308, 4.450147717014404e-308, NaN];
  for (let e = -1074; e <= 1023; e++) {
    const p = 2 ** e;
    vals.push(p, -p, p * 1.5, p * (2 - 2 ** -52), -p * (1 + 2 ** -52));
  }
  // Tohumlu rastgele bit desenleri: bütün üs aralığı
  let s = 0x2545f491;
  const r32 = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  for (let i = 0; i < 200000; i++) { U[0] = r32(); U[1] = r32(); vals.push(F[0]); }
  let bad = 0;
  for (const v of vals) if (!same(toZero(v), toZeroBits(v))) bad++;
  assert.strictEqual(bad, 0);
});

test('kırpma sonucu değişmedi: 0,3·50 = 14,999999999999998, int 14', () => {
  const g = run('a = 0.3*50; b = int(0.3*50); c = x*50; d = int(x*50);', { x: 0.3 });
  assert.strictEqual(g('a'), 14.999999999999998);
  assert.strictEqual(g('b'), 14);
  assert.strictEqual(g('c'), 14.999999999999998);
  assert.strictEqual(g('d'), 14);
});

// ------------------------------------------------------------ yaprak işlenenler

test('yapraklı işlemler her biçimde doğru: değişken/sayı solda ve sağda', () => {
  const src = 'a = x*y; b = x*2; c = 2*x; d = x*(y+1); e = (y+1)*x; f = x+y; g = x-2; h = 2-x; i = (y+1)-x; j = x-(y+1);';
  for (const md2 of [true, false]) {
    const g = run(src, { x: 3, y: 5 }, md2);
    assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(g), [15, 6, 6, 18, 18, 8, 1, -1, 3, -3], md2 ? 'uyum' : 'eski');
  }
});

test('okuma sırası korunuyor: MilkDrop okuyuşunda sol değişken sağdan sonra', () => {
  // b*(b = 7): MilkDrop 49 (eelref); eski okuyuş önce okuyor, 3·7
  assert.strictEqual(run('r = b*(b = 7);', { b: 3 }, true)('r'), 49);
  assert.strictEqual(run('r = b*(b = 7);', { b: 3 }, false)('r'), 21);
  assert.strictEqual(run('r = b+(b = 7);', { b: 3 }, true)('r'), 14);
  assert.strictEqual(run('r = b+(b = 7);', { b: 3 }, false)('r'), 10);
  assert.strictEqual(run('r = b-(b = 7);', { b: 3 }, true)('r'), 0);
  assert.strictEqual(run('r = b-(b = 7);', { b: 3 }, false)('r'), -4);
  // Sağ değişken: sol ifade önce hesaplanıyor, iki okuyuşta da
  for (const md2 of [true, false]) assert.strictEqual(run('r = (b = 7)*b;', { b: 3 }, md2)('r'), 49);
});

test('reg değişkenleri yaprak yoluna girmiyor: uyum açıkken ortak dizide', () => {
  M.resetGlobals();
  const p1 = new M.Pool(), p2 = new M.Pool();
  const mode = { md2: true };
  M.compile('reg05 = 4;', p1, { mode, md2Funcs: true }).run(p1.values);
  const c = M.compile('r = reg05*2 + 1; s = 3 - reg05;', p2, { mode, md2Funcs: true });
  c.run(p2.values);
  assert.strictEqual(p2.get('r'), 9);
  assert.strictEqual(p2.get('s'), -1);
});

test('uyum anahtarı koşarken çevrilince yapraklı işlem de çevriliyor', () => {
  M.resetGlobals();
  const pool = new M.Pool();
  const mode = { md2: true };
  const c = M.compile('r += x*y;', pool, { mode, md2Funcs: true });
  pool.values[pool.id('x')] = 1e308;
  pool.values[pool.id('y')] = 10;
  c.run(pool.values);
  assert.strictEqual(pool.get('r'), Number.MAX_VALUE, 'kırpma kipinde taşma DBL_MAX');
  mode.md2 = false;
  pool.values[pool.id('r')] = 0;
  c.run(pool.values);
  assert.strictEqual(pool.get('r'), 0, 'eski yolda sonsuz sonlu tutuluyor');
});

// ------------------------------------------------------------ sık işlevler

test('sık işlevler iki kipte de kendi davranışında', () => {
  const src = 'a += min(0/0, 1); b += max(0/0, 1); c = sqrt(-4); d = sign(-2); e = pow(2, 10); f = above(0/0, 1); g = below(0/0, 1); h = acos(2); k = atan2(1, 1); m = abs(-3); n = int(-1.5); o = sqr(3); p = sin(0) + cos(0);';
  const md2 = run(src, {}, true);
  assert.ok(Number.isNaN(md2('a')), 'min(NaN, 1) NaN');
  assert.strictEqual(md2('b'), 1);
  assert.deepStrictEqual(['c', 'd', 'e', 'f', 'g', 'h', 'm', 'n', 'o', 'p'].map(md2), [2, -1, 1024, 1, 1, 0, 3, -2, 9, 1]);
  assert.strictEqual(md2('k'), Math.PI / 4);
  const old = run(src, {}, false);
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'm', 'n', 'o', 'p'].map(old), [0, 1, 2, -1, 1024, 0, 1, 0, 3, -2, 9, 1]);
});

// ------------------------------------------------------------ pixel

const SRC = [
  'MILKDROP_PRESET_VERSION=201',
  '[preset00]',
  'zoom=1.02', 'rot=0.01', 'warp=0.5', 'cx=0.5', 'cy=0.5', 'dx=0', 'dy=0', 'sx=1', 'sy=1',
  'per_frame_1=q1 = 0.25;',
  'per_pixel_1=zoom = zoom + 0.1*rad; dx = x - q1; dy = sin(ang)*0.01; rot = rot*y; sx = 1 + x*0; cx = cx + 0.1;',
].join('\n');

test('pixel her düğümde girdileri ve varsayılanları yazıyor, çıktıları okuyor', () => {
  for (const acc of [true, false]) {
    const p = new M.Preset(SRC, { seed: 1, accurate: acc });
    p.frame({ time: 1, frame: 60, fps: 60, bass: 1, mid: 1, treb: 1 });
    p.captureBase();
    const o = {};
    const a = Object.assign({}, p.pixel(0.2, 0.4, 0.5, 1, o));
    const b = Object.assign({}, p.pixel(0.8, 0.1, 0.25, -1, o));
    // Her düğüm tabandan başlıyor: ikinci düğüm birincinin yazdığını görmüyor
    assert.ok(Math.abs(a.zoom - (1.02 + 0.05)) < 1e-12, acc + ' zoom ' + a.zoom);
    assert.ok(Math.abs(b.zoom - (1.02 + 0.025)) < 1e-12, acc + ' zoom ' + b.zoom);
    assert.ok(Math.abs(a.dx - (0.2 - 0.25)) < 1e-12);
    assert.ok(Math.abs(b.dx - (0.8 - 0.25)) < 1e-12);
    assert.ok(Math.abs(a.rot - 0.004) < 1e-12 && Math.abs(b.rot - 0.001) < 1e-12);
    assert.ok(Math.abs(a.cx - 0.6) < 1e-12 && Math.abs(b.cx - 0.6) < 1e-12, 'cx tabandan: ' + b.cx);
    assert.strictEqual(a.sx, 1);
    assert.strictEqual(a.warp, 0.5);
  }
});

test('pixel uyum anahtarı çevrilince kendi havuzuna geçiyor', () => {
  const p = new M.Preset(SRC, { seed: 1, accurate: true });
  p.frame({ time: 1, frame: 60, fps: 60, bass: 1, mid: 1, treb: 1 });
  p.captureBase();
  const md2 = Object.assign({}, p.pixel(0.2, 0.4, 0.5, 1, {}));
  p.accurate = false;
  const old = Object.assign({}, p.pixel(0.2, 0.4, 0.5, 1, {}));
  p.accurate = true;
  const back = Object.assign({}, p.pixel(0.2, 0.4, 0.5, 1, {}));
  assert.deepStrictEqual(back, md2);
  assert.ok(Math.abs(old.dx - md2.dx) < 1e-12 && Math.abs(old.zoom - md2.zoom) < 1e-12);
});
