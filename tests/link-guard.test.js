'use strict';
/* Telefonun ayar yazımının bekçisi (src/main/link-guard.js): izinli anahtarlar ve düzey, bu
 * makineye ait anahtarların hiçbir düzeyde yazılamaması, tür, YENİ DOSYA YOLU yasağı (var olanı
 * taşımak serbest), masaüstüne özgü katmanlar, kilitli katman, etkin sahne ve aralık sıkıştırma. */
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/main/link-guard.js');

const cur = () => ({
  master: 1,
  visualizer: { type: 'bars', barHeight: 0.5 },
  media: { file: 'C:\\Users\\pc\\Videos\\loop.mp4', enabled: true },
  logo: { src: 'data:image/png;base64,AAAA' },
  scenes: [{ id: 'sc_1', name: 'Gece' }],
  layers: [
    { id: 'l_bg', kind: 'background', type: 'gradient', settings: { background: {} } },
    { id: 'l_lock', kind: 'visualizer', type: 'bars', locked: true, settings: { visualizer: { barHeight: 0.4 } } },
    { id: 'l_web', kind: 'web', opacity: 1, settings: { web: { url: 'https://example.org/' } } },
    { id: 'l_media', kind: 'media', settings: { media: { file: 'C:\\Users\\pc\\Videos\\loop.mp4' } } },
  ],
  stream: { token: 'gizli' },
  audio: { source: 'system' },
});
const clone = (x) => JSON.parse(JSON.stringify(x));
const no = (r, error, key) => { assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.strictEqual(r.error, error); if (key) assert.strictEqual(r.key, key); };

test('Anahtarlar: düzenleme düzeyi sahne ve çizelge alanları; tam düzey çıkışlar; bazıları hiçbir düzeyde', () => {
  assert.ok(G.check({ visualizer: { type: 'wave' } }, cur(), 'edit').ok);
  assert.ok(G.check({ timeline: { tracks: [] } }, cur(), 'edit').ok);
  no(G.check({ audio: { source: 'mic' } }, cur(), 'edit'), 'not-allowed', 'audio');
  assert.ok(G.check({ audio: { source: 'mic' } }, cur(), 'full').ok);
  for (const k of ['stream', 'phoneLink', 'mcp', 'redundancy', 'bridge', 'mqtt', 'control', 'scenes', 'milkdropLibrary', 'updates', 'version', 'ui']) {
    no(G.check({ [k]: {} }, cur(), 'full'), 'not-allowed', k);
  }
  no(G.check({}, cur(), 'full'), 'bad-args');
  no(G.check([], cur(), 'full'), 'bad-args');
  no(G.check(JSON.parse('{"__proto__": {"x": 1}}'), cur(), 'full'), 'bad-args');
});

test('Tür ve yapı: dizi yerine metin, sonsuz sayı, iç içe __proto__ reddedilir', () => {
  no(G.check({ layers: 'hepsi' }, cur(), 'edit'), 'type', 'layers');
  no(G.check({ visualizer: [] }, cur(), 'edit'), 'type');
  no(G.check({ master: Infinity }, cur(), 'edit'), 'type');
  no(G.check({ visualizer: JSON.parse('{"a": {"__proto__": {"x": 1}}}') }, cur(), 'edit'), 'bad-args');
  let deep = {};
  const root = deep;
  for (let i = 0; i < 40; i++) { deep.a = {}; deep = deep.a; }
  no(G.check({ visualizer: root }, cur(), 'edit'), 'too-big');
});

test('Dosya yolu: yeni yol yazılamaz, var olan yol taşınabilir; data: adresi ve üst klasör', () => {
  no(G.check({ media: { file: 'C:\\Windows\\System32\\config\\SAM' } }, cur(), 'edit'), 'path', 'media');
  no(G.check({ media: { file: '\\\\sunucu\\pay\\a.mp4' } }, cur(), 'edit'), 'path');
  no(G.check({ media: { file: 'file:///etc/passwd' } }, cur(), 'edit'), 'path');
  no(G.check({ text: { font: '../../../secret.ttf' } }, cur(), 'edit'), 'path');
  no(G.check({ media: { file: '/home/pc/.ssh/id_rsa' } }, cur(), 'edit'), 'path');
  // Aynı yol başka katmana kopyalanabilir (telefon kitaplıktaki dosyayı yeniden kullanıyor)
  const layers = clone(cur().layers);
  layers.push({ id: 'l_copy', kind: 'media', settings: { media: { file: 'C:\\Users\\pc\\Videos\\loop.mp4' } } });
  assert.ok(G.check({ layers }, cur(), 'edit').ok);
  assert.ok(G.check({ logo: { src: 'data:image/png;base64,BBBB' } }, cur(), 'edit').ok);
  // Eğik çizgiyle başlayan ama yol alanı olmayan metin (OSC öneki gibi) yol sayılmaz
  assert.ok(G.check({ oscOut: { prefix: '/cayadev/show' } }, cur(), 'full').ok);
  assert.strictEqual(G.pathLike('file', '/home/pc/a.mp4'), true);
  assert.strictEqual(G.pathLike('prefix', '/cayadev/x'), false);
});

