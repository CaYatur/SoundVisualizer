'use strict';
/* MilkDrop dil yorumlayıcısının testleri.
 *
 * Bir ifade dilinin doğruluğu tam olarak ölçülebilir: kaynak metin girer,
 * belirli bir sayı çıkar. "Görüntü güzel görünüyor" değil, "2 + 3 * 4 on
 * dörttür" denebiliyor. Bu dosya bunu yapıyor: öncelik kuralları, birleşme
 * yönleri, yerleşik fonksiyonların tanımları, uç durumlar ve gerçek preset
 * dosyalarının ayrıştırılması. */

/* Satır sonu: kaçış dizisi yazmadan. */
const EOL = String.fromCharCode(10);
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/shared/milkdrop.js');

// Bir ifadeyi çalıştırıp bir değişkenin son değerini döndürür
function run(src, vars, readVar) {
  const pool = new M.Pool();
  if (vars) for (const k in vars) pool.set(k, vars[k]);
  const c = M.compile(src, pool);
  assert.strictEqual(c.error, '', 'derleme hatası: ' + c.error);
  c.run(pool.values);
  return pool.get(readVar || 'r');
}

const close = (a, b, msg, eps) =>
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), `${msg}: ${a} ≠ ${b}`);

// ===========================================================================
// Sözcükleyici
// ===========================================================================
test('sözcükleyici sayı, tanımlayıcı ve işleç ayırır', () => {
  const t = M.tokenize('x = 1.5 + foo*2; // yorum\ny=.5');
  const kinds = t.map((k) => k.t + ':' + k.v).join(' ');
  assert.ok(kinds.includes('id:x'), kinds);
  assert.ok(kinds.includes('num:1.5'), kinds);
  assert.ok(kinds.includes('id:foo'), kinds);
  assert.ok(kinds.includes('num:0.5'), kinds);
  assert.ok(!kinds.includes('yorum'), 'yorum atılmadı');
});

test('sözcükleyici büyük/küçük harf ayrımı yapmaz', () => {
  const t = M.tokenize('MyVar = SIN(1)');
  assert.strictEqual(t[0].v, 'myvar');
  assert.strictEqual(t[2].v, 'sin');
});

test('sözcükleyici blok yorumu ve üstel gösterimi anlar', () => {
  const t = M.tokenize('a = 1e3 /* atla */ + 2.5e-2');
  const nums = t.filter((k) => k.t === 'num').map((k) => k.v);
  assert.deepStrictEqual(nums, [1000, 0.025]);
});

// ===========================================================================
// Öncelik ve birleşme
// ===========================================================================
test('çarpma toplamadan önce gelir', () => {
  close(run('r = 2 + 3 * 4'), 14, '2+3*4');
  close(run('r = (2 + 3) * 4'), 20, '(2+3)*4');
});

test('üs alma çarpmadan önce gelir ve sağdan birleşir', () => {
  close(run('r = 2 * 3 ^ 2'), 18, '2*3^2');
  close(run('r = 2 ^ 3 ^ 2'), 512, '2^3^2 sağdan birleşmeli');
});

test('tekli eksi doğru bağlar', () => {
  close(run('r = -2 + 3'), 1, '-2+3');
  close(run('r = -(2 + 3)'), -5, '-(2+3)');
  close(run('r = 3 - -2'), 5, '3 - -2');
});

test('karşılaştırma ve mantık işleçleri 0/1 döndürür', () => {
  close(run('r = 3 > 2'), 1, '3>2');
  close(run('r = 3 < 2'), 0, '3<2');
  close(run('r = 2 == 2'), 1, '2==2');
  close(run('r = 2 != 2'), 0, '2!=2');
  close(run('r = (1 > 0) && (2 > 1)'), 1, '&&');
  close(run('r = (1 > 2) || (2 > 1)'), 1, '||');
  close(run('r = (1 > 2) || (2 > 3)'), 0, '|| yanlış');
});

