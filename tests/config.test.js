'use strict';
/* Yapılandırma sözleşmesinin testleri.
 *
 * Ayar dosyası uygulamanın en uzun ömürlü parçası: kullanıcı 1.3'te
 * kaydettiği dosyayı 3.0'da açıyor. Bu yüzden iki şey güvence altında olmalı:
 *
 *   1. Varsayılanların KENDİSİ tutarlı olmalı — her alan beklenen türde,
 *      sayılar sonlu, renkler geçerli, listeler dizi.
 *   2. ESKİ bir dosya açıldığında eksik alanlar varsayılanla tamamlanmalı ve
 *      kullanıcının ayarları korunmalı.
 *
 * İkincisi özellikle sinsi: eksik bir alan çalışma anında `undefined` olarak
 * dolaşır ve genellikle NaN'a dönüşüp sahneyi karartır. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;

const HEX = /^#[0-9a-fA-F]{6}$/;

// Yapılandırmayı gezerek her yaprağı ziyaret et
function walk(obj, path, visit) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = path ? path + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p, visit);
    else visit(p, v, k);
  }
}

test('varsayılan yapılandırma üretilebiliyor ve bağımsız', () => {
  const a = SV.defaultConfig();
  const b = SV.defaultConfig();
  assert.notStrictEqual(a, b, 'aynı nesne döndü');
  a.visualizer.type = 'DEĞİŞTİ';
  a.background.gradient.colors.push('#000000');
  assert.notStrictEqual(b.visualizer.type, 'DEĞİŞTİ', 'iki çağrı aynı nesneyi paylaşıyor');
  assert.ok(!b.background.gradient.colors.includes('#000000'), 'iç içe dizi paylaşılıyor');
});

test('her sayısal alan sonlu', () => {
  const cfg = SV.defaultConfig();
  const bad = [];
  walk(cfg, '', (p, v) => {
    if (typeof v === 'number' && !isFinite(v)) bad.push(p + ' = ' + v);
  });
  assert.deepStrictEqual(bad, [], 'sonsuz/NaN alanlar: ' + bad.join(', '));
});

test('renk alanları geçerli altı haneli hex', () => {
  const cfg = SV.defaultConfig();
  const bad = [];
  /* Ölçüt anahtar adı değil DEĞERİN kendisi: "#" ile başlayan her dize renk
     olmak zorunda. Anahtara bakmak "colorMode: palette" gibi alanları renk
     sanardı. */
  walk(cfg, '', (p, v) => {
    if (typeof v !== 'string' || v[0] !== '#') return;
    if (!HEX.test(v)) bad.push(p + ' = ' + v);
  });
  assert.deepStrictEqual(bad, [], 'geçersiz renkler: ' + bad.join(', '));
});

test('palet dizileri geçerli', () => {
  const cfg = SV.defaultConfig();
  const cols = cfg.background.gradient.colors;
  assert.ok(Array.isArray(cols) && cols.length >= 2, 'palet en az iki renk olmalı');
  for (const c of cols) assert.ok(HEX.test(c), 'geçersiz palet rengi: ' + c);
  for (const preset of SV.GRADIENT_PRESETS) {
    if (preset.group) continue; // grup ayırıcısı
    assert.ok(preset.name, 'şablon adı yok');
    assert.ok(Array.isArray(preset.colors) && preset.colors.length >= 2, preset.name + ': renk yok');
    for (const c of preset.colors) assert.ok(HEX.test(c), preset.name + ': geçersiz renk ' + c);
  }
});

test('liste alanları gerçekten dizi', () => {
  const cfg = SV.defaultConfig();
  for (const k of ['layers', 'postfx']) {
    assert.ok(Array.isArray(cfg[k]), k + ' dizi olmalı');
  }
  assert.ok(Array.isArray(cfg.modulation.routes), 'modulation.routes dizi olmalı');
  assert.ok(Array.isArray(cfg.modulation.lfos), 'modulation.lfos dizi olmalı');
  assert.ok(Array.isArray(cfg.modulation.macros), 'modulation.macros dizi olmalı');
  assert.ok(Array.isArray(cfg.display.ids), 'display.ids dizi olmalı');
});

test('3.0 motorlarının hepsi varsayılanlarda var', () => {
  const cfg = SV.defaultConfig();
  for (const k of ['modulation', 'transition', 'mapping', 'milkdrop', 'recording',
    'text', 'layerGroups', 'crossfade', 'geometry', 'artnet', 'autovj']) {
    assert.ok(cfg[k] !== undefined, 'eksik alan: ' + k);
  }
});

// ===========================================================================
// deepMerge — eski dosyaların yükseltilmesi buna dayanıyor
// ===========================================================================
test('deepMerge eksik alanları varsayılanla tamamlar', () => {
  const def = SV.defaultConfig();
  const old = { visualizer: { type: 'wave' } };
  const out = SV.deepMerge(def, old);
  assert.strictEqual(out.visualizer.type, 'wave', 'kullanıcı değeri korunmadı');
  assert.strictEqual(out.visualizer.barCount, def.visualizer.barCount, 'eksik alan tamamlanmadı');
  assert.ok(out.modulation, 'yeni motor alanı gelmedi');
});

