'use strict';
/* Dış gözden geçirme raporlarında (10.10, 68ca436) bulunan hatalar (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Windows'ta çalışma kopyası CRLF olabilir; gövde ayıklama LF bekliyor
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|html|css|json)$/.test(name)) out.push(full);
  }
  return out;
}

/* Studio'da ve şarkı imzasında ayırıcı düz NUL baytıydı; git ve grep
   dosyayı ikili sayıp farkı gizliyordu. */
test('kaynak dosyalarda düz NUL baytı yok', () => {
  const bad = walk(path.join(ROOT, 'src'), []).filter((f) => fs.readFileSync(f).includes(0));
  assert.deepStrictEqual(bad.map((f) => path.relative(ROOT, f)), []);
});

/* ------------------------------------------------------------------ MCP */

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const mcp = require('../src/shared/mcp.js');
const server = require('../src/main/mcp-server.js');
const T = require('../src/shared/templates.js');

function ctx(extra) {
  const cfg = Object.assign(SV.defaultConfig(), {
    mcp: { enabled: true, mode: 'everything' },
    scenes: [{ id: 's1', name: 'Bir', data: { background: { type: 'solid' } } }],
  });
  cfg.stream = Object.assign({}, cfg.stream, { token: 'GIZLI-OBS', remoteToken: 'GIZLI-KUMANDA' });
  const store = new Map();
  const ok = () => ({ ok: true });
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
    writeText: ok, writeBinary: ok, startExport: ok, launchClip: ok,
  }, extra || {});
}
const call = (name, args, c) => Promise.resolve(mcp.callTool(name, args, c));
function withLayers(c, n) {
  c.cfg.layerStack = { enabled: true };
  c.cfg.layers = [];
  for (let i = 0; i < n; i++) c.cfg.layers.push({ id: 'L' + i, name: 'K' + i, kind: 'visualizer', type: 'bars', opacity: 1, transform: { x: 0, y: 0, scale: 1, rotate: 0 }, settings: {} });
  return c;
}

/* Kritik 1: ara düğüm dizi olunca {} ile değiştiriliyordu; tek bir
   katmanın saydamlığını yazmak bütün katman listesini siliyordu. */