test('mantıksal işleçler karşılaştırmadan sonra gelir', () => {
  // 1 > 0 && 0 > 1  ->  (1>0) && (0>1)  ->  0
  close(run('r = 1 > 0 && 0 > 1'), 0, 'öncelik');
});

test('atama bir ifadedir ve değerini döndürür', () => {
  close(run('r = (x = 5) + 1', null, 'r'), 6, 'atama değeri');
  close(run('r = (x = 5) + 1', null, 'x'), 5, 'atanan değişken');
});

test('deyimler sırayla çalışır', () => {
  close(run('a = 2; b = a * 3; r = b + 1'), 7, 'sıra');
});

test('noktalı virgül eksikliği kabul edilir', () => {
  // Gerçek presetlerde sık görülür; katı olmak dosyaların çoğunu reddederdi
  close(run('a = 2\nb = 3\nr = a + b'), 5, 'satır sonu ayırıcı');
});

// ===========================================================================
// Yerleşik fonksiyonlar
// ===========================================================================
test('trigonometrik fonksiyonlar tanımlarından', () => {
  close(run('r = sin(0)'), 0, 'sin(0)');
  close(run('r = cos(0)'), 1, 'cos(0)');
  close(run('r = sin(3.14159265358979/2)'), 1, 'sin(pi/2)', 1e-9);
  close(run('r = atan2(1, 1)'), Math.PI / 4, 'atan2(1,1)');
});

test('cebirsel fonksiyonlar tanımlarından', () => {
  close(run('r = abs(-3)'), 3, 'abs');
  close(run('r = sqr(4)'), 16, 'sqr');
  close(run('r = sqrt(9)'), 3, 'sqrt');
  close(run('r = pow(2, 10)'), 1024, 'pow');
  close(run('r = min(3, 7)'), 3, 'min');
  close(run('r = max(3, 7)'), 7, 'max');
  close(run('r = sign(-5)'), -1, 'sign(-)');
  close(run('r = sign(0)'), 0, 'sign(0)');
  close(run('r = int(2.7)'), 2, 'int');
  close(run('r = int(-2.7)'), -3, 'int negatif (aşağı yuvarlar)');
  close(run('r = frac(2.75)'), 0.75, 'frac');
  close(run('r = ceil(2.1)'), 3, 'ceil');
});

test('mantık fonksiyonları tanımlarından', () => {
  close(run('r = bnot(0)'), 1, 'bnot(0)');
  close(run('r = bnot(5)'), 0, 'bnot(5)');
  close(run('r = bor(0, 3)'), 1, 'bor');
  close(run('r = band(1, 0)'), 0, 'band');
  close(run('r = equal(2, 2)'), 1, 'equal');
  close(run('r = above(3, 2)'), 1, 'above');
  close(run('r = below(3, 2)'), 0, 'below');
});

test('if() kısa devre yapar — kullanılmayan dal ÇALIŞMAZ', () => {
  /* Kritik: her iki dalı da hesaplamak, kullanılmayan dalın içindeki
     atamaları yanlışlıkla uygulardı. Presetler if() içinde atama yapar. */
  const pool = new M.Pool();
  const c = M.compile('r = if(1, (taken = 1), (skipped = 1))', pool);
  c.run(pool.values);
  close(pool.get('taken'), 1, 'seçilen dal çalışmalı');
  close(pool.get('skipped'), 0, 'seçilmeyen dal ÇALIŞMAMALI');
});

test('sigmoid tanımından', () => {
  close(run('r = sigmoid(0, 1)'), 0.5, 'sigmoid(0,1)');
  assert.ok(run('r = sigmoid(10, 1)') > 0.99, 'sigmoid büyük girdi');
});

// ===========================================================================
// Uç durumlar — bir preset asla NaN üretmemeli
// ===========================================================================
test('sıfıra bölme sıfır verir, NaN değil', () => {
  close(run('r = 5 / 0'), 0, '5/0');
  close(run('r = 0 / 0'), 0, '0/0');
  close(run('r = 5 % 0'), 0, '5%0');
});

