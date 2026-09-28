'use strict';
/* MILKDROP 2'NİN İFADE DERLEYİCİSİ (#580).
 *
 * Uyum açıkken denklemler MilkDrop 2'nin ifade derleyicisinin kurallarıyla
 * koşuyor. Kaynak Nullsoft'un ns-eel2'si (BeatDrop kopyası 53d83ee):
 *  - işleçlerin iç adları (nseel-compiler.c fnTable1, ad çevirisi
 *    nseel-eval.c): `_aboeq(a, b)` `a >= b`, `_and` kısa devreli `&&` …;
 *  - doğruluk ve eşitlik sınamalarında 0,00001'lik yakınlık payı
 *    (NSEEL_CLOSEFACTOR, ns-eel-int.h; asm-nseel-x86-msvc.c `fcomp
 *    closefact`): `if`, `!`, `&&`, `||`, `while`, `bnot` için |x| >= pay
 *    doğru, `band`/`bor` işlevlerinde |x| > pay; `==`/`equal` |a − b| < pay.
 * Uyum kapalıyken eski birebir sınamalar ve eski ad kümesi duruyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const M = require('../src/shared/milkdrop.js');
const S = require('../src/shared/milkdrop-sprites.js');
const ROOT = path.join(__dirname, '..');

// Kodu verilen kipte koşturur, havuzu döndürür
function run(src, md2, pre) {
  const pool = new M.Pool();
  for (const k in pre || {}) pool.set(k, pre[k]);
  const c = M.compile(src, pool, { mode: { md2 }, md2Funcs: md2 });
  c.run();
  return { pool, error: c.error, get: (k) => pool.get(k) };
}

test('iç adlar uyum açıkken işleçlerin kendisi, kapalıyken bilinmeyen işlev', () => {
  const src = [
    'a = _aboeq(3, 3); b = _aboeq(2, 3); c = _beleq(3, 3); d = _above(3, 3); e = _below(2, 3);',
    'f = _equal(2, 2); g = _noteq(2, 2); h = _not(0); i = _if(0, 5, 6); j = _mod(7, 3);',
  ].join('\n');
  const on = run(src, true);
  assert.strictEqual(on.error, '');
  assert.deepStrictEqual('abcdefghij'.split('').map(on.get), [1, 0, 1, 0, 1, 1, 0, 1, 6, 1]);
  const off = run(src, false);
  assert.match(off.error, /bilinmeyen fonksiyon '_aboeq'/);
  assert.strictEqual(off.get('a'), 0, 'kapalıyken deyim atlanıyor');
});

test('iç atama adları: _set, _addop … ilk argümana yazıyor', () => {
  const on = run('_set(a, 4); _addop(a, 2); _mulop(a, 3); _subop(a, 1); _divop(a, 17); _set(b, 7); _modop(b, 4); _set(c, 1); _orop(c, 6); _andop(c, 3); _set(d, 2); _powop(d, 10);', true);
  assert.strictEqual(on.error, '');
  assert.strictEqual(on.get('a'), 1);
  assert.strictEqual(on.get('b'), 3);
  assert.strictEqual(on.get('c'), 3);
  assert.strictEqual(on.get('d'), 1024);
  assert.match(run('_set(1, 2);', true).error, /bir değişken ve bir değer ister/);
});

test('_mem/_gmem megabuf/gmegabuf\'un iç adı: okunuyor ve yazılıyor', () => {
  const on = run('_mem(3) = 7; megabuf(4) = 8; a = _mem(3) + megabuf(4); _gmem(12345) = 2; b = gmegabuf(12345);', true);
  assert.strictEqual(on.error, '');
  assert.strictEqual(on.get('a'), 15);
  assert.strictEqual(on.get('b'), 2);
  assert.match(run('a = _mem(1, 2);', true).error, /1 argüman ister/);
});

test('iç adlar büyük/küçük harf ayırmıyor', () => {
  const on = run('a = _AboEq(2, 1); b = _IF(1, 3, 4);', true);
  assert.strictEqual(on.error, '');
  assert.strictEqual(on.get('a'), 1);
  assert.strictEqual(on.get('b'), 3);
});

test('_and/_or kısa devreli (&& ve ||); band/bor iki tarafı da hesaplıyor', () => {
  const on = run('a = _and(0, x = 5); b = _or(1, y = 5); c = band(0, z = 5); d = bor(1, w = 5);', true);
  assert.strictEqual(on.get('x'), 0, '_and sağ tarafı hesaplamamalı');
  assert.strictEqual(on.get('y'), 0, '_or sağ tarafı hesaplamamalı');
  assert.strictEqual(on.get('z'), 5, 'band iki tarafı da hesaplıyor');
  assert.strictEqual(on.get('w'), 5, 'bor iki tarafı da hesaplıyor');
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map(on.get), [0, 1, 0, 1]);
});

// ------------------------------------------------------------ yakınlık payı

const CLOSE = 0.00001;
const BELOW = 0.0000099;
const ABOVE = 0.0000101;

test('if, !, &&, ||, bnot: |x| >= 0,00001 doğru (sınır dahil)', () => {
  for (const [v, want] of [[CLOSE, 1], [-CLOSE, 1], [BELOW, 0], [-BELOW, 0], [ABOVE, 1], [0, 0]]) {
    const on = run('a = if(v, 1, 0); b = !v; c = v && 1; d = v || 0; e = bnot(v);', true, { v });
    assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e'].map(on.get), [want, 1 - want, want, want, 1 - want], 'v=' + v);
  }
});

test('band/bor işlevleri: |x| > 0,00001 doğru — sınırda && ve ||den farklı', () => {
  for (const [v, want] of [[CLOSE, 0], [-CLOSE, 0], [BELOW, 0], [ABOVE, 1], [-ABOVE, 1]]) {
    const on = run('a = band(v, 1); b = bor(v, 0);', true, { v });
    assert.deepStrictEqual([on.get('a'), on.get('b')], [want, want], 'v=' + v);
  }
});

test('==, !=, equal: |a − b| < 0,00001 eşit; <, >, above, below birebir', () => {
  const on = run('a = 0.3 + 0.6 == 0.9; b = equal(1, 1 + 0.0000099); c = equal(0.00001, 0); d = 1 != 1.0000099; e = 0.00001 != 0; f = above(1.0000001, 1); g = 1 < 1.0000001; h = _aboeq(1, 1.0000001);', true);
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(on.get), [1, 1, 0, 0, 1, 1, 1, 0]);
  const off = run('a = 0.3 + 0.6 == 0.9; b = equal(1, 1 + 0.0000099); d = 1 != 1.0000099;', false);
  assert.deepStrictEqual(['a', 'b', 'd'].map(off.get), [0, 0, 1], 'kapalıyken birebir');
});

test('while: son değer |x| < 0,00001 olunca duruyor', () => {
  // Sıra: 0,00001 (sınır, doğru) → 0,000005 → 0
  const src = 'n = 0; v = 3; while(n = n + 1; v = v - 1; v * 0.000005);';
  assert.strictEqual(run(src, true).get('n'), 2, '0,000005 yanlış');
  assert.strictEqual(run(src, false).get('n'), 3, 'kapalıyken tam sıfıra kadar');
});

test('NaN: x87 karşılaştırması sırasız — yanlış sayılıyor, NaN\'lı eşitlik doğru', () => {
  const nan = '(0 * (1e308 * 10))';
  const on = run(`a = if(${nan}, 1, 2); b = equal(${nan}, 3); c = !${nan};`, true);
  assert.deepStrictEqual(['a', 'b', 'c'].map(on.get), [2, 1, 1]);
  const off = run(`a = if(${nan}, 1, 2); b = equal(${nan}, 3); c = !${nan};`, false);
  assert.deepStrictEqual(['a', 'b', 'c'].map(off.get), [1, 0, 0]);
});

test('kip çalışma anında: aynı derleme mode.md2 çevrilince öbür sınamayı kullanıyor', () => {
  const pool = new M.Pool();
  const mode = { md2: false };
  const c = M.compile('a = if(0.000005, 1, 2); b = equal(1, 1.000005);', pool, { mode });
  c.run();
  assert.deepStrictEqual([pool.get('a'), pool.get('b')], [1, 0]);
  mode.md2 = true;
  c.run();
  assert.deepStrictEqual([pool.get('a'), pool.get('b')], [2, 1]);
  // Seçenek verilmezse eski davranış
  const p2 = new M.Pool();
  M.compile('a = if(0.000005, 1, 2); b = _aboeq(1, 0);', p2).run();
  assert.strictEqual(p2.get('a'), 1);
  assert.strictEqual(p2.get('b'), 0, 'iç ad yok');
});

// ------------------------------------------------------------ kalan

test('%: uyum açıkken iki tarafın mutlak değerinin tam kısmıyla, sonuç hiç negatif değil', () => {
  const src = 'a = -7 % 3; b = 7 % -3; c = -7 % -3; d = 7.9 % 3.9; e = 5 % 0.5 + 1; f = -7.5 % 2; x %= -4; h = _mod(-9, 4); megabuf(1) = -10; megabuf(1) %= 3; k = megabuf(1);';
  const on = run(src, true, { x: -10 });
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'f', 'x', 'h', 'k'].map(on.get), [1, 1, 1, 1, 1, 1, 2, 1, 1]);
  const off = run(src, false, { x: -10 });
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'f', 'x', 'k'].map(off.get), [-1, 1, -1, 1, 1, -1, -2, -1], 'kapalıyken işaretli');
});

test('%: 32 bite sığmayan değer MilkDrop\'ta 2^31 oluyor (x87 belirsiz tam sayısı, işaretsiz)', () => {
  const on = run('a = 3000000000 % 7; b = 7 % 3000000000; c = -3000000000 % 1000;', true);
  assert.deepStrictEqual(['a', 'b', 'c'].map(on.get), [2147483648 % 7, 7, 2147483648 % 1000]);
});

test('& ve |: uyum açıkken 64 bitlik tam sayılarla; 32 bite sığanda aynı', () => {
  const src = 'a = 3000000000 & 4294967295; b = 1099511627776 | 1; c = 5.9 & 3; d = -1 & 255; e = -7.5 | 0; z = 1e30 & 1; w = 1e30 | 0; v = -3000000000.5 & -1;';
  const on = run(src + ' _andop(x, 6); _orop(y, 4294967296);', true, { x: 13, y: 1 });
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'z', 'x', 'y'].map(on.get), [3000000000, 1099511627777, 1, 255, -7, 0, 4, 4294967297]);
  assert.strictEqual(on.get('w'), -9223372036854775808, 'sığmayan 64 bit −2^63');
  assert.strictEqual(on.get('v'), -3000000000, 'sıfıra doğru kırpma');
  const off = run(src, false);
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e'].map(off.get), [-1294967296, 1, 1, 255, -7], 'kapalıyken 32 bit');
});

// ------------------------------------------------------------ bellek

test('megabuf indisi uyum açıkken trunc(x + 0,00001): 2,99999999 3. göz, −1 0. göz', () => {
  const src = 'megabuf(2.99999999) = 5; a = megabuf(3); megabuf(-1) = 7; b = megabuf(0); megabuf(1.99999999) += 2; c = megabuf(2); d = megabuf(-1.5);';
  const on = run(src, true);
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map(on.get), [5, 7, 2, 0]);
  const off = run(src, false);
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map(off.get), [0, 0, 5, 0], 'kapalıyken |0: 2,99999999 → 2, −1 atılıyor, 1,99999999 → 1');
  assert.strictEqual(off.pool.mem.get(2, 1048576), 5, 'kapalıyken 2,99999999 → 2. göz');
});

test('megabuf uyum açıkken 8.388.608 girdi, kapalıyken 1.048.576; dışı 0 ve yazılan atılıyor', () => {
  const src = 'megabuf(5000000) = 9; a = megabuf(5000000); b = (megabuf(8388608) = 4); c = megabuf(8388608); megabuf(8388607) = 3; d = megabuf(8388607); megabuf(6000000) = 1; megabuf(6000000) += 2; e = megabuf(6000000);';
  const on = run(src, true);
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e'].map(on.get), [9, 4, 0, 3, 3], 'atama değerini yine döndürüyor');
  const off = run(src, false);
  assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e'].map(off.get), [0, 4, 0, 0, 0]);
});

test('gmegabuf uyum açıkken 2^20\'de sarıyor (negatif de); presetler arasında ortak', () => {
  const on = run('gmegabuf(1048576 + 777001) = 4; a = gmegabuf(777001); gmegabuf(-2) = 6; b = gmegabuf(1048575); c = gmegabuf(-2); gmegabuf(777003) = 8; e = gmegabuf(777003 - 524288);', true);
  assert.deepStrictEqual(['a', 'b', 'c', 'e'].map(on.get), [4, 6, 6, 0], 'sarma 2^20 girdide, 2^19 girdide değil');
  const other = run('d = gmegabuf(777001);', true);
  assert.strictEqual(other.get('d'), 4, 'başka havuz aynı gmegabuf\'u görüyor');
  const off = run('gmegabuf(1048576 + 777002) = 4; a = gmegabuf(777002); gmegabuf(-3) = 6; b = gmegabuf(1048574);', false);
  assert.deepStrictEqual(['a', 'b'].map(off.get), [0, 0], 'kapalıyken sarmıyor, negatif atılıyor');
});

// ------------------------------------------------------------ rand

test('rand(n) uyum açıkken 0 ile max(1, floor(n)) arasında ONDALIKLI; kapalıyken 0..n−1 tam sayı', () => {
  const pool = new M.Pool();
  const mode = { md2: true };
  const c = M.compile('a = rand(4); b = rand(0.5); d = rand(-3); e = rand(4.9);', pool, { mode, seed: 7 });
  let frac = 0, minA = 99, maxA = 0, maxB = 0, maxD = 0, maxE = 0;
  for (let i = 0; i < 2000; i++) {
    c.run();
    const a = pool.get('a');
    if (a !== Math.floor(a)) frac++;
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    maxB = Math.max(maxB, pool.get('b')); maxD = Math.max(maxD, pool.get('d')); maxE = Math.max(maxE, pool.get('e'));
  }
  assert.ok(frac > 1990, 'ondalıklı: ' + frac);
  assert.ok(minA >= 0 && maxA <= 4 && maxA > 3.9, 'aralık 0..4: ' + minA + '..' + maxA);
  assert.ok(maxB <= 1 && maxB > 0.9, 'n < 1 → 1: ' + maxB);
  assert.ok(maxD <= 1 && maxD > 0.9, 'negatif → 1: ' + maxD);
  assert.ok(maxE <= 4 && maxE > 3.9, 'floor(4,9) = 4: ' + maxE);
  mode.md2 = false;
  let ints = true, maxL = 0;
  for (let i = 0; i < 2000; i++) {
    c.run();
    const a = pool.get('a');
    if (a !== Math.floor(a)) ints = false;
    maxL = Math.max(maxL, a);
  }
  assert.ok(ints && maxL === 3, 'kapalıyken 0..3 tam sayı');
});

test('rand: aynı tohum aynı sayılar; iki kip aynı üreteci ilerletiyor', () => {
  const seq = (md2) => {
    const p = new M.Pool();
    const c = M.compile('a = rand(10);', p, { mode: { md2 }, seed: 99 });
    const out = [];
    for (let i = 0; i < 5; i++) { c.run(); out.push(p.get('a')); }
    return out;
  };
  const on = seq(true);
  assert.deepStrictEqual(seq(true), on, 'tekrarlanabilir');
  assert.deepStrictEqual(on.map(Math.floor), seq(false), 'kapalıyken aynı sayının tam kısmı');
});

// ------------------------------------------------------------ preset bağlantısı

const PRESET = [
  'MILKDROP_PRESET_VERSION=201',
  'per_frame_1=q1 = if(0.000005, 1, 2);',
  'per_frame_2=q2 = _aboeq(2, 1);',
  'wavecode_0_enabled=1',
  'wave_0_per_frame1=t1 = equal(1, 1.000005);',
  'shapecode_0_enabled=1',
  'shape_0_per_frame1=x = if(0.000005, 0.1, 0.9);',
  '',
].join('\n');

test('Preset: anahtar bütün blokların ortak kipini çeviriyor (dalga ve şekil dahil)', () => {
  const p = new M.Preset(PRESET, { seed: 1, accurate: true });
  p.frame({ time: 0, frame: 0 });
  assert.deepStrictEqual([p.get('q1'), p.get('q2')], [2, 1]);
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.waves[0].pool.get('t1'), 1);
  assert.strictEqual(p.shapeFrame(p.shapes[0], 0).x, 0.9);

  p.accurate = false;
  p.frame({ time: 0, frame: 1 });
  assert.strictEqual(p.get('q1'), 1, 'kapalıyken birebir: 0,000005 doğru');
  p.waveFrame(p.waves[0]);
  assert.strictEqual(p.waves[0].pool.get('t1'), 0);
  assert.strictEqual(p.shapeFrame(p.shapes[0], 0).x, 0.1);
  assert.strictEqual(p.accurate, false);
  p.accurate = undefined;
  assert.strictEqual(p.accurate, true, 'false dışındaki her değer açık');
});

test('Preset: iç adlar okuyuşla birlikte kuruluşta kararlaştırılıyor', () => {
  const off = new M.Preset(PRESET, { seed: 1, accurate: false });
  off.frame({ time: 0, frame: 0 });
  assert.strictEqual(off.get('q2'), 0, 'kapalı kurulan preset iç adı tanımıyor');
  assert.ok(off.errors.some((e) => /_aboeq/.test(e)));
  off.accurate = true;
  off.frame({ time: 0, frame: 1 });
  assert.strictEqual(off.get('q2'), 0, 'yeniden kurulmadan iç ad derlenmiyor — görselleştirici yeniden kuruyor');
});

test('readingsDiffer: kod iç ad kullanıyorsa anahtar çevrilince preset yeniden kuruluyor', () => {
  assert.strictEqual(M.readingsDiffer('MILKDROP_PRESET_VERSION=201\nper_frame_1=a = above(2, 1);\n'), false);
  assert.strictEqual(M.readingsDiffer('MILKDROP_PRESET_VERSION=201\nper_frame_1=a = _aboeq(2, 1);\n'), true);
  assert.strictEqual(M.readingsDiffer('MILKDROP_PRESET_VERSION=201\nwave_0_per_point1=a = _ABOEQ (2, 1);\n'), true, 'harf ve boşluk');
  assert.strictEqual(M.readingsDiffer('MILKDROP_PRESET_VERSION=201\nper_frame_1=my_aboeq = 1; b = my_aboeq(2);\n'), false, 'adın parçası değil');
});

test('sprite kodu da MilkDrop kurallarıyla: anahtar setAccurate ile', () => {
  const def = { num: '01', img: 'a.png', colorkey: 0, init: 'k1 = if(0.000005, 1, 2); k2 = _aboeq(1, 0);', code: 'k3 = equal(1, 1.000005);', desc: '' };
  const set = new S.SpriteSet(M);
  set.launch(def, { seed: 1 });
  const P = set.slots[0].pool;
  assert.deepStrictEqual([P.get('k1'), P.get('k2')], [2, 1]);
  set.step({ time: 0, frame: 0 });
  assert.strictEqual(P.get('k3'), 1);
  set.setAccurate(false);
  set.step({ time: 0, frame: 1 });
  assert.strictEqual(P.get('k3'), 0, 'kapalıyken birebir');
  set.launch(def, { seed: 1 });
  const P2 = set.slots[1].pool;
  assert.deepStrictEqual([P2.get('k1'), P2.get('k2')], [1, 0], 'kapalıyken başlatılan iç adı tanımıyor');
});

test('görselleştirici sprite setine anahtarı başlatmadan ve her kareden önce veriyor', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/visualizer/modes/milkdrop.js'), 'utf8');
  const set = 'this.sprites.setAccurate(this._wantAcc !== false);';
  const i = src.indexOf(set);
  assert.ok(i > 0 && i < src.indexOf('this.sprites.launch('), 'başlatmadan önce');
  const j = src.indexOf(set, i + 1);
  assert.ok(j > 0 && j < src.indexOf('this.sprites.step('), 'kareden önce');
});

/* İfade derleyicisini çağıran her yer kipini AÇIKÇA veriyor. Verilmeyen bir
   yer uyum açıkken bile eski sınamalarla koşardı ve bu hiçbir yerde
   görünmezdi. */
// Açılan parantezin kapandığı yere kadar (dize içindeki parantezler sayılmıyor)
function callArgs(src, from) {
  let depth = 1;
  let q = null;
  let i = from;
  for (; i < src.length && depth > 0; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  return src.slice(from, i - 1);
}

test('kaynakta her ifade derlemesi kipini veriyor', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  let found = 0;
  for (const file of walk(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    const isEngine = file.endsWith(path.join('shared', 'milkdrop.js'));
    // Motorun kendi içinde `compile(`, dışarıda SVMilkdrop api'si üzerinden `M.compile(`
    const re = isEngine ? /(?<![.\w])(?<!function )compile\(/g : /\b[Mm]\.compile\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      found++;
      const args = callArgs(src, m.index + m[0].length);
      assert.match(args, /\beel\b|mode:/, path.relative(ROOT, file) + ': ' + m[0] + args.slice(0, 90));
    }
  }
  assert.strictEqual(found, 12, 'derleme çağrısı sayısı (motor 9, sprite 2, öz test 1)');
});
