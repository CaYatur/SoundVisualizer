'use strict';
/* Şablon testleri.
 *
 * Bir şablonun "çalışması" iki şey demek: uygulandığında GEÇERLİ bir sahne
 * üretmesi (var olmayan bir moda ya da efekte işaret etmemesi), ve
 * kullanıcının KURULUMUNA dokunmaması. İkisi de ölçülebilir; ikincisi
 * özellikle önemli, çünkü bir şablonu merak edip denemek kimsenin ses
 * aygıtını ya da ekran seçimini bozmamalı. */
const test = require('node:test');
const assert = require('node:assert');

// Tarayıcı modülleri window üzerinden yayın yapıyor
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const T = require('../src/shared/templates.js');
require('../src/shared/formulas.js');
require('../src/shared/formulas-extra.js');
const F = global.window.SVFormulas;

const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };

// Kayıtlı mod ve arkaplan kimlikleri (tarayıcıda yüklenen dosyalardan
// bağımsız olarak, defaults.js yorumlarındaki listeyle değil, gerçek
// panel listeleriyle karşılaştırmak için burada elle tutuluyor)
const KNOWN_BG = new Set([
  'gradient', 'starfield', 'grid', 'waves', 'bokeh', 'rain', 'aurora', 'network',
  'rings', 'nebula', 'hexgrid', 'ink', 'snow', 'city', 'corridor', 'spiral', 'mosaic',
  'liquid', 'plasma', 'ribbons', 'contours', 'embers', 'stained', 'circuit', 'caustics',
  'prism', 'globe', 'wireframe', 'sand', 'wavefield', 'hexpulse',
  'custom', 'solid', 'transparent',
]);
const KNOWN_VIS = new Set([
  'none', 'bars', 'centerBars', 'blocks', 'dots', 'skyline', 'wave', 'ribbon', 'wave3d',
  'lissajous', 'strings', 'terrain', 'circular', 'radialWave', 'starburst', 'arcs',
  'pinwheel', 'mandala', 'kaleido', 'vortex', 'helix', 'tunnel', 'orb', 'particles',
  'fireworks', 'lightning', 'bubbles', 'metaball', 'ripplegrid', 'spectrogram',
  'flowfield', 'flock', 'voronoi', 'truchet', 'moire', 'interference', 'ropes',
  'galaxy', 'dna', 'isocity', 'attractorfield', 'scope', 'goniometer', 'chromawheel',
  'geometry', 'milkdrop', 'feedback', 'custom',
]);

test('şablon kataloğu eksiksiz ve benzersiz', () => {
  assert.ok(T.TEMPLATES.length >= 60, 'şablon sayısı: ' + T.TEMPLATES.length);
  const ids = new Set();
  for (const t of T.TEMPLATES) {
    assert.ok(t.id && !ids.has(t.id), 'yinelenen/eksik kimlik: ' + t.id);
    ids.add(t.id);
    assert.ok(t.name, t.id + ': ad yok');
    assert.ok(t.group, t.id + ': grup yok');
    assert.ok(t.desc, t.id + ': açıklama yok');
    assert.ok(t.patch && typeof t.patch === 'object', t.id + ': yama yok');
  }
  assert.ok(T.groups().length >= 6, 'grup sayısı: ' + T.groups().length);
});

test('her şablon var olan bir moda ve arkaplana işaret eder', () => {
  for (const t of T.TEMPLATES) {
    const v = t.patch.visualizer && t.patch.visualizer.type;
    const b = t.patch.background && t.patch.background.type;
    if (v) assert.ok(KNOWN_VIS.has(v), t.id + ': bilinmeyen mod "' + v + '"');
    if (b) assert.ok(KNOWN_BG.has(b), t.id + ': bilinmeyen arkaplan "' + b + '"');
  }
});

test('3B şablonlar var olan formüllere işaret eder', () => {
  for (const t of T.TEMPLATES) {
    const g = t.patch.geometry;
    if (!g || !g.formula) continue;
    assert.ok(F.get(g.family, g.formula), t.id + ': bilinmeyen formül ' + g.family + '/' + g.formula);
  }
});