test('sv_patch_config dizi sırasıyla yalnız o öğeye yazar, listeyi silmez', async () => {
  const c = withLayers(ctx(), 3);
  const r = await call('sv_patch_config', { path: 'layers.1.opacity', value: 0.5 }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(Array.isArray(c.cfg.layers), 'katmanlar hâlâ dizi');
  assert.strictEqual(c.cfg.layers.length, 3);
  assert.strictEqual(c.cfg.layers[1].opacity, 0.5);
  assert.strictEqual(c.cfg.layers[0].opacity, 1);
  // Katman efekti yolu (layers.N.postfx) da dizinin içinden geçer
  c.cfg.layers[0].postfx = [{ id: 'f', type: 'bloom', params: { amount: 1 } }];
  assert.strictEqual((await call('sv_patch_config', { path: 'layers.0.postfx.0.params.amount', value: 0.3 }, c)).ok, true);
  assert.strictEqual(c.cfg.layers[0].postfx[0].params.amount, 0.3);
  // Olmayan sıra, sayı olmayan anahtar ve metnin altı reddedilir
  for (const p of ['layers.3.opacity', 'layers.x.opacity', 'layers.01.opacity', 'visualizer.type.x', 'visualizer..type']) {
    const bad = await call('sv_patch_config', { path: p, value: 1 }, c);
    assert.strictEqual(bad.ok, false, p);
  }
  assert.strictEqual(c.cfg.layers.length, 3);
  assert.strictEqual(typeof c.cfg.visualizer.type, 'string');
});

test('sv_patch_config bilinmeyen üst anahtar oluşturmaz', async () => {
  const c = ctx();
  const r = await call('sv_patch_config', { path: 'MCP.mode', value: 'everything' }, c);
  assert.strictEqual(r.ok, false);
  assert.ok(!('MCP' in c.cfg));
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.sensitivity', value: 1.4 }, c)).ok, true);
});

/* Kritik 2: dışa aktarma jetonları açık yazıyordu; herhangi bir .json'un
   (ayar dosyası dahil) üstüne yazılabiliyordu. */
test('sv_export_json jetonları gizler; sv_get_config ile aynı', async () => {
  let body = '';
  const c = ctx({ writeText: (f, t) => { body = t; return true; } });
  const abs = process.platform === 'win32' ? 'C:\\Users\\me\\show.json' : '/home/me/show.json';
  const r = await call('sv_export_json', { path: abs }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(!body.includes('GIZLI'), 'jeton dosyaya yazılmamalı');
  assert.strictEqual(JSON.parse(body).stream.token, '[redacted]');
  assert.strictEqual(c.cfg.stream.token, 'GIZLI-OBS', 'canlı ayar değişmez');
  const g = await call('sv_get_config', {}, c);
  assert.strictEqual(g.config.stream.token, '[redacted]');
});

test('dosya yazan araçlar uygulama klasörüne ve var olan dosyanın üstüne yazmaz', async () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-out-'));
  const appDir = path.join(dir, 'userData');
  fs.mkdirSync(appDir);
  const existing = path.join(dir, 'var.json');
  fs.writeFileSync(existing, '{}');
  const guard = (f, ow) => server.outPathGuard(f, ow, [appDir]);
  assert.match(guard(path.join(appDir, 'settings.json'), true), /app's own folder/);
  assert.match(guard(existing, false), /already exists/);
  assert.strictEqual(guard(existing, true), '');
  assert.strictEqual(guard(path.join(dir, 'yeni.json'), false), '');
  assert.match(guard(appDir + '.json', false) || 'yazılabilir', /yazılabilir/, 'klasörle aynı önekli kardeş yol korunmaz');
  const written = [];
  const c = ctx({ outPathGuard: guard, writeText: (f) => { written.push(f); return true; }, writeBinary: (f) => { written.push(f); return true; }, capturePreview: () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: 1, height: 1 }) });
  assert.strictEqual((await call('sv_export_json', { path: path.join(appDir, 'settings.json') }, c)).ok, false);
  assert.strictEqual((await call('sv_export_json', { path: existing }, c)).ok, false);
  assert.strictEqual((await call('sv_export_json', { path: existing, overwrite: true }, c)).ok, true);
  assert.strictEqual((await call('sv_save_snapshot', { path: path.join(appDir, 'a.jpg') }, c)).ok, false);
  assert.strictEqual((await call('sv_start_export', { audioPath: existing, outputPath: path.join(appDir, 'a.mp4') }, c)).ok, false);
  assert.deepStrictEqual(written, [existing]);
  // Ana süreç korumayı bağlıyor
  const M = read('src/main/main.js');
  assert.match(M, /outPathGuard: \(file, overwrite\) => mcpServer\.outPathGuard\(file, overwrite, \[app\.getPath\('userData'\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* Orta 3: `engine:"glsl"` olduğu gibi kaydediliyordu; Studio ne derliyor
   ne varyasyon sayıyordu. */
test('sv_save_preset motor adını düzeltir, bilinmeyeni reddeder', async () => {
  const c = ctx();
  const glsl = await call('sv_save_preset', { name: 'G', kind: 'visualizer', engine: 'glsl', shader: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1);}' }, c);
  assert.strictEqual(glsl.ok, true, JSON.stringify(glsl));
  assert.strictEqual(glsl.preset.engine, 'shader');
  assert.strictEqual((await call('sv_save_preset', { name: 'X', kind: 'visualizer', engine: 'hlsl', shader: 'x' }, c)).ok, false);
  assert.strictEqual((await call('sv_save_preset', { name: 'X', kind: 'scene', shader: 'x' }, c)).ok, false);
  assert.strictEqual((await call('sv_save_preset', { name: 'X', kind: 'visualizer', engine: 'shader' }, c)).ok, false, 'kodsuz shader');
  assert.strictEqual((await call('sv_save_preset', { name: 'V', kind: 'visualizer', engine: 'variation', base: 'bars', overrides: {} }, c)).ok, true);
  const md = await call('sv_save_preset', { name: 'M', source: 'zoom=1' }, c);
  assert.strictEqual(md.ok, true);
  assert.strictEqual(md.preset.kind, 'milkdrop');
  // Yerleşik Studio presetlerinin hepsi aynı kurallardan geçer
  global.window.SVPresetsBuiltins = undefined;
  require('../src/shared/presets.js');
  const builtins = global.window.SVPresets ? global.window.SVPresets.all().filter((p) => p.builtin && p.kind !== 'milkdrop') : [];
  assert.ok(builtins.length > 5, 'yerleşik Studio presetleri yüklendi');
  for (const p of builtins) {
    const r = await call('sv_save_preset', Object.assign({}, p, { id: null }), c);
    assert.strictEqual(r.ok, true, p.name + ': ' + JSON.stringify(r));
  }
});

/* Düşük 13: dosya adı `evil.json` olurken içerideki kimlik `../../evil`
   kalıyordu. */
test('sv_save_preset kimliği dosya adıyla aynı biçime getirir', async () => {
  const c = ctx();
  const r = await call('sv_save_preset', { id: '../../evil', name: 'E', kind: 'visualizer', shader: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1);}' }, c);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.preset.id, 'evil');
  assert.ok(c.store.has('evil'));
  assert.strictEqual((await call('sv_save_preset', { id: '../..', name: 'E', shader: 'x' }, c)).ok, false);
});

/* Düşük 12: olmayan kimlik için de ok:true dönüyordu. */
test('sv_delete_preset olmayan preset için hata verir', async () => {
  const c = ctx();
  assert.strictEqual((await call('sv_delete_preset', { id: 'yok' }, c)).ok, false);
  c.store.set('var', { id: 'var', name: 'V' });
  assert.strictEqual((await call('sv_delete_preset', { id: 'var' }, c)).ok, true);
  assert.ok(!c.store.has('var'));
  const failing = ctx({ presets: { get: () => ({ id: 'a' }), remove: () => ({ ok: false, error: 'EBUSY' }), save: () => ({ ok: true }) } });
  const r = await call('sv_delete_preset', { id: 'a' }, failing);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /EBUSY/);
});

/* Orta 4: kapatma eşzamansız; `open:false` isteğine `open:true` dönüyordu. */
test('yüzen pencere kapanırken kapanış olayı beklenir', () => {
  const M = read('src/main/main.js');
  const at = M.indexOf('function closeFloatingWindow()');
  const body = M.slice(at, M.indexOf('\n}\n', at));
  assert.match(body, /win\.once\('closed'/);
  assert.match(body, /setTimeout\(resolve, 3000\)/);
  assert.match(M, /await closeFloatingWindow\(\);\s*return \{ open: floatingIsOpen\(\) \};\s*\},/);
  assert.match(M, /ipcMain\.handle\('floating:toggle', async \(\) => \{\s*if \(floatingIsOpen\(\)\) \{ await closeFloatingWindow\(\); return \{ open: floatingIsOpen\(\) \}; \}/);
});

/* Orta 6: charset yoktu; PowerShell gövdeyi ISO-8859-1 sanıyordu. */
test('MCP yanıtı charset=utf-8 bildirir', () => {
  const S = read('src/main/mcp-server.js');
  assert.ok(!/'Content-Type': 'application\/json'(?!;)/.test(S), 'charset olmayan başlık kalmamalı');
  assert.strictEqual((S.match(/application\/json; charset=utf-8/g) || []).length, 2);
});

/* Orta 7: konum ve özellikler doğrulanmıyordu. */
test('katman konumu ve özellikleri panelin aralığında', async () => {
  const c = withLayers(ctx(), 1);
  for (const bad of [{ x: 'abc' }, { y: NaN }, { scale: Infinity }, { flipX: 'yes' }]) {
    const r = await call('sv_set_layer_position', Object.assign({ id: 'L0' }, bad), c);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
  }
  const r = await call('sv_set_layer_position', { id: 'L0', x: 5, y: -0.5, scale: -5, rotate: 1e9 + 30 }, c);
  assert.strictEqual(r.ok, true);
  const t = c.cfg.layers[0].transform;
  assert.strictEqual(t.x, 1);
  assert.strictEqual(t.y, -0.5);
  assert.strictEqual(t.scale, 0.2);
  assert.ok(t.rotate >= -180 && t.rotate <= 180, String(t.rotate));
  for (const bad of [{ enabled: 'yes' }, { name: { a: 1 } }, { opacity: 'x' }, { locked: 1 }, { transform: { z: 1 } }]) {
    const u = await call('sv_update_layer', { id: 'L0', patch: bad }, c);
    assert.strictEqual(u.ok, false, JSON.stringify(bad));
  }
  assert.strictEqual((await call('sv_update_layer', { id: 'L0', patch: { opacity: 7 } }, c)).ok, true);
  assert.strictEqual(c.cfg.layers[0].opacity, 1);
  assert.strictEqual((await call('sv_add_layer', { kind: 'visualizer', type: 'bars', transform: { x: 'abc' } }, c)).ok, false);
});

/* Doğrulayıcılar uygulamanın kendi ürettiğini reddetmemeli: her hazır
   şablonun katmanları aynı araçlardan geçer. */
test('hazır şablonların katmanları katman doğrulamasından geçer', async () => {
  let seen = 0;
  for (const tpl of T.TEMPLATES) {
    const c = ctx();
    c.setConfig(T.apply(SV.clone(c.cfg), tpl, { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone }));
    for (const l of c.cfg.layers || []) {
      const patch = { transform: Object.assign({}, l.transform) };
      for (const k of ['name', 'enabled', 'opacity', 'solo', 'muted', 'locked', 'group', 'presetId']) if (l[k] !== undefined) patch[k] = l[k];
      const r = await call('sv_update_layer', { id: l.id, patch }, c);
      assert.strictEqual(r.ok, true, tpl.id + ' / ' + l.name + ': ' + JSON.stringify(r));
      seen++;
    }
  }
  assert.ok(seen > 20, 'şablon katmanları denendi: ' + seen);
});

/* Orta 8: geçersiz renkler kaydedilip arkaplana uygulanıyordu. */
test('renk şablonu yalnız onaltılık renk kabul eder; yerleşiklerin hepsi geçer', async () => {
  const c = ctx();
  assert.strictEqual((await call('sv_create_color_preset', { name: 'K', colors: ['red', '#zzzzzz', 5] }, c)).ok, false);
  const ok = await call('sv_create_color_preset', { name: 'İyi', colors: ['#ABC', '#112233'] }, c);
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.preset.colors, ['#aabbcc', '#112233', '#112233', '#112233', '#112233']);
  // Elle bozulmuş eski bir şablon uygulanmaz
  c.cfg.userPresets.push({ id: 'bozuk', name: 'Bozuk', colors: ['red', '#zzzzzz'] });
  const before = c.cfg.background.gradient.colors.slice();
  assert.strictEqual((await call('sv_apply_color_preset', { id: 'bozuk' }, c)).ok, false);
  assert.deepStrictEqual(c.cfg.background.gradient.colors, before);
  for (const p of SV.GRADIENT_PRESETS.filter((x) => !x.group)) {
    const r = await call('sv_apply_color_preset', p.id ? { id: p.id } : { name: p.name }, c);
    assert.strictEqual(r.ok, true, p.name);
  }
});

/* Orta 10: kaynak ve hedef doğrulanmıyordu; ölü rota kalıyordu. */
test('modülasyon rotası bilinen kaynak ve var olan sayısal hedef ister', async () => {
  const c = withLayers(ctx(), 1);
  for (const bad of [
    { source: 'zzz', target: 'visualizer.sensitivity' },
    { source: 'bass', target: '__proto__.x' },
    { source: 'bass', target: 'visualizer.yok' },
    { source: 'bass', target: 'visualizer.type' },
    { source: 'bass', target: 'visualizer.sensitivity', mode: 'pow' },
  ]) {
    const r = await call('sv_add_modulation_route', bad, c);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
  }
  assert.strictEqual(({}).x, undefined);
  for (const good of [
    { source: 'bass', target: 'visualizer.sensitivity' },
    { source: 'macro1', target: 'layers.0.opacity', mode: 'add' },
    { source: 'lfo1', target: 'layers.0.transform.rotate' },
  ]) {
    const r = await call('sv_add_modulation_route', good, c);
    assert.strictEqual(r.ok, true, JSON.stringify(good) + ' ' + JSON.stringify(r));
  }
});

/* Orta 11: `name` hem arama hem yeni addı. */
test('sv_rename_scene eski adla bulur, newName ile adlandırır; eski biçim çalışır', async () => {
  const c = ctx();
  const r = await call('sv_rename_scene', { name: 'Bir', newName: 'Yeni' }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(c.cfg.scenes[0].name, 'Yeni');
  assert.strictEqual((await call('sv_rename_scene', { id: 's1', newName: 'Üç' }, c)).ok, true);
  assert.strictEqual((await call('sv_rename_scene', { id: 's1', name: 'Dört' }, c)).ok, true, 'eski biçim');
  assert.strictEqual(c.cfg.scenes[0].name, 'Dört');
  assert.strictEqual((await call('sv_rename_scene', { name: 'Yok', newName: 'X' }, c)).ok, false);
  assert.strictEqual((await call('sv_rename_scene', { name: 'Dört' }, c)).ok, false, 'yeni ad yok');
});

/* Düşük 14: katmanın bazı alanları görünmüyordu. */
test('katman okuması preset, solo, sessiz, kilit, grup, ses ve maske alanlarını gösterir', async () => {
  const c = withLayers(ctx(), 1);
  Object.assign(c.cfg.layers[0], { presetId: 'p1', solo: true, muted: true, locked: true, group: 'G', audio: { band: 'bass', opacity: 0.5 }, mask: { enabled: true } });
  const l = (await call('sv_get_layer', { id: 'L0' }, c)).layer;
  assert.strictEqual(l.presetId, 'p1');
  assert.strictEqual(l.solo, true);
  assert.strictEqual(l.muted, true);
  assert.strictEqual(l.locked, true);
  assert.strictEqual(l.group, 'G');
  assert.strictEqual(l.audio.opacity, 0.5);
  assert.strictEqual(l.mask.enabled, true);
});

/* Düşük 15: doğrulanmayan değerler. */
test('Otomatik VJ, bölüm yamaları, efekt türü ve klip yuvası doğrulanır', async () => {
  const c = ctx();
  assert.strictEqual((await call('sv_set_autovj', { source: 'zzz' }, c)).ok, false);
  assert.strictEqual((await call('sv_set_autovj', { enabled: 'yes' }, c)).ok, false);
  assert.strictEqual((await call('sv_set_autovj', { interval: -3 }, c)).ok, true);
  assert.strictEqual(c.cfg.autovj.interval, 1, 'panelin en küçük aralığı');
  assert.strictEqual((await call('sv_set_autovj', { interval: 500, bpmLock: 999 }, c)).ok, true);
  assert.strictEqual(c.cfg.autovj.interval, 64);
  assert.strictEqual(c.cfg.autovj.bpmLock, 200);
  assert.strictEqual((await call('sv_set_geometry', { patch: { shape: 'zzz' } }, c)).ok, false);
  assert.ok(!('shape' in c.cfg.geometry));
  assert.strictEqual((await call('sv_set_media', { patch: { path: '/etc/passwd' } }, c)).ok, false);
  assert.strictEqual((await call('sv_set_media', { patch: { opacity: 'x' } }, c)).ok, false);
  assert.strictEqual((await call('sv_set_geometry', { patch: { spin: 0.4, formula: 'torus' } }, c)).ok, true);
  assert.strictEqual((await call('sv_set_text', { patch: { enabled: true } }, c)).ok, true);
  assert.strictEqual((await call('sv_add_effect', { type: 'nonexist' }, c)).ok, false);
  assert.strictEqual((await call('sv_add_effect', { type: 'bloom' }, c)).ok, true);
  assert.strictEqual((await call('sv_trigger_clip', { row: -1, col: 0 }, c)).ok, false);
  assert.strictEqual((await call('sv_trigger_clip', { row: 1.5, col: 0 }, c)).ok, false);
  // Boş ya da ızgara dışı yuvayı panel bildirir
  const empty = ctx({ launchClip: () => ({ ok: false, error: 'No clip in that slot.' }) });
  assert.strictEqual((await call('sv_trigger_clip', { row: 99, col: 0 }, empty)).ok, false);
  const CP = read('src/admin/clipdeck-panel.js');
  const press = CP.slice(CP.indexOf('function press(row, col)'), CP.indexOf('function release('));
  assert.match(press, /if \(!slot\) return false;/);
  assert.match(press, /return true;\s*\}/);
  assert.match(read('src/main/main.js'), /const hit = C\.launchSlot\(.*return hit === false \? \{ ok:false/);
});

/* Bölüm doğrulaması varsayılanların ve şablonların yazdığını reddetmez. */
test('bölüm yamaları varsayılanları ve hazır şablonları kabul eder', async () => {
  const c = ctx();
  const tools = { text: 'sv_set_text', logo: 'sv_set_logo', media: 'sv_set_media', geometry: 'sv_set_geometry' };
  for (const [sec, tool] of Object.entries(tools)) {
    const r = await call(tool, { patch: SV.defaultConfig()[sec] }, c);
    assert.strictEqual(r.ok, true, sec + ': ' + JSON.stringify(r));
  }
  for (const tpl of T.TEMPLATES) {
    const next = T.apply(SV.clone(c.cfg), tpl, { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone });
    for (const [sec, tool] of Object.entries(tools)) {
      const r = await call(tool, { patch: next[sec] }, c);
      assert.strictEqual(r.ok, true, tpl.id + ' ' + sec + ': ' + JSON.stringify(r));
    }
  }
});

/* Orta 5: hiçbir araç parametre bildirmiyordu. Her aracın okuduğu
   argüman şemasında yazılı olmalı; yeni argüman eklenip şemaya
   yazılmazsa bu test düşer. */
test('her aracın okuduğu argümanlar şemasında bildirilir', () => {
  const src = read('src/shared/mcp.js');
  const HELPERS = {
    findLayer: ['id', 'layerId', 'index'],
    findScene: ['id', 'name'],
    findFx: ['effectId', 'effectIndex', 'type'],
    permissionReport: ['tool', 'name'],
  };
  const byName = {};
  for (const t of mcp.tools()) byName[t.name] = t;
  const re = /\n {2}tool\('(\w+)',/g;
  const missing = [];
  let m;
  let checked = 0;
  while ((m = re.exec(src))) {
    // Tek satırlık araçlar kendi satırında biter; sonraki araca taşmasın
    const ends = [src.indexOf('\n  });', m.index + 1), src.indexOf('\n  tool(', m.index + 1)].filter((i) => i > 0);
    const end = Math.min.apply(null, ends);
    const body = src.slice(m.index, end);
    const used = new Set();
    const ar = /\b(?:args|src|route)(?:\s*&&\s*(?:args|src))?\.(\w+)/g;
    let a;
    while ((a = ar.exec(body))) if (a[1] !== 'route' || /args/.test(a[0])) used.add(a[1]);
    for (const [h, names] of Object.entries(HELPERS)) {
      if (new RegExp('\\b' + h + '\\([^)]*args').test(body)) names.forEach((n) => used.add(n));
    }
    const schema = byName[m[1]].inputSchema;
    assert.strictEqual(schema.type, 'object');
    assert.strictEqual(schema.additionalProperties, true, m[1] + ' fazladan alanı reddetmemeli');
    for (const n of used) {
      if (!schema.properties || !schema.properties[n]) missing.push(m[1] + '.' + n);
    }
    for (const r of schema.required || []) assert.ok(schema.properties[r], m[1] + ' required ' + r);
    if (used.size) checked++;
  }
  assert.deepStrictEqual(missing, []);
  assert.ok(checked > 60, 'argüman okuyan araç sayısı: ' + checked);
  // Argüman okuyan her araç parametre bildiriyor (argümansız okuma araçları boş)
  const described = mcp.tools().filter((t) => Object.keys(t.inputSchema.properties || {}).length).length;
  assert.ok(described >= checked, 'parametre bildiren araç: ' + described + ', argüman okuyan: ' + checked);
});

/* Düşük 15: `media.file` herhangi bir dosyayı gösterebiliyordu; medya
   protokolü uzantısına bakmadan sunuyordu. */
test('medya protokolü yalnız video uzantılarını sunar', async () => {
  const os = require('os');
  const { serveMediaFile } = require('../src/main/media-file.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-media-'));
  const txt = path.join(dir, 'passwd');
  const vid = path.join(dir, 'Klip.MP4');
  fs.writeFileSync(txt, 'root:x:0:0');
  fs.writeFileSync(vid, Buffer.alloc(64));
  assert.strictEqual(serveMediaFile(txt, null).status, 415);
  assert.strictEqual(serveMediaFile(txt + '.json', null).status, 415);
  const ok = serveMediaFile(vid, null);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers.get('Content-Type'), 'video/mp4');
  await ok.arrayBuffer();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------- Yönetici arayüzü */

function freshStudio(cfg) {
  const key = require.resolve('../src/admin/studio.js');
  delete require.cache[key];
  global.window.SVPanel = { cfg: () => cfg, push() {}, rerender() {}, toast() {} };
  require('../src/admin/studio.js');
  return global.window.SVStudio;
}
function fnBody(src, name) {
  const at = src.indexOf(name);
  assert.ok(at >= 0, name);
  return src.slice(at, src.indexOf('\n  }\n', at));
}

/* UX 1–2: "Sahnede Kullan" son KAYDI uyguluyordu; derlenmeyen shader için
   de "uygulandı" diyordu; hiç kaydedilmemiş taslakta bir şey olmuyordu. */
test('Studio Sahnede Kullan: derleme hatasında durur, kaydedilmemişi önce kaydeder', () => {
  const S = read('src/admin/studio.js');
  const apply = fnBody(S, 'async function applyToScene()');
  assert.ok(!/!selectedId\) return;/.test(apply.split('\n')[1]), 'yeni taslakta sessizce çıkmamalı');
  const compile = apply.indexOf('compileNow();');
  const broken = apply.indexOf('if (shaderBroken())');
  const save = apply.indexOf('await saveDraft()');
  const applyAt = apply.indexOf('applyPresetToCfg(cfg, p);');
  assert.ok(compile > 0 && compile < broken, 'önce şimdi derlenir');
  assert.ok(broken < save && save < applyAt, 'derleme → kaydet → uygula sırası');
  assert.match(apply, /if \(dirty \|\| !selectedId\)/);
  assert.match(apply, /okText: 'Kaydet ve Uygula'/);
  assert.match(apply, /if \(!\(await saveDraft\(\)\)\) return;/);
  // saveDraft sonucu bildirir; WebGL yokluğu derleme hatası sayılmaz
  const saveFn = fnBody(S, 'async function saveDraft()');
  assert.match(saveFn, /return false;/);
  assert.match(saveFn, /return true;/);
  assert.match(fnBody(S, 'function shaderBroken()'), /!compileState\.noGl/);
  const I = read('src/shared/i18n.js');
  for (const k of ['Kaydet ve Uygula', 'Değişiklikleri At', 'Shader derlenmiyor; sahneye uygulanmadı. Önce hatayı düzeltin.',
    'Sahnede kullanmak için önce kaydedilmesi gerekiyor. Değişiklikler kaydedilecek.',
    'Sahnede kullanmak için önce kaydedilmesi gerekiyor. Yerleşik preset değişmez; kendi kopyan kaydedilir.']) {
    assert.ok(I.includes("'" + k + "':"), 'İngilizcesi yok: ' + k);
  }
});

/* UX 3: başka presete geçmek düzenlemeyi uyarısız atıyordu. */
test('Studio kaydedilmemiş değişikliği atmadan önce sorar', () => {
  const S = read('src/admin/studio.js');
  assert.match(fnBody(S, 'async function confirmDiscard()'), /if \(!dirty \|\| !draft\) return true;/);
  assert.match(S, /onclick: \(\) => guardedSelect\(p\.id\)/);
  assert.ok(!/onclick: \(\) => selectPreset\(/.test(S), 'listede korumasız seçim kalmamalı');
  assert.match(S, /startDraft\(\(\) => newShader\('visualizer'\)\)/);
  assert.match(S, /startDraft\(\(\) => newVariation\('visualizer'\)\)/);
  assert.match(fnBody(S, 'async function importAny()'), /^async function importAny\(\) \{\s*if \(!\(await confirmDiscard\(\)\)\) return;/);
  const I = read('src/shared/i18n.js');
  assert.match(I, /“\(\.\+\)” üzerindeki kaydedilmemiş değişiklikler kaybolacak/);
});

/* UX 7: silme onayı presetin sahnelerde kullanıldığını söylemiyordu. */
test('Studio silme onayı presetin kullanıldığı sahneleri sayar', () => {
  const cfg = SV.defaultConfig();
  cfg.scenes = [
    { id: 'a', name: 'Klasik', data: { visualizer: { type: 'custom' }, custom: { visualizerId: 'p1' } } },
    { id: 'b', name: 'Katmanlı', data: { layerStack: { enabled: true }, layers: [{ kind: 'background', type: 'custom', presetId: 'p1' }] } },
    { id: 'c', name: 'Devralan', data: { custom: { backgroundId: 'p1' }, layers: [{ kind: 'background', type: 'custom' }] } },
    { id: 'd', name: 'Başka', data: { visualizer: { type: 'bars' }, custom: { visualizerId: 'p1' } } },
  ];
  const S = freshStudio(cfg);
  const u = S.presetUsers(cfg, 'p1');
  assert.deepStrictEqual(u.scenes, ['Klasik', 'Katmanlı', 'Devralan']);
  assert.strictEqual(u.live, false);
  const msg = S.deleteMessage(cfg, { id: 'p1', name: 'Neon' });
  assert.match(msg, /^“Neon” kalıcı olarak silinecek\. Bu sahnelerde kullanılıyor: Klasik, Katmanlı, Devralan\./);
  assert.strictEqual(S.deleteMessage(cfg, { id: 'p9', name: 'Boş' }), '“Boş” kalıcı olarak silinecek.');
  cfg.visualizer.type = 'custom';
  cfg.custom.visualizerId = 'p9';
  assert.match(S.deleteMessage(cfg, { id: 'p9', name: 'Boş' }), /Şu anki görünümde de kullanılıyor\.$/);
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes('Bu sahnelerde kullanılıyor: '));
  assert.ok(I.includes('Şu anki görünümde de kullanılıyor'));
});

/* UX 4: kilitli katman kaldırılıp taşınabiliyordu. */
test('kilitli katman kaldırılamaz ve taşınamaz; komşusu da onu kaydıramaz', () => {
  const P = read('src/admin/scene-panels.js');
  const head = fnBody(P, 'function layerHead(');
  assert.strictEqual((head.match(/disabled: !!l\.locked,/g) || []).length, 2, 'aç/kapa ve kaldır');
  // Oklar kendi kilidine, uca ve kaydıracakları komşunun kilidine bakar (v2 Y10, v3 U1)
  assert.match(head, /disabled: !!l\.locked \|\| i \+ 1 >= list\.length \|\| !!\(list\[i \+ 1\] && list\[i \+ 1\]\.locked\),/);
  assert.match(head, /disabled: !!l\.locked \|\| i === 0 \|\| !!\(list\[i - 1\] && list\[i - 1\]\.locked\),/);
  assert.match(head, /onclick: \(\) => \{ if \(l\.locked\) return; list\.splice\(i, 1\); onChange\(\); \}/);
  const vm = require('vm');
  const move = fnBody(P, 'function moveItem(list, i, dir)') + '\n  }';
  const c = {};
  vm.createContext(c);
  vm.runInContext(move + '\nthis.moveItem = moveItem;', c);
  const list = [{ id: 'a' }, { id: 'b', locked: true }, { id: 'c' }];
  assert.strictEqual(c.moveItem(list, 1, 1), false, 'kilitli yukarı');
  assert.strictEqual(c.moveItem(list, 0, 1), false, 'komşu kilitliyle yer değiştiremez');
  assert.strictEqual(c.moveItem(list, 2, -1), false);
  assert.deepStrictEqual(list.map((x) => x.id), ['a', 'b', 'c']);
  const free = [{ id: 'a' }, { id: 'b' }];
  assert.strictEqual(c.moveItem(free, 0, 1), true);
  assert.deepStrictEqual(free.map((x) => x.id), ['b', 'a']);
});

/* UX 5: kamera yokken hata yazısı ve karartma çıkışa basılıyordu. */
test('medya hata yazısı yalnız yönetici önizlemesinde çizilir', () => {
  global.window = global.window || {};
  require('../src/visualizer/modes/media.js');
  const Media = global.window.SVMedia;
  assert.ok(Media, 'medya modu');
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? () => ({ width: 10 }) : (...a) => calls.push(k))),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const m = Object.create(Media.prototype);
  m.error = 'Seçilen kamera bulunamadı. Listeden başka bir kamera seçin.';
  m.hasFrame = () => false;
  const saved = global.window.SVPanel;
  delete global.window.SVPanel;
  m.draw(ctx, null, { media: { enabled: true } }, 800, 600, 0);
  assert.deepStrictEqual(calls, [], 'çıkışta hiçbir şey çizilmez');
  global.window.SVPanel = { rerender() {} };
  m.draw(ctx, null, { media: { enabled: true } }, 800, 600, 0);
  assert.ok(calls.includes('fillRect') && calls.includes('fillText'), 'panelde yazı görünür');
  // Canlı kayıt önizleme yüzeyini kaydeder: kayıt sürerken panelde de yok
  calls.length = 0;
  global.window.SVRecordPanel = { isRecording: () => true };
  m.draw(ctx, null, { media: { enabled: true } }, 800, 600, 0);
  assert.deepStrictEqual(calls, [], 'kayıtta çizilmez');
  delete global.window.SVRecordPanel;
  assert.match(read('src/admin/record-panel.js'), /isRecording: \(\) => pumpRaf !== 0/);
  if (saved) global.window.SVPanel = saved; else delete global.window.SVPanel;
});

/* UX 8: Windows dışında açılışta zorlanan değerler varsayılanla
   karşılaştırılıyordu; temiz kurulumda rozet çıkıyordu. */
test('Windows dışı ve NVENC yok: zorlanan değerler varsayılan sayılır', () => {
  const vm = require('vm');
  const A = read('src/admin/admin.js');
  const from = A.indexOf('  function platformAdjust(c) {');
  const to = A.indexOf('  function defaultAt(path) {');
  assert.ok(from > 0 && to > from);
  const run = (isWindows, gpu) => {
    const c = { window: { SV_PLATFORM: { isWindows }, SV: { clone: SV.clone, DEFAULT_CONFIG: SV.defaultConfig() } }, gpuAvailable: gpu };
    vm.createContext(c);
    vm.runInContext('var gpuAvailable = this.gpuAvailable;\n' + A.slice(from, to) + '\nthis.adjust = platformAdjust; this.defs = effectiveDefaults;', c);
    return c;
  };
  const linux = run(false, false);
  const fresh = SV.defaultConfig();
  assert.strictEqual(linux.adjust(fresh), true, 'temiz kurulum zorlanır');
  const defs = linux.defs();
  for (const p of ['logo.source', 'text.nowSource', 'nowplaying.source', 'nowplaying.coverSource', 'export.encoder', 'text.lyricsFollow', 'dynamicTheme.enabled']) {
    const get = (o) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    assert.deepStrictEqual(get(fresh), get(defs), p + ' rozet çıkarmamalı');
  }
  assert.strictEqual(defs.export.encoder, 'cpu');
  assert.strictEqual(defs.logo.source, 'manual');
  const win = run(true, true);
  assert.strictEqual(win.adjust(SV.defaultConfig()), false, 'Windows + NVENC: dokunulmaz');
  assert.strictEqual(win.defs().export.encoder, SV.defaultConfig().export.encoder);
  // Sıfırlamalar ve rozet aynı varsayılanı kullanır
  assert.match(A, /function defaultAt\(path\) \{\s*return getPath\(effectiveDefaults\(\), path\);/);
  assert.match(A, /function resetPath\(path\) \{\s*const dv = defaultAt\(path\);/);
  assert.strictEqual((A.match(/const defaults = effectiveDefaults\(\);/g) || []).length, 2, 'bölüm ve kategori sıfırlama');
  assert.ok(!/const defaults = window\.SV\.defaultConfig\(\);/.test(A));
  assert.match(A, /if \(platformAdjust\(cfg\)\) push\(true\);/);
});

/* UX 9: "ARTIST NAME" yer tutucusu Türkçe arayüzde de çıkışa basılıyordu. */
test('şablon yer tutucusu arayüz dilinde çizilir, kullanıcının metni çevrilmez', () => {
  const tpls = T.TEMPLATES.filter((t) => JSON.stringify(t).includes('"placeholder":true'));
  assert.ok(tpls.length >= 8, 'yer tutuculu şablonlar: ' + tpls.length);
  assert.ok(!JSON.stringify(T.TEMPLATES).includes('ARTIST NAME'));
  assert.ok(!JSON.stringify(T.TEMPLATES).includes('TRACK TITLE'));
  global.window = global.window || {};
  require('../src/visualizer/modes/text.js');
  const TextMode = global.window.SVModes.text;
  const drawn = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? (s) => ({ width: String(s).length * 10 }) : (k === 'fillText' || k === 'strokeText') ? (s) => drawn.push(String(s)) : () => {})),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const m = new TextMode({ width: 800, height: 600, getContext: () => ctx });
  const savedI = global.window.SVI18n;
  global.window.SVI18n = { t: (s) => ({ 'SANATÇI ADI': 'ARTIST NAME', Sahne: 'Scene' }[s] || s) };
  const base = { enabled: true, source: 'now', nowSource: 'manual', field: 'artist', size: 0.05, x: 0.5, y: 0.5, animation: 'none', shadow: 0, outline: 0 };
  const audio = { bass: 0, mid: 0, treble: 0, level: 0, beat: false, spectrum: new Float32Array(64) };
  const draw = (text) => { drawn.length = 0; m.draw(audio, { text }, 1, 0.016); return drawn.join('|'); };
  assert.match(draw(Object.assign({}, base, { content: 'SANATÇI ADI', placeholder: true })), /ARTIST NAME/);
  assert.doesNotMatch(draw(Object.assign({}, base, { content: 'SANATÇI ADI' })), /ARTIST NAME/, 'bayraksız metin çevrilmez');
  // Bayrak kalmış olsa da kullanıcının yazdığı sözlük kelimesi çevrilmez
  const own = draw(Object.assign({}, base, { content: 'Sahne', placeholder: true }));
  assert.match(own, /Sahne/);
  assert.doesNotMatch(own, /Scene/);
  assert.match(draw(Object.assign({}, base, { content: 'SANATÇI ADI', placeholder: true, nowPlaying: { artist: 'Sezen Aksu' } })), /Sezen Aksu/);
  if (savedI) global.window.SVI18n = savedI; else delete global.window.SVI18n;
  const L = require('../src/visualizer/layers.js');
  const add = L.makeTextLayer({ name: 'Sanatçı Adı', source: 'now', field: 'artist', content: 'SANATÇI ADI', placeholder: true });
  assert.strictEqual(add.settings.text.placeholder, true);
  assert.strictEqual(add.settings.text.nowPlaying.artist, '', 'yer tutucu parça bilgisi sayılmaz');
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'SANATÇI ADI': 'ARTIST NAME'") && I.includes("'PARÇA ADI': 'TRACK TITLE'"));
  // Panelde metin düzenlenince ya da kaynak değişince bayrak kalkar
  const TP = read('src/admin/text-panel.js');
  assert.match(TP, /T\.content = e\.target\.value; delete T\.placeholder;/);
  assert.match(TP, /if \(v !== 'now'\) settle\(\);/);
});

/* UX 10: Studio listesinde iki ayrı "Sıvı Metal". */
test('yerleşik Studio presetlerinde aynı türde aynı ad yok', () => {
  global.window = global.window || {};
  require('../src/shared/presets.js');
  require('../src/shared/presets-shaders.js');
  const seen = {};
  const dup = [];
  for (const p of global.window.SVPresets.all().filter((x) => x.builtin)) {
    const k = p.kind + '|' + p.name;
    if (seen[k]) dup.push(k);
    seen[k] = true;
  }
  assert.deepStrictEqual(dup, []);
  assert.ok(read('src/shared/i18n.js').includes("'Metal Bantlar': 'Metal Bands'"));
});

/* UX 11: küçük resim yığında genel arkaplanı okuyordu. Tema kipinde
   katman zaten genel paleti okuyor; fark düz renk ve kendi renk kipinde. */
test('sahne küçük resmi yığında ekrandaki arkaplan katmanını gösterir', () => {
  const A = read('src/admin/admin.js');
  const body = fnBody(A, 'function sceneBackground(data)');
  assert.match(body, /L\.firstLayerIndex\(data, 'background'\)/);
  assert.match(body, /L\.layerConfig\(data, data\.layers\[i\]\)\.background/);
  assert.match(A, /const bg = sceneBackground\(scene && scene\.data\);/);
  const L = require('../src/visualizer/layers.js');
  const data = SV.defaultConfig();
  data.layerStack = { enabled: true };
  data.background.type = 'gradient';
  data.layers = [{ id: 'b', kind: 'background', type: 'solid', enabled: true, settings: { background: { colorMode: 'solid', solidColor: '#123456' } } }];
  const i = L.firstLayerIndex(data, 'background');
  const bg = L.layerConfig(data, data.layers[i]).background;
  assert.strictEqual(bg.type, 'solid', 'genel arkaplan gradyan olsa da katman düz renk');
  assert.strictEqual(bg.solidColor, '#123456');
});

/* UX 12: logo kitaplığı yalnız uzantıya bakıyordu. */
test('resim kitaplığı dosyanın başına bakar; .png adlı metin eklenmez', () => {
  const os = require('os');
  const LL = require('../src/main/logo-library.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-logo-'));
  const lib = path.join(dir, 'lib');
  const fake = path.join(dir, 'sahte.png');
  fs.writeFileSync(fake, 'bu bir metin dosyası');
  assert.strictEqual(LL.importFile(lib, fake, 'sahte.png').error, 'TYPE');
  const png = path.join(dir, 'gercek.png');
  fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]));
  assert.strictEqual(LL.importFile(lib, png, 'gercek.png').ok, true);
  const jpgAsPng = path.join(dir, 'aslinda-jpeg.png');
  fs.writeFileSync(jpgAsPng, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]));
  assert.strictEqual(LL.importFile(lib, jpgAsPng, 'aslinda-jpeg.png').ok, true, 'adı yanlış ama gerçek resim');
  for (const [head, ok] of [['GIF89a', true], ['RIFF\0\0\0\0WEBP', true], ['BM', true], ['<svg', false], ['', false]]) {
    assert.strictEqual(LL.isImageHead(Buffer.from(head + '\0\0\0\0', 'latin1')), ok, head);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/* UX 6: en küçük pencerede (1000 px) üst çubuk 1119 px istiyordu; Karart
   kesiliyor, durum ve Ayarlar görünmüyordu. Canlı ölçüldü (TR/EN, 984–1366
   px, "Karartmayı Kaldır" ve "2 ekranda açık" dahil). */
test('dar pencerede üst çubuk sıkışır; en küçük yükseklik 560', () => {
  const css = read('src/admin/admin.css');
  const at = css.indexOf('@media (max-width: 1280px) {');
  assert.ok(at > 0, '1280 eşiği');
  const block = css.slice(at, css.indexOf('\n}', at));
  assert.match(block, /\.display-field > span, \.ts-kbd, #statusText \{ display: none; \}/);
  assert.match(block, /#closeBtn, #blackoutBtn \{ font-size: 0;/);
  const html = read('src/admin/index.html');
  assert.match(html, /<button id="closeBtn"[^>]*title="Görselleştirmeyi kapat"/);
  assert.match(html, /<button id="blackoutBtn"[^>]*title="/);
  assert.match(html, /<div class="status" id="statusBox">/);
  assert.match(read('src/admin/admin.js'), /\$\('statusBox'\)\.title = tr\(\$\('statusText'\)\.textContent\);/);
  assert.ok(read('src/shared/i18n.js').includes("'Görselleştirmeyi kapat': 'Close the visualizer'"));
  const M = read('src/main/main.js');
  const win = M.slice(M.indexOf('function createAdminWindow()'), M.indexOf('icon: fs.existsSync(iconPath)', M.indexOf('function createAdminWindow()')));
  assert.match(win, /minWidth: 1000,\s*minHeight: 560,/);
});
