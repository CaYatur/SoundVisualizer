'use strict';
/* MilkDrop preset üreticisi (#579).

   Üretici bir .milk metni yazıyor; buradaki denetimler o metnin
   1) her bloğunun motorun derleyicisinden hatasız geçtiğini,
   2) shader'larının çevirmenden sert ya da yaklaşık not almadan geçtiğini,
   3) renklerinin her ses düzeyinde [0,1] içinde kaldığını (MilkDrop taşan
      rengi SARIYOR; taşma kareden kareye siyaha atlama, yani flaş demek),
   4) eksenlerin söz verdiği yönde etki ettiğini,
   5) aynı kodun her platformda aynı metni verdiğini
   ölçüyor. Render ölçümü (siyah, beyaza doyma, flaş) Electron istiyor ve
   ROADMAP'te; burada motorun Node'da koşan yarısı var. */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const G = require('../src/shared/milkdrop-generator.js');
const M = require('../src/shared/milkdrop.js');
const S = require('../src/shared/milkdrop-shader.js');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const gen = (e, w, d, m, seed, lang) => G.generate({ energy: e, warmth: w, density: d, motion: m, seed, lang });

// Testlerin kendi tohum dizisi: sabit, platformdan bağımsız
function seeds(n, start) {
  let x = (start || 0x9E3779B9) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out.push(x % G.SEED_LIMIT);
  }
  return out;
}

// Bir presetin bütün denklem blokları: [ad, metin]
function blocksOf(f) {
  const out = [['init', f.init], ['per_frame', f.perFrame], ['per_pixel', f.perPixel]];
  for (const w of f.waves) {
    for (const k of ['init', 'per_frame', 'per_point']) out.push(['wave' + w.index + '.' + k, w[k]]);
  }
  for (const s of f.shapes) {
    for (const k of ['init', 'per_frame']) out.push(['shape' + s.index + '.' + k, s[k]]);
  }
  return out.filter(([, src]) => src && src.trim());
}

// Değişkenleri verilen bir havuzda bloğu koşturur; derleme hatası testi düşürür
function run(src, vars) {
  return prep(src)(vars);
}

/* Bloğu BİR KEZ derler, her çağrıda girdileri yazıp koşturur. Renk
   sınırı testi aynı bloğu yüzlerce girdiyle koşturuyor; her seferinde
   derlemek testi saniyelerce uzatırdı. */
function prep(src) {
  const p = new M.Pool();
  const c = M.compile(src, p);
  assert.strictEqual(c.error, '', 'derleme hatası: ' + c.error + '\n' + src);
  return (vars) => {
    for (const k of Object.keys(vars || {})) p.set(k, vars[k]);
    c.run();
    return p;
  };
}

// ------------------------------------------------------------------ kod

test('kod: eksenler ve tohum geri okunuyor, kimlik koddan', () => {
  for (const s of seeds(40)) {
    const ax = { energy: s % 101, warmth: (s >>> 7) % 101, density: (s >>> 13) % 101, motion: (s >>> 19) % 101 };
    const code = G.encode(ax, s);
    const d = G.decode(code);
    assert.deepStrictEqual(d, { axes: ax, seed: s });
    assert.strictEqual(G.encode(d.axes, d.seed), code);
    const r = G.generate({ axes: ax, seed: s });
    assert.strictEqual(r.code, code);
    assert.strictEqual(r.id, G.idOf(code));
    assert.strictEqual(r.id, 'md_gen' + G.VERSION + '_' + code);
  }
});

test('kod: tek bir yazım — baştaki sıfır, büyük harf ve boşluk aynı kimliğe gidiyor', () => {
  const canon = '50-7-0-100-k3x9ab';
  for (const v of ['050-007-000-100-k3x9ab', ' 50 - 7 - 0 - 100 - K3X9AB ', '50-07-0-100-K3x9aB']) {
    const d = G.decode(v);
    assert.ok(d, v + ' okunamadı');
    assert.strictEqual(G.encode(d.axes, d.seed), canon, v);
  }
  assert.strictEqual(G.encode(G.decode('1-2-3-4-0003').axes, G.decode('1-2-3-4-0003').seed), '1-2-3-4-3');
});

