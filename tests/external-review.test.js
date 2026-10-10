'use strict';
/* Dış gözden geçirme raporlarında (10.10, 68ca436) bulunan hatalar (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