test('tanımsız matematik sonlu değer verir', () => {
  close(run('r = log(0)'), 0, 'log(0)');
  close(run('r = log(-1)'), 0, 'log(-1)');
  close(run('r = sqrt(-4)'), 2, 'sqrt(-4) mutlak değer alır');
  close(run('r = asin(5)'), Math.PI / 2, 'asin sınırlanır');
  assert.ok(isFinite(run('r = exp(10000)')), 'exp taşması sonlu olmalı');
  assert.ok(isFinite(run('r = pow(0, -1)')), 'pow(0,-1) sonlu olmalı');
});

test('hiçbir ifade NaN sızdırmaz', () => {
  const cases = [
    'r = 0/0', 'r = log(0) * 5', 'r = sqrt(-1) + 1/0',
    'r = exp(1e9) - exp(1e9)', 'r = tan(3.14159265358979/2)',
    'r = pow(-2, 0.5)', 'r = 1e308 * 1e308',
  ];
  for (const src of cases) {
    const v = run(src);
    assert.ok(isFinite(v), src + ' -> ' + v);
  }
});

test('tanımsız değişkenler sıfırdır', () => {
  close(run('r = hicbirzamanatanmadi + 1'), 1, 'tanımsız değişken');
});

test('bozuk kaynak çökmez, hata bildirir', () => {
  const pool = new M.Pool();
  const c = M.compile('r = 2 +++ ) (', pool);
  assert.ok(c.error, 'hata bildirilmedi');
  assert.doesNotThrow(() => c.run(pool.values), 'bozuk blok çalıştırılınca çöktü');
});

test('bilinmeyen fonksiyon hata verir', () => {
  const c = M.compile('r = boyleBirSeyYok(1)', new M.Pool());
  assert.ok(/bilinmeyen fonksiyon/.test(c.error), 'hata metni: ' + c.error);
});

test('yanlış argüman sayısı hata verir', () => {
  const c = M.compile('r = sin(1, 2)', new M.Pool());
  assert.ok(/argüman/.test(c.error), 'hata metni: ' + c.error);
});

// ===========================================================================
// rand() ve belirlenimlilik
// ===========================================================================
test('rand() aralıkta ve tohumlu', () => {
  const mk = () => {
    const pool = new M.Pool();
    const c = M.compile('r = rand(100)', pool, { seed: 7 });
    const out = [];
    for (let i = 0; i < 50; i++) { c.run(pool.values); out.push(pool.get('r')); }
    return out;
  };
  const a = mk();
  const b = mk();
  assert.deepStrictEqual(a, b, 'aynı tohum farklı dizi verdi');
  for (const v of a) {
    assert.ok(Number.isInteger(v) && v >= 0 && v < 100, 'rand aralık dışı: ' + v);
  }
  assert.ok(new Set(a).size > 10, 'rand sabit kalmış');
});

// ===========================================================================
// Değişken havuzu
// ===========================================================================
test('havuz q ve reg değişkenlerini taşır', () => {
  const pool = new M.Pool();
  const a = M.compile('q1 = 42; reg07 = 5', pool);
  a.run(pool.values);
  close(pool.get('q1'), 42, 'q1');
  close(pool.get('reg07'), 5, 'reg07');
  // Ayrı derlenmiş bir blok aynı havuzu görür — zincir budur
  const b = M.compile('r = q1 * 2 + reg07', pool);
  b.run(pool.values);
  close(pool.get('r'), 89, 'bloklar arası aktarım');
});

test('reset kalıcı registerları korur, diğerlerini siler', () => {
  const pool = new M.Pool();
  pool.set('q1', 9);
  pool.set('reg00', 8);
  pool.reset();
  close(pool.get('q1'), 0, 'q1 silinmeliydi');
  close(pool.get('reg00'), 8, 'reg00 korunmalıydı');
});

