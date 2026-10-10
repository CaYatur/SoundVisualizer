'use strict';
/* Dış gözden geçirme, ikinci tur (10.10, ffce67b üzerinde) — yeni bulgular
   Y1–Y13 ve kısmen kalan UX 7 (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
// Windows'ta çalışma kopyası CRLF olabilir; gövde ayıklama LF bekliyor
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const mcp = require('../src/shared/mcp.js');
const server = require('../src/main/mcp-server.js');
const T = require('../src/shared/templates.js');

function ctx(extra) {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  const store = new Map();
  return Object.assign({
    cfg,
    store,
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => 1,
    revision: () => 1,
    presets: {
      list: () => Array.from(store.values()),
      get: (id) => store.get(id) || null,
      save: (p) => { const q = Object.assign({}, p, { id: p.id || 'usr_new' }); store.set(q.id, q); return { ok: true, preset: q }; },
      remove: (id) => { store.delete(id); return { ok: true }; },
    },
  }, extra || {});
}
const call = (name, args, c) => Promise.resolve(mcp.callTool(name, args, c));
function stack(c, n, lockedAt) {
  c.cfg.layerStack = { enabled: true };
  c.cfg.layers = [];
  for (let i = 0; i < n; i++) {
    c.cfg.layers.push({ id: 'L' + i, name: 'K' + i, kind: 'visualizer', type: 'bars', opacity: 1, locked: i === lockedAt, transform: { x: 0, y: 0, scale: 1, rotate: 0 }, settings: {}, postfx: [{ id: 'f' + i, type: 'bloom', enabled: true, params: {} }] });
  }
  return c;
}
function fnBody(src, name) {
  const at = src.indexOf(name);
  assert.ok(at >= 0, name);
  return src.slice(at, src.indexOf('\n  }\n', at));
}
function loadEnglish() {
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/i18n.js'), 'utf8');
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
  return win.SVI18n;
}

/* Tür denetimi uygulamanın kendi yazdığını reddetmemeli: varsayılanlar,
   72 hazır şablon ve gerçekçi bir ayar dosyası tarandı. Aynı yolda iki tür
   yalnız "null ile değer" olarak görüldü (display.id, layerStack.enabled,
   mapping.outputs.*); hepsi yazılabilir. */
test('tür denetimi uygulamanın ürettiği değer çiftlerini kabul eder', async () => {
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const seen = {};
  const walk = (o, p, depth) => {
    if (depth > 6) return;
    const k = kind(o);
    (seen[p] = seen[p] || new Set()).add(k);
    if (k === 'object') for (const key of Object.keys(o)) walk(o[key], p ? p + '.' + key : key, depth + 1);
  };
  const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
  walk(SV.defaultConfig(), '', 0);
  for (const t of T.TEMPLATES) walk(T.apply(SV.defaultConfig(), t, env), '', 0);
  const multi = Object.keys(seen).filter((p) => p && seen[p].size > 1);
  for (const p of multi) {
    const kinds = Array.from(seen[p]);
    assert.ok(kinds.length === 2 && kinds.indexOf('null') >= 0, p + ': ' + kinds.join('/'));
  }
  // Her iki yönde yazılabilir
  const c = ctx();
  c.cfg.display = Object.assign({}, c.cfg.display, { id: 5 });
  assert.strictEqual((await call('sv_patch_config', { path: 'display.id', value: null }, c)).ok, true);
  assert.strictEqual((await call('sv_patch_config', { path: 'display.id', value: 7 }, c)).ok, true);
  c.cfg.layerStack = { enabled: true };
  assert.strictEqual((await call('sv_patch_config', { path: 'layerStack.enabled', value: null }, c)).ok, true);
  c.cfg.mapping = { enabled: false, outputs: { default: { enabled: true } } };
  assert.strictEqual((await call('sv_patch_config', { path: 'mapping.outputs.default', value: null }, c)).ok, true);
  // Liste ve nesne null yapılamaz
  c.cfg.layers = [];
  assert.strictEqual((await call('sv_patch_config', { path: 'layers', value: null }, c)).ok, false);
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer', value: null }, c)).ok, false);
});

/* Y1: üst anahtar yanlış türde yazılabiliyordu: "layers":"x" katmanları
   metne çevirip ayar dosyasına kaydediyordu. */