test('şablon paletleri geçerli renk kodları', () => {
  for (const t of T.TEMPLATES) {
    const cols = t.patch.background && t.patch.background.gradient && t.patch.background.gradient.colors;
    if (!cols) continue;
    assert.ok(cols.length >= 2, t.id + ': en az iki renk olmalı');
    for (const c of cols) {
      assert.ok(/^#[0-9a-fA-F]{6}$/.test(c), t.id + ': geçersiz renk "' + c + '"');
    }
  }
});

test('şablon efekt zincirleri geçerli biçimde', () => {
  for (const t of T.TEMPLATES) {
    const chain = t.patch.postfx;
    if (!chain) continue;
    assert.ok(Array.isArray(chain), t.id + ': postfx dizi olmalı');
    for (const e of chain) {
      assert.ok(e.type, t.id + ': efekt türü yok');
      assert.strictEqual(e.enabled, true, t.id + ': efekt kapalı eklenmiş');
      assert.ok(e.params && typeof e.params === 'object', t.id + ': parametre nesnesi yok');
    }
  }
});

test('şablon modülasyon yönlendirmeleri geçerli', () => {
  for (const t of T.TEMPLATES) {
    const routes = t.patch.modulation && t.patch.modulation.routes;
    if (!routes) continue;
    for (const r of routes) {
      assert.ok(r.source, t.id + ': kaynak yok');
      assert.ok(r.target, t.id + ': hedef yok');
      assert.ok(typeof r.min === 'number' && typeof r.max === 'number', t.id + ': aralık eksik');
      // Efekt hedefi varsa zincirde o indis gerçekten olmalı
      const m = /^postfx\.(\d+)\./.exec(r.target);
      if (m) {
        const chain = t.patch.postfx || [];
        assert.ok(chain[+m[1]], t.id + ': ' + r.target + ' zincirde yok');
      }
    }
  }
});

// ===========================================================================
// Uygulama
// ===========================================================================
test('şablon uygulandığında sahne değişir', () => {
  const cfg = SV.defaultConfig();
  const tpl = T.TEMPLATES.find((t) => t.id === 'club-strobe');
  const out = T.apply(cfg, tpl, env);
  assert.strictEqual(out.visualizer.type, 'blocks');
  assert.strictEqual(out.background.type, 'grid');
  assert.strictEqual(out.postfx.length, 2);
  assert.strictEqual(out.modulation.routes.length, 1);
});

test('şablon KURULUM alanlarına dokunmaz', () => {
  const cfg = SV.defaultConfig();
  // Kullanıcının kurulumunu taklit et
  cfg.audio.sensitivity = 2.5;
  cfg.display.ids = [17, 42];
  cfg.stream.enabled = true;
  cfg.stream.port = 9999;
  cfg.lighting.enabled = true;
  cfg.control = cfg.control || {};
  cfg.control.midi = { enabled: true, mappings: [{ cc: 7, target: 'visualizer.glow' }] };
  cfg.power.fpsCap = 30;

  for (const tpl of T.TEMPLATES) {
    const out = T.apply(cfg, tpl, env);
    assert.strictEqual(out.audio.sensitivity, 2.5, tpl.id + ': ses ayarı bozuldu');
    assert.deepStrictEqual(out.display.ids, [17, 42], tpl.id + ': ekran seçimi bozuldu');
    assert.strictEqual(out.stream.port, 9999, tpl.id + ': yayın portu bozuldu');
    assert.strictEqual(out.lighting.enabled, true, tpl.id + ': aydınlatma bozuldu');
    assert.strictEqual(out.control.midi.mappings.length, 1, tpl.id + ': MIDI eşlemesi bozuldu');
    assert.strictEqual(out.power.fpsCap, 30, tpl.id + ': güç ayarı bozuldu');
  }
});

test('şablon kaynak yapılandırmayı DEĞİŞTİRMEZ', () => {
  const cfg = SV.defaultConfig();
  const before = JSON.stringify(cfg);
  for (const tpl of T.TEMPLATES) T.apply(cfg, tpl, env);
  assert.strictEqual(JSON.stringify(cfg), before, 'kaynak yapılandırma değişti');
});

test('önceki şablonun efektleri yenisine sızmaz', () => {
  const cfg = SV.defaultConfig();
  const heavy = T.TEMPLATES.find((t) => (t.patch.postfx || []).length >= 2);
  const clean = T.TEMPLATES.find((t) => !t.patch.postfx);
  assert.ok(heavy && clean, 'uygun şablon çifti bulunamadı');
  const a = T.apply(cfg, heavy, env);
  const b = T.apply(a, clean, env);
  assert.strictEqual(b.postfx.length, 0, 'efekt zinciri temizlenmedi');
  assert.strictEqual(b.modulation.routes.length, 0, 'yönlendirmeler temizlenmedi');
});

test('her şablon uygulandığında tam ve geçerli bir yapılandırma verir', () => {
  const cfg = SV.defaultConfig();
  const def = SV.defaultConfig();
  for (const tpl of T.TEMPLATES) {
    const out = T.apply(cfg, tpl, env);
    // Varsayılandaki her üst düzey alan sonuçta da olmalı
    for (const k of Object.keys(def)) {
      assert.ok(out[k] !== undefined, tpl.id + ': "' + k + '" alanı kayboldu');
    }
    assert.ok(Array.isArray(out.postfx), tpl.id + ': postfx dizi değil');
    assert.ok(out.visualizer && out.background, tpl.id + ': sahne eksik');
    // JSON'a yazılabilir olmalı (ayar dosyasına gidiyor)
    assert.doesNotThrow(() => JSON.stringify(out), tpl.id + ': serileştirilemiyor');
  }
});