// ===========================================================================
// .milk dosya ayrıştırma
// ===========================================================================
const SAMPLE = [
  '[preset00]',
  'fRating=3.000',
  'fGammaAdj=1.700',
  'zoom=1.010',
  'nWaveMode=2',
  'per_frame_1=q1 = bass;',
  'per_frame_2=q2 = treb;',
  'per_frame_10=rot = rot + 0.01;',
  'per_frame_3=zoom = zoom + q1*0.02;',
  'per_pixel_1=zoom = zoom + rad*0.05;',
  'per_pixel_2=rot = rot + ang*0.01;',
  'PER_FRAME_INIT_1=q8 = 0;',
  'warp_1=shader_body {',
  'warp_2=  ret = tex2D(sampler_main, uv).xyz;',
  'warp_3=}',
  'comp_1=shader_body { ret = 1; }',
  'wave_0_init1=t1 = 0;',
  'wave_0_per_point1=x = sample;',
  'shape_1_per_frame1=r = 1;',
].join('\n');

test('.milk: sayısal ve metinsel parametreler okunur', () => {
  const f = M.parseMilk(SAMPLE);
  close(f.params.frating, 3, 'fRating');
  close(f.params.fgammaadj, 1.7, 'fGammaAdj');
  close(f.params.zoom, 1.01, 'zoom');
  close(f.params.nwavemode, 2, 'nWaveMode');
});

test('.milk: numaralandırılmış denklem satırları SIRAYLA birleşir', () => {
  const f = M.parseMilk(SAMPLE);
  const at = (t) => f.perFrame.indexOf(t);
  // 1, 2, 3, 10 sırasında olmalı — dosyada 10 üçüncü sırada yazılmıştı
  for (const t of ['q1 = bass', 'q2 = treb', 'zoom = zoom + q1', 'rot = rot + 0.01']) {
    assert.ok(at(t) >= 0, 'eksik: ' + t);
  }
  assert.ok(at('q1 = bass') < at('q2 = treb'), '1 < 2');
  assert.ok(at('q2 = treb') < at('zoom = zoom + q1'), '2 < 3');
  assert.ok(at('zoom = zoom + q1') < at('rot = rot + 0.01'), '10 en sonda olmalı');
});

test('.milk: bir simgenin ORTASINDAN bölünmüş satırlar onarılır', () => {
  /* Gerçek presetlerde görülen durum: uzun bir denklem numaralı anahtarlara
     bölünürken kesik `treb_att` simgesinin ortasından geçmiş. Araya satır
     sonu koyan bir birleştirme onu iki ayrı simgeye böler ve preset hiç
     ayrıştırılamaz. */
  const src = ['[preset00]', 'per_pixel_1=rot = rot * above(bass,t', 'per_pixel_2=reb_att);', ''].join(EOL);
  const f = M.parseMilk(src);
  assert.ok(/treb_att/.test(f.perPixel), 'bölünmüş simge birleşmedi: ' + f.perPixel);
  assert.strictEqual(M.compile(f.perPixel, new M.Pool()).error, '');
});

test('.milk: satır yorumu YALNIZCA kendi anahtarını yutar', () => {
  /* Bitiştirerek birleştirmenin bedeli: `//` satır sonuna kadar sürdüğü için,
     satır sonu kalkınca tek bir yorum kendinden sonraki bütün anahtarları
     yutabilir. Blok hata vermez — sessizce boşalır, ki bu daha kötüsüdür.
     Ölçüldü: yorumlar temizlenmeden 10.347 presetin 630'u böyle boşalıyordu. */
  const src = ['[preset00]', 'per_frame_1=a = 1; // yorum', 'per_frame_2=b = 2;', ''].join(EOL);
  const f = M.parseMilk(src);
  const pool = new M.Pool();
  const c = M.compile(f.perFrame, pool);
  assert.strictEqual(c.error, '', 'derleme hatası: ' + c.error);
  c.run();
  assert.strictEqual(pool.get('a'), 1);
  assert.strictEqual(pool.get('b'), 2, 'yorum sonraki anahtarı yuttu');
});