test('deepMerge kaynakları değiştirmez', () => {
  const def = SV.defaultConfig();
  const snapshot = JSON.stringify(def);
  const old = { audio: { sensitivity: 3 } };
  SV.deepMerge(def, old);
  assert.strictEqual(JSON.stringify(def), snapshot, 'varsayılanlar değişti');
  assert.deepStrictEqual(old, { audio: { sensitivity: 3 } }, 'girdi değişti');
});

test('deepMerge diziyi BİRLEŞTİRMEZ, değiştirir', () => {
  /* Bilinçli: kullanıcının efekt zinciri varsayılanın üstüne eklenmemeli.
     Birleştirseydi her açılışta zincir uzardı. */
  const def = SV.defaultConfig();
  const out = SV.deepMerge(def, { background: { gradient: { colors: ['#111111', '#222222'] } } });
  assert.deepStrictEqual(out.background.gradient.colors, ['#111111', '#222222']);
});

// ===========================================================================
// Eski sürüm dosyaları
// ===========================================================================
const V13 = {
  visualizer: { type: 'bars', barCount: 120, color: '#ff0000' },
  background: { type: 'starfield', gradient: { colors: ['#101020', '#4040ff'] } },
  audio: { sensitivity: 1.9, smoothing: 0.7 },
  display: { id: 3 },
  logo: { enabled: true, scale: 0.3 },
};

const V20 = Object.assign({}, V13, {
  custom: { visualizerId: 'sh_plasma' },
  stream: { enabled: true, port: 8787 },
  control: { midi: { enabled: true } },
  display: { ids: [3, 5] },
});

test('1.3 ayar dosyası kaybetmeden yükseltilir', () => {
  const out = SV.deepMerge(SV.defaultConfig(), V13);
  assert.strictEqual(out.visualizer.type, 'bars');
  assert.strictEqual(out.visualizer.barCount, 120);
  assert.strictEqual(out.visualizer.color, '#ff0000');
  assert.strictEqual(out.audio.sensitivity, 1.9);
  assert.strictEqual(out.logo.enabled, true);
  assert.deepStrictEqual(out.background.gradient.colors, ['#101020', '#4040ff']);
  // Yeni motorlar varsayılanlarıyla gelmeli
  assert.ok(out.modulation && Array.isArray(out.modulation.routes));
  assert.ok(out.transition && out.transition.type);
  assert.ok(out.mapping && out.mapping.outputs);
});

test('2.0 ayar dosyası kaybetmeden yükseltilir', () => {
  const out = SV.deepMerge(SV.defaultConfig(), V20);
  assert.strictEqual(out.custom.visualizerId, 'sh_plasma');
  assert.strictEqual(out.stream.port, 8787);
  assert.deepStrictEqual(out.display.ids, [3, 5]);
  assert.strictEqual(out.control.midi.enabled, true);
  assert.ok(out.text && out.text.source, 'metin motoru gelmedi');
});

test('yükseltilen yapılandırmada sayısal alanlar hâlâ sonlu', () => {
  for (const old of [V13, V20, {}, { visualizer: null }, { audio: 'çöp' }]) {
    const out = SV.deepMerge(SV.defaultConfig(), old);
    const bad = [];
    walk(out, '', (p, v) => {
      if (typeof v === 'number' && !isFinite(v)) bad.push(p);
    });
    assert.deepStrictEqual(bad, [], 'sonsuz alan: ' + bad.join(', '));
  }
});

test('bozuk girdiler çökme yaratmaz', () => {
  for (const bad of [null, undefined, 0, '', [], 'metin', { visualizer: 42 }, { background: [] }]) {
    assert.doesNotThrow(() => {
      const out = SV.deepMerge(SV.defaultConfig(), bad);
      JSON.stringify(out);
    }, 'girdi: ' + JSON.stringify(bad));
  }
});

// ===========================================================================
// clone
// ===========================================================================
test('clone derin kopya üretir', () => {
  const cfg = SV.defaultConfig();
  const copy = SV.clone(cfg);
  copy.background.gradient.colors.push('#abcdef');
  copy.visualizer.type = 'x';
  assert.notStrictEqual(cfg.visualizer.type, 'x');
  assert.ok(!cfg.background.gradient.colors.includes('#abcdef'));
});

test('hexToRgb01 geçerli ve bozuk girdilerde sonlu', () => {
  const ok = SV.hexToRgb01('#3aa6ff');
  assert.strictEqual(ok.length, 3);
  for (const v of ok) assert.ok(v >= 0 && v <= 1, 'aralık dışı: ' + v);
  for (const bad of ['', 'çöp', '#xyz', null, undefined, '#fff']) {
    const r = SV.hexToRgb01(bad);
    assert.ok(Array.isArray(r) && r.length === 3, 'dizi değil: ' + bad);
    for (const v of r) assert.ok(isFinite(v), 'sonsuz: ' + bad);
  }
});