test('Masaüstüne özgü katman: içi değişmez, yenisi eklenmez; saydamlığı ve sırası serbest', () => {
  let layers = clone(cur().layers);
  layers[2].settings.web.url = 'https://kotu.example/';
  no(G.check({ layers }, cur(), 'full'), 'needs-pc', 'layers');
  layers = clone(cur().layers);
  layers.push({ id: 'l_new_web', kind: 'web', settings: { web: { url: 'https://example.org/' } } });
  no(G.check({ layers }, cur(), 'full'), 'needs-pc');
  layers = clone(cur().layers);
  layers[2].opacity = 0.3;
  layers[2].enabled = false;
  assert.ok(G.check({ layers }, cur(), 'edit').ok);
});

test('Kilitli katman: silinmez, öbür katmanlara göre yeri değişmez; kilit açmak ve yeni katman serbest', () => {
  let layers = clone(cur().layers).filter((l) => l.id !== 'l_lock');
  no(G.check({ layers }, cur(), 'edit'), 'locked');
  layers = clone(cur().layers);
  [layers[1], layers[0]] = [layers[0], layers[1]];
  no(G.check({ layers }, cur(), 'edit'), 'locked');
  layers = clone(cur().layers);
  layers[1].locked = false;
  [layers[1], layers[0]] = [layers[0], layers[1]];
  assert.ok(G.check({ layers }, cur(), 'edit').ok, 'kilidi açılan katman taşınabilir');
  layers = clone(cur().layers);
  layers.unshift({ id: 'l_yeni', kind: 'visualizer', type: 'wave' });
  layers[2].settings.visualizer.barHeight = 0.9; // kilitli katmanın ayarı değişebilir
  assert.ok(G.check({ layers }, cur(), 'edit').ok);
});

test('Etkin sahne yalnız var olan sahne; aralıklar şemadan sıkıştırılır (katman ayarı dahil)', () => {
  assert.ok(G.check({ _activeSceneId: 'sc_1' }, cur(), 'edit').ok);
  assert.ok(G.check({ _activeSceneId: null }, cur(), 'edit').ok);
  no(G.check({ _activeSceneId: 'sc_9' }, cur(), 'edit'), 'scene');
  const r = G.check({ master: 4, visualizer: { barHeight: 50 } }, cur(), 'edit');
  assert.strictEqual(r.patch.master, 1, 'genişletilmeyen üst sınır');
  assert.strictEqual(r.patch.visualizer.barHeight, 5, 'genişletilmiş üst sınır (5×)');
  const layers = clone(cur().layers);
  layers[1].settings.visualizer.barHeight = -3;
  assert.strictEqual(G.check({ layers }, cur(), 'edit').patch.layers[1].settings.visualizer.barHeight, 0.05);
  // Sonuç kopyadır: telefonun nesnesi sonradan değişse de uygulanan değişmez
  const p = { visualizer: { type: 'wave' } };
  const out = G.check(p, cur(), 'edit').patch;
  p.visualizer.type = 'bars';
  assert.strictEqual(out.visualizer.type, 'wave');
});

test('Sahne verisi: yalnız sahneye ait anahtarlar, aynı kurallarla', () => {
  assert.ok(G.checkSceneData({ visualizer: { type: 'wave' }, layers: clone(cur().layers) }, cur()).ok);
  no(G.checkSceneData({ timeline: {} }, cur()), 'not-allowed', 'timeline');
  no(G.checkSceneData({ media: { file: 'D:\\gizli.mp4' } }, cur()), 'path');
  no(G.checkSceneData(null, cur()), 'bad-args');
});

test('Masaüstüne özgü katman telefondan silinemez (tanımayan düzenleyici düşürse de)', () => {
  const layers = clone(cur().layers).filter((l) => l.kind !== 'web');
  no(G.check({ layers }, cur(), 'full'), 'needs-pc', 'layers');
  // Öbür katmanı silmek serbest
  const keep = clone(cur().layers).filter((l) => l.id !== 'l_media');
  assert.ok(G.check({ layers: keep }, cur(), 'edit').ok);
});