test('.milk: büyük harfli anahtarlar da tanınır', () => {
  const f = M.parseMilk(SAMPLE);
  assert.ok(f.init.includes('q8 = 0'), 'PER_FRAME_INIT tanınmadı');
});

test('.milk: shader, dalga ve şekil blokları ayrılır', () => {
  const f = M.parseMilk(SAMPLE);
  assert.ok(f.warpShader.includes('tex2D'), 'warp shader');
  assert.ok(f.compShader.includes('ret = 1'), 'comp shader');
  assert.strictEqual(f.waves.length, 1, 'dalga sayısı');
  assert.ok(f.waves[0].per_point.includes('x = sample'), 'dalga per_point');
  assert.strictEqual(f.shapes.length, 1, 'şekil sayısı');
});

test('.milk: boş ve bozuk girdide çökmez', () => {
  for (const bad of ['', null, undefined, '[preset00]', 'çöp\x00bayt', '=====']) {
    assert.doesNotThrow(() => M.parseMilk(bad), 'girdi: ' + String(bad));
  }
  const f = M.parseMilk('');
  assert.strictEqual(f.perFrame, '');
  assert.deepStrictEqual(f.waves, []);
});

// ===========================================================================
// Preset çalıştırma
// ===========================================================================
test('preset kare ve piksel bloklarını çalıştırır', () => {
  const p = new M.Preset(SAMPLE);
  assert.deepStrictEqual(p.errors, [], 'derleme hataları: ' + p.errors.join(' | '));
  p.frame({ bass: 2, treb: 3, time: 1 });
  close(p.get('q1'), 2, 'q1 = bass');
  close(p.get('q2'), 3, 'q2 = treb');
  // zoom dosyadan 1.01, per_frame onu q1*0.02 kadar artırır
  close(p.get('zoom'), 1.01 + 0.04, 'per_frame zoom', 1e-9);

  p.captureBase();
  const out = p.pixel(0.5, 0.5, 0.7, 1.2);
  // per_pixel zoom'u rad*0.05 kadar artırır
  close(out.zoom, 1.05 + 0.7 * 0.05, 'per_pixel zoom', 1e-9);
  assert.ok(isFinite(out.rot) && isFinite(out.cx), 'çıktı sonlu');
});

test('preset init yalnızca bir kez çalışır', () => {
  const src = 'per_frame_init_1=sayac = sayac + 1;\nper_frame_1=q1 = sayac;';
  const p = new M.Preset(src);
  p.frame({});
  p.frame({});
  p.frame({});
  close(p.get('sayac'), 1, 'init üç kez çalıştı');
});

test('preset piksel çıktısı nesneyi yeniden kullanır', () => {
  const p = new M.Preset(SAMPLE);
  p.frame({ bass: 1, treb: 1 });
  p.captureBase();
  const reuse = {};
  const a = p.pixel(0.1, 0.2, 0.3, 0.4, reuse);
  const b = p.pixel(0.5, 0.6, 0.7, 0.8, reuse);
  assert.strictEqual(a, b, 'nesne yeniden kullanılmıyor (kare başına 1728 ayırma olurdu)');
});

test('bozuk preset uygulamayı durdurmaz', () => {
  const p = new M.Preset('per_frame_1=bu ( bozuk ;;; )');
  assert.ok(p.errors.length, 'hata bildirilmedi');
  assert.doesNotThrow(() => {
    p.frame({ bass: 1 });
    p.captureBase();
    p.pixel(0, 0, 0, 0);
  });
});