test('sv_patch_config değerin türünü var olan değerle karşılaştırır', async () => {
  const c = stack(ctx(), 2);
  for (const [p, v] of [['layers', 'x'], ['layers', {}], ['visualizer.sensitivity', 'abc'], ['visualizer.sensitivity', Infinity], ['visualizer', 3], ['layers.0.opacity', '0.5'], ['background.gradient.colors', '#fff']]) {
    const r = await call('sv_patch_config', { path: p, value: v }, c);
    assert.strictEqual(r.ok, false, p + ' = ' + JSON.stringify(v));
  }
  assert.ok(Array.isArray(c.cfg.layers) && c.cfg.layers.length === 2);
  assert.strictEqual(typeof c.cfg.visualizer.sensitivity, 'number');
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.sensitivity', value: 1.7 }, c)).ok, true);
  assert.strictEqual(c.cfg.visualizer.sensitivity, 1.7);
  assert.strictEqual((await call('sv_patch_config', { path: 'layers.1.opacity', value: 0.4 }, c)).ok, true);
  // Değeri olmayan (yeni) alan ve null olan alan serbest
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.yeniAlan', value: 'x' }, c)).ok, true);
  c.cfg.media.file = null;
  assert.strictEqual((await call('sv_patch_config', { path: 'media.file', value: 'sv-media://local/a.mp4' }, c)).ok, true);
});

/* Y4: MCP kilide bakmıyordu: kilitli katman silinip değiştirilebiliyordu. */
test('MCP katman araçları kilide uyar; görünürlük, solo, sessiz ve kilit serbest', async () => {
  const c = stack(ctx(), 3, 1);
  const before = JSON.stringify(c.cfg.layers[1]);
  const refused = [
    ['sv_remove_layer', { id: 'L1' }],
    ['sv_update_layer', { id: 'L1', patch: { opacity: 0.3 } }],
    ['sv_update_layer', { id: 'L1', patch: { type: 'wave' } }],
    ['sv_set_layer_position', { id: 'L1', x: 0.5 }],
    ['sv_set_layer_settings', { id: 'L1', key: 'k', value: 1 }],
    ['sv_add_layer_effect', { id: 'L1', type: 'grain' }],
    ['sv_remove_layer_effect', { id: 'L1', effectId: 'f1' }],
    ['sv_set_layer_effect_param', { id: 'L1', effectId: 'f1', params: { intensity: 2 } }],
    ['sv_set_layer_effect_enabled', { id: 'L1', effectId: 'f1', enabled: false }],
    ['sv_reorder_layers', { ids: ['L1', 'L0', 'L2'] }],
    ['sv_reorder_layers', { ids: ['L2', 'L0'] }],
    ['sv_patch_config', { path: 'layers.1.opacity', value: 0.2 }],
    ['sv_patch_config', { path: 'layers.1', value: { id: 'L1' } }],
  ];
  for (const [name, args] of refused) {
    const r = await call(name, args, c);
    assert.strictEqual(r.ok, false, name + ' ' + JSON.stringify(args));
    assert.match(r.error, /locked/i);
  }
  const layersVal = JSON.parse(JSON.stringify(c.cfg.layers));
  layersVal[1].opacity = 0.1;
  assert.strictEqual((await call('sv_patch_config', { path: 'layers', value: layersVal }, c)).ok, false, 'listede kilitli katmanı değiştirmek');
  assert.strictEqual(JSON.stringify(c.cfg.layers[1]), before, 'kilitli katman değişmedi');
  assert.strictEqual(c.cfg.layers.length, 3);
  // Panelde de serbest olanlar
  assert.strictEqual((await call('sv_update_layer', { id: 'L1', patch: { solo: true, muted: false } }, c)).ok, true);
  assert.strictEqual((await call('sv_set_layer_enabled', { id: 'L1', enabled: false }, c)).ok, true);
  assert.strictEqual((await call('sv_patch_config', { path: 'layers.1.muted', value: true }, c)).ok, true);
  // Kilidi açan yama aynı çağrıda düzenleyebilir
  assert.strictEqual((await call('sv_update_layer', { id: 'L1', patch: { locked: false, opacity: 0.3 } }, c)).ok, true);
  assert.strictEqual(c.cfg.layers[1].opacity, 0.3);
  // Kilitsiz katmanlar eskisi gibi
  assert.strictEqual((await call('sv_reorder_layers', { ids: ['L2', 'L1', 'L0'] }, c)).ok, true);
});

