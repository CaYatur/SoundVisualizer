'use strict';
/* İçe aktarma yollarının dayanıklılık testleri.
 *
 * Preset, paket, shader, .milk ve söz dosyaları KULLANICIDAN gelir ve
 * uygulamanın en az güvenilir girdisidir: internetten indirilmiş, başka bir
 * programın ürettiği, yarım kalmış ya da bozulmuş olabilir.
 *
 * Ölçüt üç maddede toplanıyor:
 *   1. Hiçbir girdi ÇÖKMEYE yol açmamalı — bozuk bir dosya uygulamayı
 *      kapatmamalı, kullanıcıya hata olarak dönmeli.
 *   2. Hiçbir girdi kod ÇALIŞTIRMAMALI — dosya içeriği veri olarak kalmalı.
 *   3. Sonuç her zaman beklenen ŞEKİLDE olmalı; yarım bir nesne dönmemeli. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/presets.js');
const PR = global.window.SVPresets;
const M = require('../src/shared/milkdrop.js');
const LY = require('../src/shared/lyrics.js');

/* Kötü niyetli ya da bozuk girdi örnekleri. Aralarında JSON'a benzeyen ama
   olmayanlar, çok derin iç içe yapılar, kod enjeksiyonu denemeleri ve ikili
   çöp var. */
const NASTY = [
  null, undefined, 0, 1, -1, NaN, Infinity, '', ' ', 'null', 'undefined',
  '{}', '[]', '[[[[', '}{', '\x00\x01\x02', '￿￾',
  'a'.repeat(100000),
  '<script>alert(1)</script>',
  '"; process.exit(1); //',
  '${process.exit(1)}',
  '\\u0000',
  { }, { format: 'yanlış' }, { format: 'svpreset' }, { presets: 'dizi değil' },
  { format: 'svpack', presets: null },
  { format: 'svpack', presets: [null, undefined, 0, 'x', {}] },
  { __proto__: { polluted: true } },
  { constructor: { prototype: { polluted: true } } },
  [], [1, 2, 3], [{ }],
  () => {},
];

// Çok derin iç içe nesne (yığın taşması denemesi)
function deepObject(depth) {
  let o = { format: 'svpreset', name: 'derin' };
  let cur = o;
  for (let i = 0; i < depth; i++) { cur.next = {}; cur = cur.next; }
  return o;
}

// ===========================================================================
test('readImported: hiçbir bozuk girdi çökmez ve sonuç şekli tutarlı', () => {
  for (const bad of NASTY.concat([deepObject(2000)])) {
    let r;
    assert.doesNotThrow(() => { r = PR.readImported(bad); }, 'girdi çöktü: ' + brief(bad));
    assert.ok(r && typeof r === 'object', 'sonuç nesne değil: ' + brief(bad));
    assert.strictEqual(typeof r.ok, 'boolean', 'ok alanı yok: ' + brief(bad));
    if (r.ok) {
      assert.ok(Array.isArray(r.presets), 'ok=true ama preset listesi yok: ' + brief(bad));
      for (const p of r.presets) {
        assert.ok(p && p.id, 'kimliksiz preset');
        assert.ok(typeof p.name === 'string', 'adsız preset');
      }
    } else {
      assert.ok(typeof r.error === 'string' && r.error, 'hata metni yok: ' + brief(bad));
    }
  }
});

test('readImported: prototip kirliliği yapmaz', () => {
  PR.readImported(JSON.parse('{"format":"svpack","presets":[{"__proto__":{"kirli":true}}]}'));
  assert.strictEqual({}.kirli, undefined, 'Object.prototype kirlendi');
  PR.readImported({ format: 'svpack', presets: [{ constructor: { prototype: { kirli2: true } } }] });
  assert.strictEqual({}.kirli2, undefined, 'Object.prototype kirlendi (constructor yolu)');
});

test('readImported: içe aktarılan preset yerleşik sayılmaz', () => {
  const r = PR.readImported({
    format: 'svpack',
    presets: [{ name: 'sahte', engine: 'shader', builtin: true, id: 'sh_plasma' }],
  });
  assert.ok(r.ok);
  for (const p of r.presets) {
    assert.notStrictEqual(p.builtin, true, 'içe aktarılan preset yerleşik olarak işaretlendi');
    assert.notStrictEqual(p.id, 'sh_plasma', 'yerleşik kimliği ele geçirildi');
  }
});

test('normalize: her preset tam ve geçerli döner', () => {
  for (const bad of NASTY) {
    let p;
    assert.doesNotThrow(() => { p = PR.normalize(bad); }, 'normalize çöktü: ' + brief(bad));
    assert.ok(p && typeof p === 'object', 'normalize nesne döndürmedi');
    assert.ok(typeof p.name === 'string');
    assert.ok(p.engine === 'shader' || p.engine === 'variation', 'geçersiz motor: ' + p.engine);
  }
});