test('kod: aralık dışı ya da bozuk kod reddediliyor, kırpılmıyor', () => {
  /* Sessizce 100'e kırpmak kullanıcıyı istemediği bir presete götürürdü;
     geçersiz kod "okunamadı" demeli. */
  for (const v of ['101-0-0-0-a', '0-0-0-0', '0-0-0-0-0-0', '0-0-0-0-abcdefg', '0-0-0-0-ab_c', 'a-0-0-0-1', '', null, undefined, '1000-0-0-0-1']) {
    assert.strictEqual(G.decode(v), null, JSON.stringify(v));
  }
});

test('kimlik: depo adıyla aynı ve ikinci kayıt kopya bırakmıyor', () => {
  /* Depo dosya adını kimlikten türetiyor (presets-store.js `safeName`):
     yalnız harf, rakam, alt çizgi ve tire, en çok 80 karakter. Kimlik bu
     kümenin dışına taşsaydı dosya adı kimlikten ayrılırdı. */
  const r = G.generate({ energy: 100, warmth: 100, density: 100, motion: 100, seed: G.SEED_LIMIT - 1 });
  assert.match(r.id, /^[A-Za-z0-9_-]{1,80}$/);

  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
    return origLoad.apply(this, arguments);
  };
  let STORE;
  try { STORE = require('../src/main/presets-store.js'); } finally { Module._load = origLoad; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-gen-'));
  try {
    STORE.setDir(dir);
    const p = gen(40, 60, 20, 80, 12345);
    const item = { id: p.id, kind: 'milkdrop', name: p.name, source: p.source };
    assert.ok(STORE.save(item).ok);
    assert.ok(STORE.save(Object.assign({}, item)).ok);
    assert.deepStrictEqual(fs.readdirSync(dir), [p.id + '.json']);
    assert.strictEqual(STORE.list().filter((x) => x.id === p.id).length, 1);
  } finally {
    STORE.setDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------ sınır yardımcıları

/* Bugünkü aralıklarda bu sınırlar hiç zorlanmıyor (renkler ve kazançlar
   tavanın altında kalıyor), yani üretilen presetler onları sınamıyor.
   Aralık genişletildiği gün devreye girecekler; o gün de tutmalılar. */
const T = G._test;
const numbersIn = (expr) => (expr.match(/-?\d+\.\d+/g) || []).map(Number);

test('sayı: toFixed, eksi sıfır yok', () => {
  assert.strictEqual(T.num(-0.0001), '0.000');
  assert.strictEqual(T.num(-0.0004, 3), '0.000');
  assert.strictEqual(T.num(-0.0001, 4), '-0.0001');
  assert.strictEqual(T.num(-0.25), '-0.250');
  assert.strictEqual(T.num(1 / 3), '0.333');
  assert.strictEqual(T.num(NaN), '0.000');
  assert.strictEqual(T.num(Infinity), '0.000');
});

test('iki değer arası salınım yuvarlamadan sonra da [0,1] içinde', () => {
  /* Kanal 1,0 olabiliyor (doygunluk 1, açıklık 0,5'in üstünde). Orta ve
     genlik ayrı yuvarlanınca toplamları 1,001'e çıkabiliyor: MilkDrop onu
     0'a sarar, renk vuruşla yanıp söner. */
  const vals = [0, 0.0004, 0.0005, 0.0006, 0.0015, 0.4995, 0.5, 0.5005, 0.9985, 0.9995, 0.9996, 1];
  let x = 12345;
  for (let i = 0; i < 400; i++) { x = (x * 1103515245 + 12345) % 2147483648; vals.push(Math.round((x / 2147483648) * 10000) / 10000); }
  for (const a of vals) {
    for (const b of [0, 1, 0.5005, 0.4995, 0.9995, 0.0005, vals[(Math.round(a * 997)) % vals.length]]) {
      const e = T.sway(a, b, 'time');
      const n = numbersIn(e);
      const mid = n[0];
      const amp = n.length > 1 ? n[1] : 0;
      assert.ok(mid - amp >= -1e-12 && mid + amp <= 1 + 1e-12, a + ' → ' + b + ': ' + e);
    }
  }
});

test('sesle büyüyen değer tavanı aşmıyor, sesin en yüksek hâlinde de', () => {
  for (const cap of [0.2, 0.4, 0.6, 0.9, 0.95]) {
    for (const base of [0, 0.05, 0.1995, 0.3, cap, cap + 0.2]) {
      for (const gain of [0, 0.001, 0.05, 0.3, 2]) {
        const e = T.withAudio(base, gain, 'q1', cap);
        const n = numbersIn(e);
        const top = n[0] + (n.length > 1 ? n[1] * G.AUDIO_CAP : 0);
        assert.ok(top <= cap + 1e-12, e + ' tavan ' + cap);
        assert.ok(n[0] >= 0, e);
      }
    }
  }
});

// ------------------------------------------------------------ belirlilik

test('aynı kod aynı metni veriyor; dil yalnız adı değiştiriyor', () => {
  for (const s of seeds(12, 7)) {
    const a = gen(s % 101, 30, 70, 50, s, 'tr');
    const b = gen(s % 101, 30, 70, 50, s, 'tr');
    const c = gen(s % 101, 30, 70, 50, s, 'en');
    assert.strictEqual(a.source, b.source);
    assert.strictEqual(a.source, c.source);
    assert.strictEqual(a.name, b.name);
    assert.notStrictEqual(a.name, c.name);
    assert.ok(a.name.endsWith(' · ' + s.toString(36)), a.name);
    assert.ok(c.name.endsWith(' · ' + s.toString(36)), c.name);
    assert.ok(!/[çğıöşüÇĞİÖŞÜâ]/.test(c.name), 'İngilizce adda Türkçe harf: ' + c.name);
  }
});

/* ALTIN ÖZETLER. Bir kalıp ya da sayı değişirse aynı kod başka bir preset
   verir; kaydedilmiş bir kodu paylaşan kullanıcı başka bir şey görür. Bu
   test düşerse değişiklik bilerek yapıldıysa VERSION artırılmalı (kimlik
   de değişir, eski kayıtların üstüne yazılmaz) ve özetler yenilenmeli.
   Windows ve Ubuntu'da, Node 20 ve 22'de aynı çıkmalı: üretici yazdığı
   sayılara sin/pow/exp sokmuyor.

   Özetler bir kez VERSION artmadan yenilendi (#580): dalga saydamlığının
   anahtarı `wave_a` yerine MilkDrop'un okuduğu `fWaveAlpha` oldu. Değer ve
   motordaki görüntü aynı, yalnız MilkDrop'ta artık doğru okunuyor; aynı
   kodu yeniden kaydetmek eski dosyanın üstüne AYNI görünen, düzeltilmiş
   bir dosya yazıyor. Görüntüyü değiştiren bir değişiklik VERSION ister. */
const GOLDEN = {
  '0-0-0-0-0': '506e5e7950ae5f55', // warp shader'ı, zorlanan tek dalga
  '100-100-100-100-zzzzzz': '766aef37f142e51c', // birleştirme, 4 dalga, 3 şekil
  '50-50-50-50-k3x9ab': 'd0ce1d37d84b2f25', // iki shader
  '72-15-60-88-2n9c': 'eb04c5e58e0fe0f0',
  '20-80-35-65-1a2b3c': 'af26a0cbbfbf1642',
  '90-40-90-10-7': 'ffa4bebae2715ca8',
  '30-60-40-30-5': '3b7e30dc59759bb4', // shader yok (MilkDrop 1 biçimi)
};

test('altın özetler: kod -> metin sabit', () => {
  for (const code of Object.keys(GOLDEN)) {
    const d = G.decode(code);
    const r = G.generate({ axes: d.axes, seed: d.seed });
    assert.strictEqual(sha(r.source), GOLDEN[code], code + ' değişti — VERSION artırılmalı mı?');
  }
});

// -------------------------------------------------------------- geçerlilik

/* Eksen ızgarası (her eksende 0, 33, 67, 100) x iki tohum: 512 preset. */
function grid() {
  const vals = [0, 33, 67, 100];
  const out = [];
  const ss = seeds(2 * 256, 0xA5A5A5A5);
  let i = 0;
  for (const e of vals) for (const w of vals) for (const d of vals) for (const m of vals) {
    out.push(gen(e, w, d, m, ss[i++]));
    out.push(gen(e, w, d, m, ss[i++]));
  }
  return out;
}
const GRID = grid();

test('ızgara: her blok derleniyor, bilinmeyen işlev yok', () => {
  const known = new Set(Object.keys(M.FUNCS));
  for (const r of GRID) {
    const f = M.parseMilk(r.source);
    const blocks = blocksOf(f);
    assert.ok(blocks.length >= 2, r.code + ': blok yok');
    for (const [name, src] of blocks) {
      const c = M.compile(src);
      assert.strictEqual(c.error, '', r.code + ' ' + name + ': ' + c.error);
      assert.ok(c.statements > 0, r.code + ' ' + name + ': boş');
      for (const m of src.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        assert.ok(known.has(m[1].toLowerCase()), r.code + ' ' + name + ': bilinmeyen işlev ' + m[1]);
      }
    }
    // Panelin derleme satırının kullandığı yol da hatasız
    const p = new M.Preset(r.source);
    assert.deepStrictEqual(p.errors, [], r.code);
  }
});

test('ızgara: shader\'lar çevrilebiliyor, yaklaşık doku yok', () => {
  let warp = 0;
  let comp = 0;
  for (const r of GRID) {
    const f = M.parseMilk(r.source);
    for (const [stage, text] of [['warp', f.warpShader], ['comp', f.compShader]]) {
      if (!text) continue;
      const t = S.translate(text, { stage });
      assert.deepStrictEqual(t.hard, [], r.code + ' ' + stage);
      assert.deepStrictEqual(t.soft, [], r.code + ' ' + stage);
      assert.ok(t.glsl.length > 0, r.code + ' ' + stage + ': boş GLSL');
      if (stage === 'warp') warp++; else comp++;
    }
    // Sürüm satırları shader'larla tutarlı: MilkDrop 2 yalnız bunlara bakıp okuyor
    const has = (k, v) => r.source.indexOf('\n' + k + '=' + v + '\n') >= 0 || r.source.indexOf(k + '=' + v + '\n') === 0;
    if (f.warpShader || f.compShader) {
      assert.ok(has('MILKDROP_PRESET_VERSION', '201'), r.code);
      assert.ok(has('PSVERSION_WARP', f.warpShader ? '2' : '0'), r.code);
      assert.ok(has('PSVERSION_COMP', f.compShader ? '2' : '0'), r.code);
    } else {
      assert.ok(r.source.indexOf('PSVERSION') < 0, r.code + ': shader yok ama sürüm satırı var');
    }
  }
  // Izgarada iki aşama da gerçekten üretiliyor
  assert.ok(warp > 50 && comp > 100, 'warp ' + warp + ', comp ' + comp);
});

test('ızgara: sayılar yalnız noktalı ondalık; "+ -" ve üstel gösterim yok', () => {
  for (const r of GRID) {
    for (const line of r.source.split('\n')) {
      assert.ok(!/\d,\d/.test(line), r.code + ' virgül: ' + line);
      assert.ok(!/\d[eE][+-]?\d/.test(line), r.code + ' üstel: ' + line);
      assert.ok(!/NaN|Infinity|undefined/.test(line), r.code + ': ' + line);
      assert.ok(!/[+\-*/]\s*-\s*\d/.test(line.replace(/^[^=]*=/, '')), r.code + ' ardışık işaret: ' + line);
      assert.ok(!/-0\.0+(?![0-9])/.test(line), r.code + ' eksi sıfır: ' + line);
    }
  }
});

test('ızgara: flaşa götüren hiçbir şey yok', () => {
  for (const r of GRID) {
    const f = M.parseMilk(r.source);
    for (const k of ['binvert', 'bsolarize', 'bbrighten', 'bdarken']) {
      assert.strictEqual(f.params[k], 0, r.code + ' ' + k);
    }
    /* Basamak işlevi yok: vuruşta bir anda açılıp kapanan bir değer
       üretemiyor. rand da yok: aynı kod her açılışta aynı görüntü. */
    for (const [name, src] of blocksOf(f)) {
      assert.ok(!/\b(above|below|equal|if|rand|bnot|band|bor|sign|floor|int|ceil)\s*\(/i.test(src), r.code + ' ' + name + ': ' + src);
    }
  }
});

// ------------------------------------------------------------ renk sınırı

const AUDIO = [0, 0.4, 1, 2.5, 20];
const TIMES = [0, 1.7, 13.3, 101.9, 1234.5];

function mainVars(f, t, a) {
  const v = { time: t, fps: 30, frame: Math.round(t * 30), progress: 0.5, aspectx: 1, aspecty: 16 / 9 };
  for (const k of ['bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att']) v[k] = a;
  for (const k of ['zoom', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy', 'wave_r', 'wave_g', 'wave_b', 'decay']) {
    if (typeof f.params[k] === 'number') v[k] = f.params[k];
  }
  return v;
}

const inUnit = (v) => v >= 0 && v <= 1;

test('renkler her ses düzeyinde [0,1] içinde: MilkDrop taşanı sarıyor', () => {
  const sample = GRID.filter((_, i) => i % 4 === 0);
  for (const r of sample) {
    const f = M.parseMilk(r.source);
    for (const k of Object.keys(f.params)) {
      if (/^(wave_[rgba]|ob_[rgba]|ib_[rgba]|mv_[rgba]|wavecode_\d+_[rgba]|shapecode_\d+_(r|g|b|a|r2|g2|b2|a2|border_[rgba]))$/.test(k)) {
        assert.ok(inUnit(f.params[k]), r.code + ' başlık ' + k + '=' + f.params[k]);
      }
    }
    const frameRun = prep(f.perFrame);
    const waveRuns = f.waves.map((w) => [w, prep(w.per_frame || ''), prep(w.per_point)]);
    const shapeRuns = f.shapes.map((sh) => [sh, prep(sh.per_frame)]);
    for (const t of TIMES) {
      for (const a of AUDIO) {
        const main = frameRun(mainVars(f, t, a));
        for (const k of ['wave_r', 'wave_g', 'wave_b']) {
          assert.ok(inUnit(main.get(k)), r.code + ' ' + k + '=' + main.get(k) + ' (t=' + t + ', ses=' + a + ')');
        }
        for (const q of ['q1', 'q2', 'q3']) {
          assert.ok(main.get(q) >= 0 && main.get(q) <= G.AUDIO_CAP, r.code + ' ' + q + '=' + main.get(q));
        }
        const shared = { time: t, fps: 30, frame: Math.round(t * 30) };
        for (const k of ['bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att']) shared[k] = a;
        for (let i = 1; i <= 32; i++) shared['q' + i] = main.get('q' + i);
        for (const [w, wf, wp] of waveRuns) {
          const pool = wf(Object.assign({}, shared));
          const tv = {};
          for (let i = 1; i <= 8; i++) tv['t' + i] = pool.get('t' + i);
          for (const s of [0, 0.37, 1]) {
            for (const v of [-1, 0, 1]) {
              const pt = wp(Object.assign({}, shared, tv, { sample: s, value1: v, value2: -v }));
              for (const k of ['r', 'g', 'b', 'a']) {
                assert.ok(inUnit(pt.get(k)), r.code + ' dalga ' + w.index + ' ' + k + '=' + pt.get(k));
              }
            }
          }
        }
        for (const [sh, sf] of shapeRuns) {
          const n = f.params['shapecode_' + sh.index + '_num_inst'] || 1;
          for (const inst of [0, n - 1]) {
            const vars = Object.assign({}, shared, { instance: inst, num_inst: n });
            for (const k of ['r', 'g', 'b', 'a', 'r2', 'g2', 'b2', 'a2', 'border_r', 'border_g', 'border_b', 'border_a']) {
              vars[k] = f.params['shapecode_' + sh.index + '_' + k];
            }
            const out = sf(vars);
            for (const k of ['r', 'g', 'b', 'a', 'r2', 'g2', 'b2', 'a2', 'border_r', 'border_g', 'border_b', 'border_a']) {
              assert.ok(inUnit(out.get(k)), r.code + ' şekil ' + sh.index + ' ' + k + '=' + out.get(k));
            }
          }
        }
      }
    }
  }
});

/* Render ölçümünün bulduğu üç kusurun kuralları (ROADMAP #579). Ölçüm
   Electron istiyor; kurallar burada, bir sonraki değişiklik onları
   sessizce geri almasın diye. */
test('seyrek preset boş değil: en az bir özel dalga ya da şekil', () => {
  // Yalnız ana dalgayla kalan presetler siyaha yakın çıkıyordu
  for (const r of GRID) {
    assert.ok(r.parts.waves.length + r.parts.shapes.length >= 1, r.code);
  }
});

test('sessizlikte nokta olan ana dalga kipleri yalnız yoğun presetlerde', () => {
  /* 1, 2, 3 ve 5 sol ve sağ kanalı birbirine karşı çiziyor: sessizlikte
     tek bir nokta. Yoğunluk 0'da ve ikiden az öğeli presette hiç. */
  for (const sd of seeds(200, 0x51)) {
    const f = M.parseMilk(gen(sd % 101, (sd >>> 8) % 101, 0, (sd >>> 16) % 101, sd).source);
    assert.ok([0, 4, 6, 7].indexOf(f.params.nwavemode) >= 0, 'yoğunluk 0, kip ' + f.params.nwavemode);
  }
  let dense = 0;
  for (const r of GRID) {
    const n = r.parts.waves.length + r.parts.shapes.length;
    const mode = M.parseMilk(r.source).params.nwavemode;
    if (n < 2) assert.ok([0, 4, 6, 7].indexOf(mode) >= 0, r.code + ': ' + n + ' öğe, kip ' + mode);
    else if ([1, 2, 3, 5].indexOf(mode) >= 0) dense++;
  }
  assert.ok(dense > 20, 'yoğun presetlerde bu kipler hiç çıkmıyor: ' + dense);
});

test('ortayı karartma ve noktalı ana dalga yalnız başka öğeler varken', () => {
  for (const r of GRID) {
    const f = M.parseMilk(r.source);
    const elements = r.parts.waves.length + r.parts.shapes.length;
    if (f.params.bdarkencenter === 1) assert.ok(r.axes.density >= 40, r.code + ': seyrek presette orta karartılmış');
    if (f.params.bwavedots === 1) assert.ok(elements >= 2, r.code + ': tek başına noktalı dalga');
  }
});

test('sessizlikte de değişiyor: halka dalganın yarıçapı ve çekirdeğin boyu zamanla oynuyor', () => {
  /* Düz bir halkayı ya da yuvarlak bir çekirdeği döndürmek görüntüyü
     değiştirmiyor; sessizlikte bu öğelerle kalan preset donmuş görünüyordu.
     Ses yokken (q = 0, dalga düz) iki ayrı anda bakılıyor. */
  let rings = 0;
  let cores = 0;
  for (const r of GRID) {
    const f = M.parseMilk(r.source);
    const silent = (t) => run(f.perFrame, mainVars(f, t, 0));
    f.waves.forEach((w, i) => {
      if (r.parts.waves[i] !== 'halka') return;
      rings++;
      const at = (t) => {
        const main = silent(t);
        const shared = { time: t, fps: 30, frame: Math.round(t * 30) };
        for (let q = 1; q <= 10; q++) shared['q' + q] = main.get('q' + q);
        const pool = run(w.per_frame, shared);
        const tv = {};
        for (let k = 1; k <= 8; k++) tv['t' + k] = pool.get('t' + k);
        return run(w.per_point, Object.assign({}, shared, tv, { sample: 0.3, value1: 0, value2: 0 })).get('t4');
      };
      assert.notStrictEqual(at(1), at(2.5), r.code + ' halka ' + w.index + ' sessizlikte sabit');
    });
    f.shapes.forEach((sh, i) => {
      if (r.parts.shapes[i] !== 'cekirdek') return;
      cores++;
      const at = (t) => {
        const main = silent(t);
        const v = { time: t, instance: 0, num_inst: 1 };
        for (let q = 1; q <= 10; q++) v['q' + q] = main.get('q' + q);
        return run(sh.per_frame, v).get('rad');
      };
      assert.notStrictEqual(at(1), at(2.5), r.code + ' çekirdek sessizlikte sabit');
    });
  }
  assert.ok(rings > 20 && cores > 20, 'halka ' + rings + ', çekirdek ' + cores);
});

test('sönme ve gama makul aralıkta; warp shader\'ı sönmeyi kendisi yapıyor', () => {
  for (const r of GRID) {
    const f = M.parseMilk(r.source);
    /* Üst sınır 0,98: 0,99'da aynı yere her kare çizilen bir çizgi
       sessizlikte bile birikip ekranın %61'ini beyaza boğdu. */
    assert.ok(f.params.fdecay >= 0.9 && f.params.fdecay <= 0.98, r.code + ' fDecay ' + f.params.fdecay);
    assert.ok(f.params.fgammaadj >= 1 && f.params.fgammaadj <= 1.8, r.code + ' gama ' + f.params.fgammaadj);
    // Ana dalga sönme yavaşladıkça saydamlaşıyor: 0,97'de tam, 0,98'de üçte iki
    const room = Math.max(0.5, Math.min(1, (1 - f.params.fdecay) / 0.03));
    assert.ok(f.params.fwavealpha <= 0.9 * room + 0.001, r.code + ' fWaveAlpha ' + f.params.fwavealpha + ' sönme ' + f.params.fdecay);
    if (f.warpShader) {
      /* MilkDrop warp shader'ı olan presette decay'i uygulamıyor. q8'i
         yazmayan bir warp shader'ı görüntüyü hiç söndürmez ve beyaza doyar. */
      assert.match(f.warpShader, /\*q8\b/, r.code);
      const main = run(f.perFrame, mainVars(f, 3, 1));
      const q8 = main.get('q8');
      assert.ok(Math.abs(q8 - f.params.fdecay) < 1e-9, r.code + ' q8 ' + q8);
      // 60 fps'te kare başına karekök: saniyelik sönme aynı
      const main60 = run(f.perFrame, Object.assign(mainVars(f, 3, 1), { fps: 60 }));
      assert.ok(Math.abs(main60.get('q8') * main60.get('q8') - f.params.fdecay) < 1e-9, r.code);
    }
  }
});

// -------------------------------------------------------------- eksenler

/* Tek bir tohumda bir eksen kalıp seçimini değiştirebilir; etkiler 60
   tohumun ORTALAMASINDA sınanıyor. */
const AX_SEEDS = seeds(60, 0x1234567);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Ses duyarlılığı: aynı anda sessiz (0,5) ile yüksek (2,0) ses arasındaki fark
function audioSensitivity(src) {
  const f = M.parseMilk(src);
  let s = 0;
  const lo = run(f.perFrame, mainVars(f, 7.3, 0.5));
  const hi = run(f.perFrame, mainVars(f, 7.3, 2.0));
  for (const k of ['zoom', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy']) s += Math.abs(hi.get(k) - lo.get(k));
  for (const sh of f.shapes) {
    const at = (a, main) => {
      const v = { time: 7.3, instance: 0, num_inst: 1 };
      for (const k of ['bass_att', 'mid_att', 'treb_att']) v[k] = a;
      for (let i = 1; i <= 10; i++) v['q' + i] = main.get('q' + i);
      return run(sh.per_frame, v);
    };
    const a = at(0.5, lo);
    const b = at(2.0, hi);
    for (const k of ['rad', 'a', 'border_a']) s += Math.abs(b.get(k) - a.get(k));
  }
  return s;
}

test('enerji: sese tepki ortalamada artıyor', () => {
  const at = (e) => mean(AX_SEEDS.map((sd) => audioSensitivity(gen(e, 50, 50, 50, sd).source)));
  const s0 = at(0);
  const s50 = at(50);
  const s100 = at(100);
  assert.ok(s0 < s50 && s50 < s100, [s0, s50, s100].join(' < '));
  assert.ok(s100 > 2 * s0, 'enerji 100, 0\'ın iki katından az tepki veriyor: ' + s0 + ' / ' + s100);
});

test('yoğunluk: öğe sayısı ortalamada artıyor', () => {
  const count = (src) => (src.match(/^(wavecode|shapecode)_\d+_enabled=1$/gm) || []).length +
    (src.match(/^per_pixel_\d+=/gm) || []).length;
  const at = (d) => mean(AX_SEEDS.map((sd) => count(gen(50, 50, d, 50, sd).source)));
  const c0 = at(0);
  const c50 = at(50);
  const c100 = at(100);
  assert.ok(c0 < c50 && c50 < c100, [c0, c50, c100].join(' < '));
  assert.ok(c100 - c0 > 3, 'yoğunluk farkı küçük: ' + c0 + ' -> ' + c100);
});

test('hareket: zaman katsayıları ortalamada artıyor', () => {
  const speed = (src) => mean(Array.from(src.matchAll(/time\*(\d+\.\d+)/g)).map((m) => Number(m[1])));
  const at = (m) => mean(AX_SEEDS.map((sd) => speed(gen(50, 50, 50, m, sd).source)));
  const v0 = at(0);
  const v50 = at(50);
  const v100 = at(100);
  assert.ok(v0 < v50 && v50 < v100, [v0, v50, v100].join(' < '));
  assert.ok(v100 > 3 * v0, 'hareket 100, 0\'ın üç katından yavaş: ' + v0 + ' / ' + v100);
});

test('sıcaklık: renkler soğuktan sıcağa kayıyor', () => {
  // Başlıktaki bütün renklerin kırmızı eksi mavi ortalaması
  const warmth = (src) => {
    const f = M.parseMilk(src);
    const xs = [];
    for (const k of Object.keys(f.params)) {
      const m = /^(wave|wavecode_\d+|shapecode_\d+)_r$/.exec(k);
      if (!m) continue;
      const b = f.params[m[1] + '_b'];
      if (typeof b === 'number') xs.push(f.params[k] - b);
    }
    return mean(xs);
  };
  const at = (w) => mean(AX_SEEDS.map((sd) => warmth(gen(50, w, 50, 50, sd).source)));
  const w0 = at(0);
  const w50 = at(50);
  const w100 = at(100);
  assert.ok(w0 < w50 && w50 < w100, [w0, w50, w100].join(' < '));
  assert.ok(w0 < -0.2 && w100 > 0.2, 'soğuk ' + w0 + ', sıcak ' + w100);
});

test('eksen oynatmak presetin geri kalanını yerinde bırakıyor', () => {
  /* Her bileşen kendi akışından çekiyor: yoğunluk ya da hareket değişince
     palet aynı; sıcaklık değişince kalıplar aynı. Kaydırıcı başka bir
     preset değil, aynı presetin başka bir hâlini vermeli. */
  const colors = (src) => src.split('\n').filter((l) => /^(wave_[rgb]|ob_[rgb]|ib_[rgb]|mv_[rgb])=/.test(l)).join('|');
  for (const sd of AX_SEEDS.slice(0, 30)) {
    const base = gen(60, 40, 50, 50, sd);
    assert.strictEqual(colors(gen(60, 40, 5, 50, sd).source), colors(base.source), 'yoğunluk paleti değiştirdi');
    assert.strictEqual(colors(gen(60, 40, 95, 95, sd).source), colors(base.source), 'hareket paleti değiştirdi');
    const warm = gen(60, 95, 50, 50, sd);
    assert.deepStrictEqual(warm.parts, base.parts, 'sıcaklık kalıpları değiştirdi');
    assert.notStrictEqual(colors(warm.source), colors(base.source));
  }
});
