'use strict';
/* Yayın katmanı tanı kartı (#565).
 *
 * Kartın içeriği saf bir fonksiyondan geliyor (describe) ve burada DOM'suz
 * sınanıyor. Sayfaya kurulumu ve gerçek sayaçlar öz testte, gerçek yayın
 * sunucusundan açılan sayfada denetleniyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const D = require('../src/web/overlay-diag.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const joined = (row) => row.parts.map((p) => p.text).join('');
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

const NOW = 1_000_000;
const healthy = {
  status: 'connected', attempts: 1, app: 'CAYADEV Visualizer', version: '3.1.5',
  configs: 2, lastConfigAt: NOW - 400, audioFrames: 900, lastAudioAt: NOW - 16, sampleRate: 48000,
  transparency: 'app', appTransparent: true, blackout: false,
};
const measured = { now: NOW, audioFps: 59.6, renderFps: 60.2, canvasW: 1920, canvasH: 1080, error: null };

test('kart yalnız debug=1 ile açılıyor', () => {
  assert.strictEqual(D.enabled('?debug=1'), true);
  assert.strictEqual(D.enabled('?transparent=0&debug=1'), true);
  assert.strictEqual(D.enabled('?debug=1&fps=30'), true);
  assert.strictEqual(D.enabled('?debug=10'), false);
  assert.strictEqual(D.enabled('?xdebug=1'), false);
  assert.strictEqual(D.enabled('?debug=0'), false);
  assert.strictEqual(D.enabled(''), false);
  assert.strictEqual(D.enabled(undefined), false);
});

test('bayrak yoksa kurulum sayfaya dokunmuyor', () => {
  let touched = 0;
  const original = () => {};
  const win = {
    location: { search: '?transparent=0' },
    document: {},
    console: { error: original },
    addEventListener: () => { touched++; },
    requestAnimationFrame: () => { touched++; },
    setInterval: () => { touched++; },
  };
  assert.strictEqual(D.install(win), null);
  assert.strictEqual(touched, 0, 'dinleyici, döngü ya da zamanlayıcı kuruldu');
  assert.strictEqual(win.console.error, original, 'console.error sarıldı');
});

test('süre parçalı: sayı ve birim ayrı düğüm', () => {
  assert.deepStrictEqual(D.ago(400).map((p) => p.text), ['0.4', ' ', 'sn önce']);
  assert.deepStrictEqual(D.ago(12400).map((p) => p.text), ['12', ' ', 'sn önce']);
  assert.deepStrictEqual(D.ago(125000).map((p) => p.text), ['2', ' ', 'dk önce']);
  assert.deepStrictEqual(D.ago(-50).map((p) => p.text), ['0.0', ' ', 'sn önce']);
});

test('saniyelik hız iki sayaç örneğinden', () => {
  assert.strictEqual(D.rate({ count: 100, at: 0 }, { count: 160, at: 1000 }), 60);
  assert.strictEqual(D.rate({ count: 100, at: 0 }, { count: 130, at: 500 }), 60);
  assert.strictEqual(D.rate(null, { count: 1, at: 1 }), 0);
  assert.strictEqual(D.rate({ count: 5, at: 10 }, { count: 9, at: 10 }), 0, 'sıfır aralık');
  assert.strictEqual(D.rate({ count: 9, at: 0 }, { count: 5, at: 1000 }), 0, 'sayaç geri gidemez');
});

test('sağlıklı sayfa: yedi satır, hepsi yeşil ve sırası sabit', () => {
  const rows = D.describe(healthy, measured);
  assert.deepStrictEqual(rows.map((r) => r.key),
    ['connection', 'configuration', 'audio', 'rendering', 'transparency', 'version', 'lastError']);
  for (const r of rows) assert.strictEqual(r.level, 'ok', r.key + ' yeşil değil');
  const k = byKey(rows);
  assert.strictEqual(joined(k.connection), 'bağlı');
  assert.strictEqual(joined(k.configuration), 'geldi · 0.4 sn önce');
  assert.strictEqual(joined(k.audio), '60 kare/sn · son kare 0.0 sn önce · 48000 Hz');
  assert.strictEqual(joined(k.rendering), '60 kare/sn · 1920×1080');
  assert.strictEqual(joined(k.transparency), 'uygulama ayarı · Açık');
  assert.strictEqual(joined(k.version), 'CAYADEV Visualizer 3.1.5');
  assert.strictEqual(joined(k.lastError), 'yok');
});

test('boş yayının üç sebebi ayrı satırda görünüyor', () => {
  const k = byKey(D.describe({ status: 'closed', attempts: 4, configs: 0, audioFrames: 0 },
    { now: NOW, audioFps: 0, renderFps: 0, canvasW: 2, canvasH: 2, error: null }));
  assert.strictEqual(joined(k.connection), 'bağlantı yok · 4 deneme');
  assert.strictEqual(k.connection.level, 'bad');
  assert.strictEqual(joined(k.configuration), 'gelmedi');
  assert.strictEqual(k.configuration.level, 'bad');
  assert.strictEqual(joined(k.audio), 'ses karesi gelmedi');
  assert.strictEqual(k.audio.level, 'warn');
  assert.strictEqual(k.rendering.level, 'bad', '2×2 tuval sayfanın başlamadığı demek (v3.1.3)');
  assert.strictEqual(joined(k.version), '—');
});

test('bağlantı hatası ve ilk deneme', () => {
  assert.strictEqual(joined(byKey(D.describe({ status: 'error', attempts: 1 }, measured)).connection), 'bağlantı hatası');
  const first = byKey(D.describe({ status: 'connecting', attempts: 1 }, measured)).connection;
  assert.strictEqual(joined(first), 'bağlanıyor');
  assert.strictEqual(first.level, 'warn');
});

test('ses kesilince satır uyarı rengine dönüyor', () => {
  const k = byKey(D.describe(Object.assign({}, healthy, { lastAudioAt: NOW - D.AUDIO_STALE_MS - 1 }), measured));
  assert.strictEqual(k.audio.level, 'warn');
});

test('şeffaflık: URL zorlaması, uygulama anahtarı ve karartma', () => {
  const tr = (patch) => joined(byKey(D.describe(Object.assign({}, healthy, patch), measured)).transparency);
  assert.strictEqual(tr({ transparency: 'forced-opaque' }), '?transparent=0 · Kapalı');
  assert.strictEqual(tr({ transparency: 'forced-transparent' }), '?transparent=1 · Açık');
  assert.strictEqual(tr({ transparency: 'app', appTransparent: false }), 'uygulama ayarı · Kapalı');
  assert.strictEqual(tr({ blackout: true }), 'karartma');
});

test('son hata: yüklenemeyen betik ve çalışma hatası', () => {
  const load = byKey(D.describe(healthy, Object.assign({}, measured,
    { error: { kind: 'load', text: 'http://127.0.0.1:8722/app/shared/aspect.js', at: NOW - 3000 } })));
  assert.strictEqual(joined(load.lastError), 'yüklenemedi http://127.0.0.1:8722/app/shared/aspect.js · 3.0 sn önce');
  assert.strictEqual(load.lastError.level, 'bad');
  const run = byKey(D.describe(healthy, Object.assign({}, measured,
    { error: { kind: 'error', text: 'Cannot read properties of undefined', at: NOW } })));
  assert.strictEqual(joined(run.lastError), 'Cannot read properties of undefined · 0.0 sn önce');
});

test('kartın bütün sabit metinleri sözlükte', () => {
  const src = read('src/shared/i18n.js');
  const doc = { documentElement: { lang: '' }, readyState: 'complete', title: '', body: {}, addEventListener: () => {} };
  const win = {
    navigator: { languages: ['en-US'], language: 'en-US' },
    localStorage: { getItem: () => 'en', setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(src, vm.createContext(win), { filename: 'i18n.js' });
  const t = win.SVI18n.t;
  const words = Object.values(D.WORDS);
  assert.ok(words.length >= 25);
  const missing = words.filter((w) => t(w) === w);
  assert.deepStrictEqual(missing, [], 'çevrilmemiş: ' + JSON.stringify(missing));
  assert.strictEqual(t(D.WORDS.transparency), 'Transparent Background', "'Saydamlık' opaklık demek; bu satır şeffaf arkaplan");
});

test('bağlantılar: sayfa, köprü, sunucu ve öz test', () => {
  const html = read('src/web/overlay.html');
  const srcs = Array.from(html.matchAll(/<script\s+src="([^"]+)"/g)).map((m) => m[1]);
  const i18n = srcs.indexOf('/app/shared/i18n.js');
  assert.strictEqual(srcs[i18n + 1], '/app/web/overlay-diag.js',
    'kart i18n.js\'ten hemen sonra, öteki betiklerden önce yüklenmeli (yüklenemeyen betiği yakalamak için)');

  const shim = read('src/web/web-shim.js');
  assert.match(shim, /window\.SVOverlayStatus = status;/);
  assert.match(shim, /msg\.type === 'hello'\) \{\s*status\.app = [^;]+;\s*status\.version = /);
  assert.match(shim, /status\.configs\+\+;\s*status\.lastConfigAt = Date\.now\(\);/);
  assert.match(shim, /status\.audioFrames\+\+;\s*status\.lastAudioAt = Date\.now\(\);/);
  assert.match(shim, /function setStatus\(s\) \{\s*status\.status = s;/);
  assert.match(shim, /status\.attempts\+\+;/);

  const server = read('src/main/stream-server.js');
  assert.match(server, /version: typeof hooks\.getVersion === 'function' \? String\(hooks\.getVersion\(\) \|\| ''\) : ''/);
  const main = read('src/main/main.js');
  assert.match(main, /getVersion: \(\) => app\.getVersion\(\),/);
  assert.match(main, /'\/\?transparent=0&debug=1'/, 'öz test kartı açmıyor');
  assert.match(main, /errors\.push\('overlay diagnostics: \?debug=1 did not show the card'\)/);
});