// ===========================================================================
test('shader dönüştürücüleri bozuk girdide çökmez', () => {
  for (const bad of NASTY) {
    if (typeof bad === 'function') continue;
    assert.doesNotThrow(() => PR.fromShadertoy(bad, 'x'), 'fromShadertoy: ' + brief(bad));
    assert.doesNotThrow(() => PR.fromISF(bad, 'x'), 'fromISF: ' + brief(bad));
    assert.doesNotThrow(() => PR.fromMilk(bad, 'x'), 'fromMilk: ' + brief(bad));
  }
});

test('ISF dönüştürücüsü bozuk JSON başlığında çökmez', () => {
  const cases = [
    '/*{ bozuk json }*/\nvoid main(){}',
    '/*{"INPUTS": "dizi değil"}*/\nvoid main(){}',
    '/*{"INPUTS":[{"TYPE":"bilinmeyen"}]}*/\nvoid main(){}',
    '/*{*/',
    '/*{"PASSES":[{"TARGET":1}]}*/',
  ];
  for (const src of cases) {
    assert.doesNotThrow(() => {
      const r = PR.fromISF(src, 'test');
      // Dönüş { ok, notes, preset } biçiminde; başarısızlıkta { ok:false, error }
      assert.ok(r && typeof r === 'object', 'nesne dönmedi');
      assert.strictEqual(typeof r.ok, 'boolean', 'ok alanı yok');
      if (r.ok) assert.ok(r.preset && typeof r.preset.name === 'string', 'adsız preset döndü');
      else assert.ok(typeof r.error === 'string' && r.error, 'hata metni yok');
    }, src.slice(0, 30));
  }
});

// ===========================================================================
test('MilkDrop ayrıştırıcısı bozuk dosyada çökmez', () => {
  for (const bad of NASTY) {
    if (typeof bad === 'object' && bad !== null) continue;
    if (typeof bad === 'function') continue;
    assert.doesNotThrow(() => {
      const f = M.parseMilk(bad);
      assert.ok(f && typeof f.params === 'object');
      const p = new M.Preset(bad);
      p.frame({ bass: 1 });
      p.captureBase();
      p.pixel(0.5, 0.5, 0.5, 1);
    }, 'girdi: ' + brief(bad));
  }
});

test('MilkDrop: kod enjeksiyonu denemesi ÇALIŞMAZ', () => {
  /* Üretilen JS'e preset metninden hiçbir şey kopyalanmadığı için bir preset
     JavaScript sokamaz. Bu testin başarısız olması güvenlik açığı demektir. */
  global.__SIZDI__ = false;
  const attempts = [
    'per_frame_1=x = 1); global.__SIZDI__ = true; (1',
    'per_frame_1=x = eval("global.__SIZDI__=true")',
    'per_frame_1=global.__SIZDI__ = 1',
    'per_frame_1=constructor.constructor("global.__SIZDI__=true")()',
    'per_frame_1=x = `${global.__SIZDI__=true}`',
  ];
  for (const src of attempts) {
    const p = new M.Preset(src);
    p.frame({ bass: 1 });
    assert.strictEqual(global.__SIZDI__, false, 'kod çalıştı: ' + src);
  }
});

test('MilkDrop: çok büyük dosya makul sürede biter', () => {
  const lines = [];
  for (let i = 1; i <= 3000; i++) lines.push('per_frame_' + i + '=q1 = q1 + sin(' + i + ');');
  const t0 = Date.now();
  const p = new M.Preset(lines.join('\n'));
  p.frame({ bass: 1 });
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, '3000 satırlık preset ' + ms + ' ms sürdü');
  assert.ok(isFinite(p.get('q1')), 'sonuç sonlu değil');
});

// ===========================================================================
test('söz ayrıştırıcısı bozuk dosyada çökmez', () => {
  for (const bad of NASTY) {
    if (typeof bad === 'object' && bad !== null) continue;
    if (typeof bad === 'function') continue;
    assert.doesNotThrow(() => {
      const d = LY.parse(bad);
      assert.ok(Array.isArray(d.lines));
      LY.at(d, 12.3);
      LY.toLRC(d);
    }, 'girdi: ' + brief(bad));
  }
});

test('söz dosyasındaki uçuk zaman değerleri sonlu kalır', () => {
  const d = LY.parse('[999:99.999]uzak\n[00:00.00]yakın\n[-5:00.00]negatif');
  for (const l of d.lines) {
    assert.ok(isFinite(l.start) && isFinite(l.end), 'sonsuz zaman');
  }
});

function brief(v) {
  if (typeof v === 'string') return 'str(' + v.length + ')';
  if (typeof v === 'function') return 'fn';
  try { return JSON.stringify(v).slice(0, 60); } catch (e) { return String(v); }
}