/* Y5: Otomatik VJ kilitli görselleştiriciyi değiştiriyordu. */
test('Otomatik VJ kilitli katmanın türüne ve rengine dokunmaz', () => {
  const A = require('../src/shared/autovj.js');
  const layers = [
    { kind: 'visualizer', type: 'bars', locked: true },
    { kind: 'visualizer', type: 'wave' },
  ];
  assert.deepStrictEqual(A.visualizerLayers(layers).map((l) => l.type), ['wave']);
  const P = read('src/admin/autovj.js');
  const pal = fnBody(P, 'function applyPalette(cfg, item)');
  assert.match(pal, /L\.setEffective\(cfg, 'visualizer\.color', cfg\.visualizer\.color\);/);
  // Gözetimsiz otomasyonun ortak yolu (Otomatik VJ paleti, dinamik tema) kilitli katmana yazmaz
  const L = require('../src/visualizer/layers.js');
  const cfg = SV.defaultConfig();
  L.setStackEnabled(cfg, true);
  const i = L.firstLayerIndex(cfg, 'visualizer');
  assert.ok(i >= 0);
  const was = cfg.layers[i].settings.visualizer.color;
  cfg.layers[i].locked = true;
  assert.strictEqual(L.setEffective(cfg, 'visualizer.color', '#123456'), false);
  assert.strictEqual(cfg.layers[i].settings.visualizer.color, was, 'kilitli katmanın rengi aynı');
  cfg.layers[i].locked = false;
  assert.strictEqual(L.setEffective(cfg, 'visualizer.color', '#123456'), true);
  assert.strictEqual(cfg.layers[i].settings.visualizer.color, '#123456');
  const vis = fnBody(P, 'function applyVisualizer(cfg, items, targets)');
  assert.match(vis, /if \(isStack && \(cfg\.layers \|\| \[\]\)\.some\(\(l\) => l && l\.kind === 'visualizer' && l\.locked\)\) return false;/);
  // Durum satırı nedeni söyler
  assert.match(P, /parts\.push\(T\('görselleştirici katmanları kilitli'\)\);/);
});

/* Y3: renklendirmede yer tutucunun sıra numarası sayı kuralına takılıyor,
   "// Shadertoy" yorumu "0" olarak görünüyordu. */