test('gerçekçi bir hareket bloğu sonlu kalır', () => {
  const src = [
    'per_frame_1=q1 = bass_att*2;',
    'per_frame_2=zoom = 1 + 0.02*sin(time*0.7) + q1*0.01;',
    'per_frame_3=rot = 0.02*cos(time*0.3);',
    'per_frame_4=warp = 0.5 + bass*0.4;',
    'per_pixel_1=zoom = zoom + 0.06*sin(rad*8 - time*2);',
    'per_pixel_2=rot = rot + 0.03*sin(ang*3);',
    'per_pixel_3=dx = 0.002*cos(ang*5 + time);',
  ].join('\n');
  const p = new M.Preset(src);
  assert.deepStrictEqual(p.errors, []);
  const out = {};
  for (let f = 0; f < 60; f++) {
    p.frame({ time: f / 60, bass: 0.5 + 0.4 * Math.sin(f), bass_att: 0.5, treb: 0.3 });
    p.captureBase();
    for (let i = 0; i < 24; i++) {
      const u = i / 23;
      p.pixel(u, 1 - u, Math.hypot(u - 0.5, 0.5 - u), u * 6.28, out);
      for (const k in out) {
        assert.ok(isFinite(out[k]), 'kare ' + f + ' ' + k + ' = ' + out[k]);
      }
    }
  }
});

test('aynı preset aynı girdilerle aynı çıktıyı verir', () => {
  const src = 'per_frame_1=q1 = rand(1000);\nper_pixel_1=zoom = 1 + q1*0.0001;';
  const runOnce = () => {
    const p = new M.Preset(src, { seed: 99 });
    const vals = [];
    for (let f = 0; f < 10; f++) {
      p.frame({ time: f / 60 });
      p.captureBase();
      vals.push(p.pixel(0.3, 0.4, 0.5, 0.6).zoom);
    }
    return vals;
  };
  assert.deepStrictEqual(runOnce(), runOnce(), 'belirlenimli değil');
});

// ==========================================================================
// ns-eel dil özellikleri — #559'da 10.347 gerçek preset ölçülerek eklendi
// ==========================================================================
/* Bu bloktaki her şey, gerçek preset paketlerinde SAYILARAK bulundu:
   megabuf/gmegabuf 425 preseti, loop 406'sını, bileşik atama 65'ini,
   deyim dizileri 83'ünü, exec2/exec3 81'ini, while 34'ünü tek başına
   engelliyordu. Hiçbiri tahminle eklenmedi. */

const run1 = (src, opts) => {
  const p = new M.Pool();
  const c = M.compile(src, p, opts);
  c.run();
  return { c, g: (n) => p.values[p.id(n)] };
};

test('megabuf: yazılır, okunur ve preset içinde kalır', () => {
  const { c, g } = run1('megabuf(5) = 42; x = megabuf(5); y = megabuf(6);');
  assert.strictEqual(c.error, '');
  assert.strictEqual(g('x'), 42);
  assert.strictEqual(g('y'), 0, 'yazılmamış göz 0 olmalı');
});

test('megabuf: sınır dışı indeks çökmez, 0 döner', () => {
  const { g } = run1('a = megabuf(-1); b = megabuf(99999999); megabuf(-3) = 7; c = megabuf(-3);');
  assert.deepStrictEqual([g('a'), g('b'), g('c')], [0, 0, 0]);
});

test('gmegabuf presetler ARASINDA ortaktır, megabuf değildir', () => {
  /* MilkDrop'ta ayrım tam olarak budur ve presetler buna güvenerek
     birbirine veri bırakır. */
  run1('gmegabuf(11) = 5; megabuf(11) = 5;');
  const { g } = run1('a = gmegabuf(11); b = megabuf(11);');
  assert.strictEqual(g('a'), 5, 'gmegabuf ortak olmalı');
  assert.strictEqual(g('b'), 0, 'megabuf presete özel olmalı');
});

test('bileşik atama: değişkende ve bellekte', () => {
  const { c, g } = run1('z = 1; z -= 0.25; a = 2; a *= 3; b = 10; b /= 4; d = 7; d += 1;'
    + ' megabuf(1) = 10; megabuf(1) *= 4; m = megabuf(1);');
  assert.strictEqual(c.error, '');
  assert.deepStrictEqual([g('z'), g('a'), g('b'), g('d'), g('m')], [0.75, 6, 2.5, 8, 40]);
});