// ===========================================================================
// Kaza koruması
//
// Bu iki anahtarın varsayılanı KAPALI olmak zorunda. Açık gelselerdi,
// uygulamayı ilk kez açan biri görselleştirme penceresini kapatamaz ve
// nedenini de bilemezdi. Varsayılanı yanlışlıkla değiştiren bir düzenleme
// burada yakalanır.
// ===========================================================================
test('kaza koruması varsayılan olarak kapalı', () => {
  const cfg = SV.defaultConfig();
  assert.strictEqual(cfg.power.protect, false, 'protect açık geliyor');
  assert.strictEqual(cfg.power.protectNoEscape, false, 'protectNoEscape açık geliyor');
});

test('eski ayar dosyası kaza koruması alanlarıyla tamamlanır', () => {
  /* 3.1 öncesinden kalan bir settings.json bu alanları içermez. Eksik
     kalırlarsa main.js tarafında undefined okunur; !!undefined === false
     olduğu için davranış doğru olurdu, ama panel anahtarı da boş görünür
     ve kullanıcı ayarı açtığında hiçbir şey olmaz. */
  const old = { power: { alwaysOnTop: true, fpsCap: 60 } };
  const merged = SV.deepMerge(SV.defaultConfig(), old);
  assert.strictEqual(merged.power.protect, false);
  assert.strictEqual(merged.power.protectNoEscape, false);
  assert.strictEqual(merged.power.alwaysOnTop, true, 'kullanıcının ayarı korunmalı');
  assert.strictEqual(merged.power.fpsCap, 60, 'kullanıcının ayarı korunmalı');
});

test('kaza koruması ayarları kaydedilip geri yüklenince korunur', () => {
  const cfg = SV.defaultConfig();
  cfg.power.protect = true;
  cfg.power.protectNoEscape = true;
  const roundTrip = SV.deepMerge(SV.defaultConfig(), JSON.parse(JSON.stringify(cfg)));
  assert.strictEqual(roundTrip.power.protect, true);
  assert.strictEqual(roundTrip.power.protectNoEscape, true);
});

// ===========================================================================
// Gösteri verisi sahneye ait DEĞİLDİR
//
// Bir sahneyi uygulamak, o sahnede saklanan her anahtarı yapılandırmaya
// yazar. Zaman çizelgesi ve klip destesi bu listeye girerse, kullanıcı bir
// sahneye tıkladığında bütün gösterisini kaybeder ve geri alma yolu olmaz.
// Bu testin varlık sebebi tek: o listeye yanlışlıkla eklenmelerini yakalamak.
// ===========================================================================
test('zaman çizelgesi ve klip destesi sahne anahtarlarında YER ALMAZ', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf-8');
  const m = src.match(/const SCENE_KEYS = \[([\s\S]*?)\];/);
  assert.ok(m, 'SCENE_KEYS bulunamadı — test güncellenmeli');
  const keys = m[1].split(/[,\s]+/).map((x) => x.replace(/['\"]/g, '').trim()).filter(Boolean);
  assert.ok(keys.indexOf('timeline') === -1, 'timeline sahne anahtarı olmamalı');
  assert.ok(keys.indexOf('clipdeck') === -1, 'clipdeck sahne anahtarı olmamalı');
  assert.ok(keys.indexOf('visualizer') >= 0, 'test kendini doğruluyor: visualizer listede olmalı');
});

test('v3.0.0 ayar dosyası gösteri alanlarıyla tamamlanır, sahneler bozulmaz', () => {
  /* Kullanıcının kaydettiği dosyada timeline/clipdeck YOKTUR. Eksik alanlar
     varsayılanla dolarken kullanıcının sahnelerine dokunulmamalı. */
  const saved = {
    scenes: [{ id: 's1', name: 'Kulüp', data: { visualizer: { type: 'bars' } } }],
    background: { type: 'solid', solidColor: '#123456' },
  };
  const merged = SV.deepMerge(SV.defaultConfig(), saved);
  assert.ok(merged.timeline, 'timeline eklenmeli');
  assert.ok(merged.clipdeck, 'clipdeck eklenmeli');
  assert.strictEqual(merged.timeline.enabled, false);
  assert.strictEqual(merged.clipdeck.enabled, false);
  assert.strictEqual(merged.scenes.length, 1, 'sahneler korunmalı');
  assert.strictEqual(merged.scenes[0].name, 'Kulüp');
  assert.strictEqual(merged.background.solidColor, '#123456', 'kullanıcının rengi korunmalı');
});

test('gösteri verisi JSON turundan sağ çıkar', () => {
  const cfg = SV.defaultConfig();
  cfg.timeline.enabled = true;
  cfg.timeline.tracks = [{ kind: 'clip', clips: [{ start: 1, dur: 2 }] }];
  cfg.clipdeck.decks[0].slots = [{ row: 0, col: 0, type: 'scene', ref: 's1' }];
  const back = SV.deepMerge(SV.defaultConfig(), JSON.parse(JSON.stringify(cfg)));
  assert.strictEqual(back.timeline.enabled, true);
  assert.strictEqual(back.timeline.tracks.length, 1);
  assert.strictEqual(back.clipdeck.decks[0].slots.length, 1);
  assert.strictEqual(back.clipdeck.decks[0].slots[0].ref, 's1');
});