test('Studio renklendirmesi yorumları ve önişlemci satırlarını korur', () => {
  delete require.cache[require.resolve('../src/admin/studio.js')];
  global.window.SVPanel = { cfg: () => ({}), push() {}, rerender() {}, toast() {} };
  require('../src/admin/studio.js');
  const h = global.window.SVStudio.highlight;
  const one = h('// Shadertoy');
  assert.strictEqual(one, '<span class="c-com">// Shadertoy</span>');
  const mix = h('#define N 2\nfloat a = 1.5; // not 3');
  assert.match(mix, /<span class="c-pre">#define N 2<\/span>/);
  assert.match(mix, /<span class="c-num">1\.5<\/span>/);
  assert.match(mix, /<span class="c-com">\/\/ not 3<\/span>/);
  let many = '';
  for (let i = 0; i < 14; i++) many += '// c' + i + '\n';
  const out = h(many);
  assert.strictEqual((out.match(/class="c-com"/g) || []).length, 14, 'iki basamaklı sıra da');
  assert.ok(!/[\u0000-]/.test(out), 'yer tutucu kalmadı');
  assert.ok(out.includes('// c13'));
});

/* Y12: derlenmeyen dosya içe aktarılınca uyarı yoktu. */
test('Studio içe aktarması derlenmeyen shader için uyarır', () => {
  const S = read('src/admin/studio.js');
  const imp = fnBody(S, 'async function importAny()');
  assert.match(imp, /if \(shaderBroken\(\)\) P\(\)\.toast\('İçe aktarıldı, ama shader derlenmiyor\. Hata editörde gösteriliyor\.'/);
  const en = loadEnglish();
  assert.strictEqual(en.t('İçe aktarıldı, ama shader derlenmiyor. Hata editörde gösteriliyor.'), 'Imported, but the shader does not compile. The error is shown in the editor.');
  assert.strictEqual(en.t('İçe aktarıldı.'), 'Imported.');
});

/* Y2: renk şablonu içe aktarma (panel) renkleri doğrulamıyordu. */
test('renk şablonu içe aktarma geçersiz renkli şablonu atlar', () => {
  const A = read('src/admin/admin.js');
  const at = A.indexOf('actions.importPresets = async () => {');
  const body = A.slice(at, A.indexOf('\n  };', at));
  assert.match(body, /if \(\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(s\)\) return s\.toLowerCase\(\);/);
  assert.match(body, /if \(!colors\.length \|\| colors\.some\(\(c\) => !c\)\) \{ skipped\+\+; return; \}/);
  assert.match(body, /svToast\('Geçersiz renk içeren şablon atlandı: ' \+ skipped/);
  // Ayrıştırılan kural: işlev gövdesindeki hex() aynen çalıştırılır
  const hexSrc = body.slice(body.indexOf('const hex = (c) => {'), body.indexOf('    let skipped = 0;'));
  const c = {};
  vm.createContext(c);
  vm.runInContext(hexSrc + '\nthis.hex = hex;', c);
  assert.strictEqual(c.hex('#ABC'), '#aabbcc');
  assert.strictEqual(c.hex('#112233'), '#112233');
  for (const bad of ['#zzzzzz', 'red', 123, null, '#12345']) assert.strictEqual(c.hex(bad), null, String(bad));
  assert.strictEqual(loadEnglish().t('Geçersiz renk içeren şablon atlandı: 2'), 'Presets with invalid colours skipped: 2');
});

/* Y6: "Logo Seç" ve diğer resim seçiciler resim olmayan dosyayı kabul ediyordu. */
test('her resim seçici dosyayı tarayıcıya çözdürür', () => {
  const A = read('src/admin/admin.js');
  const fn = fnBody(A, 'function imageOk(dataUrl)');
  assert.match(fn, /im\.onerror = \(\) => done\(false\);/);
  // Tür boş gelen gerçek resim (data:application/octet-stream) de çözülür; önek şartı yok
  assert.ok(!/data:image/.test(fn), 'önek denetimi gerçek resmi reddederdi');
  assert.match(fn, /svToast\(tr\('Seçilen dosya açılabilen bir resim değil\.'\), 'err'\)/);
  assert.match(A, /confirm: svConfirm,\s*imageOk,/);
  let sites = 0;
  for (const f of ['src/admin/admin.js', 'src/admin/clipdeck-panel.js', 'src/admin/nowplaying-panel.js', 'src/admin/scene-panels.js']) {
    const s = read(f);
    let at = s.indexOf('readAsDataURL(');
    while (at >= 0) {
      const before = s.slice(Math.max(0, s.lastIndexOf('new FileReader()', at)), at);
      assert.match(before, /imageOk/, f + ' FileReader denetimsiz');
      sites++;
      at = s.indexOf('readAsDataURL(', at + 1);
    }
  }
  assert.strictEqual(sites, 6);
  assert.strictEqual(loadEnglish().t('Seçilen dosya açılabilen bir resim değil.'), 'The selected file is not an image that can be opened.');
});

/* Y7: video kitaplığı sahte .mp4'ü "eklendi" sayıyordu. */
test('video kitaplığı dosyanın başına bakar', () => {
  const M = require('../src/main/media-library.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-vid-'));
  const lib = path.join(dir, 'lib');
  const fake = path.join(dir, 'sahte.mp4');
  fs.writeFileSync(fake, 'bu bir metin dosyası, video değil');
  assert.strictEqual(M.importFile(lib, fake, 'sahte.mp4').error, 'TYPE');
  const box = (name) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(name, 'latin1'), Buffer.alloc(24)]);
  for (const [head, ok] of [[box('ftypisom'), true], [box('moov'), true], [box('mdat'), true], [box('wide'), true],
    [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), true], [Buffer.from('RIFF\0\0\0\0AVI LIST', 'latin1'), true],
    [Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1'), false], [Buffer.from('<html><body>', 'latin1'), false]]) {
    assert.strictEqual(M.isVideoHead(head), ok, head.toString('latin1', 0, 12));
  }
  const real = path.join(dir, 'klip.mov');
  fs.writeFileSync(real, box('ftypqt  '));
  assert.strictEqual(M.importFile(lib, real, 'klip.mov').ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* Y8: sembolik bağlantı korumayı aşıyordu. */
test('dosya yazma koruması sembolik bağlantıyı çözer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lnk-'));
  const app = path.join(dir, 'userData');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'settings.json'), '{}');
  const link = path.join(dir, 'link');
  fs.symlinkSync(app, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(server.outPathGuard(path.join(link, 'settings.json'), true, [app]), /app's own folder/);
  assert.match(server.outPathGuard(path.join(link, 'yeni', 'a.json'), false, [app]), /app's own folder/, 'henüz olmayan alt yol');
  // Korunan klasörün kendisi bağlantıyla verilse de
  assert.match(server.outPathGuard(path.join(app, 'x.json'), false, [link]), /app's own folder/);
  assert.strictEqual(server.outPathGuard(path.join(dir, 'disari.json'), false, [app]), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* Y9: MCP ile verilen MilkDrop etiketleri panelin aradığı yere yazılmıyordu. */
test('sv_save_preset MilkDrop etiketlerini kitaplığa yazar; arama bulur', async () => {
  const ML = require('../src/shared/milkdrop-library.js');
  const c = ctx();
  const r = await call('sv_save_preset', { id: 'md_dans', name: 'Gece Dansı', source: 'zoom=1', tags: ['#dans', 'Gece'] }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(ML.tagsOf(c.cfg.milkdropLibrary, 'md_dans'), ['dans', 'Gece']);
  assert.deepStrictEqual(r.preset.tags, ['dans', 'Gece']);
  const hits = ML.filter([{ id: 'md_dans', name: 'Gece Dansı', kind: 'milkdrop' }, { id: 'md_x', name: 'Başka', kind: 'milkdrop' }], { query: '#dans' }, c.cfg.milkdropLibrary);
  assert.deepStrictEqual(hits.map((p) => p.id), ['md_dans']);
  // Studio presetinin etiketleri dosyasında kalır, MilkDrop kitaplığına girmez
  const s = await call('sv_save_preset', { id: 'st_1', name: 'S', kind: 'visualizer', shader: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1);}', tags: ['a'] }, c);
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(ML.tagsOf(c.cfg.milkdropLibrary, 'st_1'), []);
});

/* Y11: bars için de eski Studio kimliği dönüyordu. */
test('sv_set_visualizer_type presetId yalnız Studio türünde döner', async () => {
  const c = ctx();
  c.cfg.custom = Object.assign({}, c.cfg.custom, { visualizerId: 'eski_studio' });
  const bars = await call('sv_set_visualizer_type', { type: 'bars' }, c);
  assert.strictEqual(bars.ok, true);
  assert.strictEqual(bars.presetId, null);
  const custom = await call('sv_set_visualizer_type', { type: 'custom', presetId: 'yeni' }, c);
  assert.strictEqual(custom.presetId, 'yeni');
});

/* Y13: şablon efektlerinin kimliği yoktu; effectId ile hedeflenemiyordu. */
test('şablondan gelen efektler kimlik alır ve effectId ile hedeflenir', async () => {
  const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
  const ids = new Set();
  let n = 0;
  for (const tpl of T.TEMPLATES) {
    const out = T.apply(SV.defaultConfig(), tpl, env);
    const all = (out.postfx || []).concat(...(out.layers || []).map((l) => (l && l.postfx) || []));
    for (const f of all) {
      assert.ok(f.id && /^fx_/.test(f.id), tpl.id + ' ' + f.type);
      assert.ok(!ids.has(f.id), 'tekrar eden kimlik ' + f.id);
      ids.add(f.id);
      n++;
    }
  }
  assert.ok(n > 40, 'şablon efektleri: ' + n);
  const c = ctx();
  c.setConfig(T.apply(SV.clone(c.cfg), T.TEMPLATES.find((t) => t.id === 'club-strobe'), env));
  const first = c.cfg.postfx[0];
  const r = await call('sv_set_effect_enabled', { effectId: first.id, enabled: false }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(c.cfg.postfx[0].enabled, false);
});

/* UX 7 (kısmen): silinmiş presete bağlı katman sessizce boş kalıyordu. */
test('katmanın Studio preseti silinmişse panel söyler', () => {
  const P = read('src/admin/scene-panels.js');
  assert.match(P, /if \(l\.presetId && !presets\.some\(\(p\) => p\[0\] === l\.presetId\)\) \{/);
  const en = loadEnglish();
  assert.strictEqual(en.t('Bu katmanın Studio preseti silinmiş; katman boş çiziliyor. Listeden başka bir preset seçin.'),
    "This layer's Studio preset was deleted, so the layer draws nothing. Pick another preset from the list.");
  assert.strictEqual(en.t('Üstteki katman kilitli'), 'The layer above is locked');
  assert.strictEqual(en.t('Alttaki katman kilitli'), 'The layer below is locked');
});