test('bileşik atamada bellek indeksi BİR KEZ hesaplanır', () => {
  /* `megabuf(n = n + 1) *= 2` indeksi iki kez hesaplasaydı bir gözü okuyup
     BAŞKA bir göze yazardı ve hata hiç fark edilmezdi. */
  const { g } = run1('n = 0; megabuf(1) = 5; megabuf(n = n + 1) *= 3; x = megabuf(1); y = n;');
  assert.strictEqual(g('x'), 15);
  assert.strictEqual(g('y'), 1, 'indeks yan etkisi iki kez çalışmış');
});

test('loop: sayaç kadar döner, iç içe olabilir', () => {
  const { c, g } = run1('n = 0; loop(3, n = n + 1;); m = 0; loop(2, loop(4, m = m + 1;););');
  assert.strictEqual(c.error, '');
  assert.strictEqual(g('n'), 3);
  assert.strictEqual(g('m'), 8);
});

test('loop bütçesi sonsuz döngüyü keser', () => {
  /* Bütçe olmasaydı per_pixel içindeki bir loop(10000,…) ağın 1271
     düğümünde 60 fps ile uygulamayı dondururdu. */
  const { g } = run1('n = 0; loop(1000000, n = n + 1;);', { loopBudget: 250 });
  assert.strictEqual(g('n'), 250);
});

test('while: koşul sıfırlanana kadar döner ve bütçeyle sınırlıdır', () => {
  const a = run1('n = 0; while( exec2(n = n + 1, below(n, 5)) );', { loopBudget: 1000 });
  assert.strictEqual(a.g('n'), 5);
  const b = run1('k = 0; while( exec2(k = k + 1, 1) );', { loopBudget: 300 });
  assert.strictEqual(b.g('k'), 300, 'durmayan döngü kesilmedi');
});

test('exec2 / exec3 hepsini çalıştırır, SONUNCUYU döner', () => {
  const { g } = run1('a = 0; b = 0; c = 0; x = exec2(a = 1, b = 2); y = exec3(a = 3, b = 4, c = 5);');
  assert.deepStrictEqual([g('x'), g('y'), g('a'), g('c')], [2, 5, 3, 5]);
});

test('parantez içinde noktalı virgül deyim dizisi kurar', () => {
  /* `if (c, a = 1; b = 2, …)` biçimi gerçek presetlerde yaygın; dizi
     desteklenmezse if'in argüman sayısı tutmaz ve preset reddedilir. */
  const { c, g } = run1('q = 0; r = 0; x = if(1, q = 5; r = 6, q = 9);');
  assert.strictEqual(c.error, '');
  assert.deepStrictEqual([g('q'), g('r'), g('x')], [5, 6, 6]);
});

test('ard arda noktalı virgül boş deyimdir', () => {
  const { c, g } = run1('n = 0; loop(2, n = n + 1;; n = n + 1;); x = if(1, n; ;, 0);');
  assert.strictEqual(c.error, '');
  assert.strictEqual(g('n'), 4);
});

test('assign(x, v) atamanın çağrı biçimidir', () => {
  const { c, g } = run1('assign(d, 9); e = d * 2;');
  assert.strictEqual(c.error, '');
  assert.deepStrictEqual([g('d'), g('e')], [9, 18]);
});

test('bozuk deyim ATLANIR, kalanı çalışır ve atlama BİLDİRİLİR', () => {
  /* Tek bozuk satır yüzünden presetin tamamını kaybetmek doğru değil; ama
     sessizce atlamak, yanlış görünen bir sahnenin sebebini saklardı. */
  const { c, g } = run1('a = 1; 0 = 5; b = 2; c2 = bilinmeyenfn(3); d = 4;');
  assert.strictEqual(c.skipped, 2, 'atlanan deyim sayısı');
  assert.ok(c.error, 'atlama bildirilmedi');
  assert.ok(/bilinmeyen fonksiyon/.test(c.error), 'sebep yazılmamış: ' + c.error);
  assert.deepStrictEqual([g('a'), g('b'), g('d')], [1, 2, 4], 'sağlam deyimler çalışmalı');
});

test('renk kanalı 0..1 aralığına kırpılır ve SIFIR geçerli bir değerdir', () => {
  /* Bu ikisi ekranda bulundu, testte değil: `wave_r=1 wave_g=1 wave_b=0`
     diyen sarı bir preset beyaz çıkıyordu, çünkü çizici `b || 1` yazıyordu.
     Ayrıca üst sınır yoktu; 13 gibi bir değer beyaza doyuyordu. */
  assert.strictEqual(M.clampColor(0), 0, 'sıfır geçerli bir kanal değeri');
  assert.strictEqual(M.clampColor(1), 1);
  assert.strictEqual(M.clampColor(0.5), 0.5);
  assert.strictEqual(M.clampColor(13.9), 1, 'üst sınır');
  assert.strictEqual(M.clampColor(-4), 0, 'alt sınır');
  // Belirtilmemiş / anlamsız değerlerde MilkDrop varsayılanı beyazdır
  for (const bad of [undefined, null, NaN, Infinity, 'x']) {
    assert.strictEqual(M.clampColor(bad), 1, 'varsayılan beyaz: ' + String(bad));
  }
});

test('dalga rengi belirtilmezse beyaz, belirtilirse aynen korunur', () => {
  const mk = (lines) => new M.Preset(['[preset00]'].concat(lines, ['']).join(EOL));
  const bare = mk([]);
  assert.deepStrictEqual(
    ['wave_r', 'wave_g', 'wave_b'].map((k) => bare.get(k)), [1, 1, 1],
    'belirtilmeyen renk MilkDrop varsayılanı olan beyaz olmalı'
  );
  const yellow = mk(['wave_r=1', 'wave_g=1', 'wave_b=0']);
  assert.deepStrictEqual(
    ['wave_r', 'wave_g', 'wave_b'].map((k) => yellow.get(k)), [1, 1, 0],
    'dosyadaki sıfır kanalı korunmalı'
  );
});

test('shader blokları SATIR YAPISINI korur, denklemler gibi bitiştirilmez', () => {
  /* Denklem blokları bitiştirilerek birleşiyor (bölünmüş simgeleri onarmak
     için). Shader blokları HLSL'dir ve aynı işleme SOKULAMAZ: denklem
     ayrıştırıcısı HLSL'i hiçbir zaman kabul etmeyeceğinden her seferinde
     bitiştirilmiş biçim seçilir ve satırlar kaynaşırdı. Ölçüldü — bu hata
     8500 presetin shader'ını 46 satırdan 2 satıra indirmişti. */
  const src = [
    '[preset00]',
    'warp_1=shader_body {',
    'warp_2=   float3 c = tex2D(sampler_main, uv).xyz;',
    'warp_3=   ret = c * 0.98;',
    'warp_4=}',
    'comp_1=shader_body {',
    'comp_2=   ret = tex2D(sampler_main, uv).xyz;',
    'comp_3=}',
    '',
  ].join(EOL);
  const f = M.parseMilk(src);
  assert.strictEqual(f.warpShader.split(EOL).length, 4, 'warp satırları kaynaşmış: ' + JSON.stringify(f.warpShader));
  assert.strictEqual(f.compShader.split(EOL).length, 3, 'comp satırları kaynaşmış');
  assert.ok(/float3 c = tex2D/.test(f.warpShader), 'shader gövdesi bozulmuş');
  // Denklem tarafı bitiştirmeye devam etmeli — iki davranış ayrı kalsın
  const eq = M.parseMilk(['[preset00]', 'per_frame_1=x = above(bass,t', 'per_frame_2=reb_att);', ''].join(EOL));
  assert.ok(/treb_att/.test(eq.perFrame), 'denklem bitiştirmesi bozulmuş');
});
