'use strict';
/* Dış gözden geçirme, üçüncü tur (10.10, 93b874f üzerinde) — D1–D5 ve
   arayüz bulguları U1–U5 (#695). */
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

function ctx() {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  return {
    cfg,
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => 1,
    revision: () => 1,
  };
}
const call = (name, args, c) => Promise.resolve(mcp.callTool(name, args, c));
function stack(c, n, lockedAt) {
  c.cfg.layerStack = { enabled: true };
  c.cfg.layers = [];
  for (let i = 0; i < n; i++) {
    c.cfg.layers.push({ id: 'L' + i, name: 'K' + i, kind: 'visualizer', type: 'bars', enabled: true, opacity: 1, locked: i === lockedAt, transform: { x: 0, y: 0, scale: 1, rotate: 0 }, settings: {} });
  }
  return c;
}
function fnBody(src, name) {
  const at = src.indexOf(name);
  assert.ok(at >= 0, name);
  return src.slice(at, src.indexOf('\n  }\n', at));
}
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

/* D1, D4: sv_patch_config katman yolunda katman araçlarının denetimini
   atlıyordu: `layers.1.opacity = 7`, `transform.scale = -5`, kilitli
   katmanda `enabled = "yes"` olduğu gibi yazılıyordu. */
test('sv_patch_config katman yazımını sv_update_layer kurallarıyla denetler', async () => {
  const c = stack(ctx(), 3, 0);
  delete c.cfg.layers[2].enabled; // alanı olmayan eski katman
  for (const [p, v] of [
    ['layers.0.enabled', 'yes'], ['layers.1.enabled', 'yes'], ['layers.2.enabled', 'yes'],
    ['layers.1.opacity', 'x'], ['layers.1.transform.flipX', 1], ['layers.1.transform.skew', 2],
    ['layers.1.type', 'yok-boyle-tur'], ['layers.1.blend', 'yok'],
    ['layers.1', { id: 'L1', kind: 'visualizer', type: 'bars', opacity: 'x' }],
    ['layers.1', 'metin'],
  ]) {
    const r = await call('sv_patch_config', { path: p, value: v }, c);
    assert.strictEqual(r.ok, false, p + ' = ' + JSON.stringify(v));
  }
  assert.strictEqual(c.cfg.layers[2].enabled, undefined);
  // Liste yazımında bozuk bir katman hepsini durdurur
  const list = JSON.parse(JSON.stringify(c.cfg.layers));
  list[1].solo = 'evet';
  assert.strictEqual((await call('sv_patch_config', { path: 'layers', value: list }, c)).ok, false);
  // Aralık dışı değer panelin aralığına çekilir (sv_update_layer gibi)
  let r = await call('sv_patch_config', { path: 'layers.1.opacity', value: 7 }, c);
  assert.strictEqual(r.ok !== false, true);
  assert.strictEqual(c.cfg.layers[1].opacity, 1);
  assert.strictEqual(r.value, 1);
  r = await call('sv_patch_config', { path: 'layers.1.transform.scale', value: -5 }, c);
  assert.strictEqual(c.cfg.layers[1].transform.scale, 0.2);
  r = await call('sv_patch_config', { path: 'layers.1', value: Object.assign({}, c.cfg.layers[1], { opacity: -3, transform: { x: 9 } }) }, c);
  assert.strictEqual(c.cfg.layers[1].opacity, 0);
  assert.strictEqual(c.cfg.layers[1].transform.x, 1);
  // Geçerli yazımlar ve kilitli katmanda serbest bayrak
  assert.strictEqual((await call('sv_patch_config', { path: 'layers.0.enabled', value: false }, c)).ok !== false, true);
  assert.strictEqual(c.cfg.layers[0].enabled, false);
  assert.strictEqual((await call('sv_patch_config', { path: 'layers.1.settings.barCount', value: 48 }, c)).ok !== false, true);
});

/* Uygulamanın kendi ürettiği katmanlar yeni denetimden aynen geçer:
   varsayılanlar ve 72 hazır şablon. */
test('şablonların katmanları katman denetiminden değişmeden geçer', async () => {
  const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
  let seen = 0;
  for (const t of T.TEMPLATES) {
    const c = ctx();
    const applied = T.apply(SV.defaultConfig(), t, env);
    if (!Array.isArray(applied.layers) || !applied.layers.length) continue;
    c.cfg.layers = JSON.parse(JSON.stringify(applied.layers));
    const before = JSON.stringify(c.cfg.layers);
    const r = await call('sv_patch_config', { path: 'layers', value: JSON.parse(before) }, c);
    assert.strictEqual(r.ok !== false, true, t.id + ': ' + r.error);
    assert.deepStrictEqual(c.cfg.layers, JSON.parse(before), t.id);
    seen += c.cfg.layers.length;
  }
  assert.ok(seen >= 30, 'şablon katmanı sayısı ' + seen);
});

/* D2: değeri null olan alana her tür yazılabiliyordu (`display.id = {a:1}`).
   Alan ayarda yoksa varsayılandaki türe bakılır. */
test('null alan yalnız tek değer alır; olmayan alan varsayılanın türüne bakar', async () => {
  const c = ctx();
  c.cfg.display = { id: null, ids: [] };
  for (const v of [{ a: 1 }, [1], Infinity]) {
    assert.strictEqual((await call('sv_patch_config', { path: 'display.id', value: v }, c)).ok, false, JSON.stringify(v));
  }
  assert.strictEqual(c.cfg.display.id, null);
  assert.strictEqual((await call('sv_patch_config', { path: 'display.id', value: 3 }, c)).ok !== false, true);
  // Ekran haritası nesneyi ve null'u alır
  c.cfg.mapping = { enabled: false, outputs: { default: null } };
  assert.strictEqual((await call('sv_patch_config', { path: 'mapping.outputs.default', value: { enabled: true } }, c)).ok !== false, true);
  assert.strictEqual((await call('sv_patch_config', { path: 'mapping.outputs.default.enabled', value: false }, c)).ok !== false, true);
  c.cfg.mapping.outputs.default = null;
  assert.strictEqual((await call('sv_patch_config', { path: 'mapping.outputs.default.enabled', value: true }, c)).ok !== false, true, 'null çıkışın alanı');
  // Bir basamak derinden de aynı: null ya da tek değerli alanın altı yazılmaz
  c.cfg.display = { id: null, ids: [] };
  c.cfg.layerStack = { enabled: null };
  for (const p of ['display.id.a', 'layerStack.enabled.x', 'visualizer.sensitivity.x']) {
    const before = JSON.stringify(c.cfg);
    const r = await call('sv_patch_config', { path: p, value: 1 }, c);
    assert.strictEqual(r.ok, false, p);
    assert.strictEqual(JSON.stringify(c.cfg), before, p + ' ayarı değiştirmedi');
  }
  // Ayarda olmayan ama varsayılanda olan alan
  delete c.cfg.visualizer.sensitivity;
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.sensitivity.x', value: 1 }, c)).ok, false, 'silinmiş alanın altı');
  assert.strictEqual(c.cfg.visualizer.sensitivity, undefined);
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.sensitivity', value: 'abc' }, c)).ok, false);
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.sensitivity', value: 1.2 }, c)).ok !== false, true);
  // Varsayılanda da olmayan yeni anahtar serbest kalır
  assert.strictEqual((await call('sv_patch_config', { path: 'visualizer.yeniAlan', value: 'x' }, c)).ok !== false, true);
});

/* D3: sabit bağlantı (hardlink) gerçek yol çözülse de görünmüyordu:
   settings.json'a klasör dışından açılan bağlantının üzerine yazılabiliyordu. */
test('dosya yazma koruması başka adı olan dosyanın üzerine yazmaz', () => {
  const dir = tmpDir('sv-hl-');
  const app = path.join(dir, 'userData');
  fs.mkdirSync(app);
  const settings = path.join(app, 'settings.json');
  fs.writeFileSync(settings, '{}');
  const link = path.join(dir, 'disari.json');
  fs.linkSync(settings, link);
  assert.match(server.outPathGuard(link, true, [app]), /hard links/);
  const plain = path.join(dir, 'tek.json');
  fs.writeFileSync(plain, '{}');
  assert.strictEqual(server.outPathGuard(plain, true, [app]), '');
});

/* D5: 4. bayttan "free"/"skip" yazan metin video sayılıyordu. */
test('video imzası ISO kutusunun boyuna da bakar', () => {
  const M = require('../src/main/media-library.js');
  const text = Buffer.from('abcdfree ve devamı bir metin', 'latin1');
  assert.strictEqual(M.isVideoHead(text, text.length), false);
  assert.strictEqual(M.isVideoHead(Buffer.from('    skip    ', 'latin1'), 12), false);
  const box = (size, name) => { const b = Buffer.alloc(32); b.writeUInt32BE(size, 0); b.write(name, 4, 'latin1'); return b; };
  assert.strictEqual(M.isVideoHead(box(24, 'ftypisom'), 4096), true);
  assert.strictEqual(M.isVideoHead(box(8, 'free'), 4096), true);
  assert.strictEqual(M.isVideoHead(box(0, 'mdat'), 4096), true, 'dosya sonuna kadar');
  assert.strictEqual(M.isVideoHead(box(1, 'mdat'), 4096), true, '64 bit boy');
  assert.strictEqual(M.isVideoHead(box(5, 'ftypisom'), 4096), false, '8 bayttan kısa kutu');
  assert.strictEqual(M.isVideoHead(box(9000, 'moov'), 4096), false, 'dosyadan büyük kutu');
  const dir = tmpDir('sv-vid3-');
  const fake = path.join(dir, 'sahte.mp4');
  fs.writeFileSync(fake, text);
  assert.strictEqual(M.importFile(path.join(dir, 'lib'), fake, 'sahte.mp4').error, 'TYPE');
});

/* U1: uçtaki öğenin oku etkin görünüyor, basınca bir şey olmuyordu. */
test('uçtaki öğenin o yöndeki oku kapalı', () => {
  const P = read('src/admin/scene-panels.js');
  const head = fnBody(P, 'function layerHead(');
  assert.match(head, /i \+ 1 >= list\.length \? 'Zaten en üstte'/);
  assert.match(head, /i === 0 \? 'Zaten en altta'/);
  const item = fnBody(P, 'function itemHeader(');
  assert.match(item, /const can = \(d\) => i \+ d >= 0 && i \+ d < list\.length;/);
  assert.strictEqual((item.match(/disabled: !can\(/g) || []).length, 2);
  const tl = read('src/admin/timeline-panel.js');
  assert.match(tl, /edge\(act\(\['arrow-up', 'Yukarı'\][^\n]*, -1\)/);
  assert.match(tl, /edge\(act\(\['arrow-down', 'Aşağı'\][^\n]*, 1\)/);
});

/* U2: boş ve içi rastgele metin olan .milk dosyaları preset olarak ekleniyordu. */
test('MilkDrop içe aktarma boş ve preset olmayan dosyayı atlar', async () => {
  const I = require('../src/main/milkdrop-import.js');
  const dir = tmpDir('sv-md3-');
  const src = path.join(dir, 'paket');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'iyi.milk'), '[preset00]\nfRating=3\nzoom=1.01\n');
  fs.writeFileSync(path.join(src, 'bos.milk'), '');
  fs.writeFileSync(path.join(src, 'bozuk.milk'), 'garbage\x00\x01 rastgele bayt');
  const plan = await I.scanFolder(src, {});
  const s = I.summary(plan);
  assert.strictEqual(s.presets, 2, 'onay sayısı boş dosyayı saymaz');
  assert.strictEqual(s.skipped.empty, 1);
  const saved = [];
  const r = await I.runImport(plan, { existing: () => [], saveManyAsync: async (items) => { saved.push(...items); return items; } });
  assert.deepStrictEqual(saved.map((p) => p.name), ['iyi']);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.skipped.invalid, 1);
  assert.strictEqual(r.skipped.empty, 1);
  assert.strictEqual(I.looksLikePreset('  per_frame_1=a=1;'), true);
  assert.strictEqual(I.looksLikePreset('garbage'), false);
  assert.strictEqual(I.looksLikePreset(''), false);
  // Tek tek dosya ekleme de aynı denetimi kullanır; panel sonuçta söyler
  const main = read('src/main/main.js');
  const at = main.indexOf("ipcMain.handle('presets:import-milk'");
  assert.ok(at >= 0);
  assert.match(main.slice(at, main.indexOf('\n});', at)), /mdImport\.looksLikePreset\(text\)/);
  const panel = read('src/admin/milkdrop-panel.js');
  assert.match(panel, /r\.skipped\.invalid/);
  assert.match(panel, /k\.empty/);
});

/* U3: OSC portuna "1e3" yazınca 1 oluyordu; boş ya da geçersiz değer
   sessizce varsayılana dönüyordu. */
test('port alanları tam sayı ve aralık ister, geçersizde eski değer kalır', () => {
  const A = read('src/admin/admin.js');
  const body = fnBody(A, 'function portValue(') + '\n  }';
  const toasts = [];
  const sb = { svToast: (m) => toasts.push(m), tr: (s) => s };
  vm.runInNewContext(body + '\nthis.portValue = portValue;', sb);
  const input = (v) => ({ value: v });
  assert.strictEqual(sb.portValue(input('1e3'), 6742, 1), 1000, 'üslü yazım parseInt gibi 1 olmaz');
  assert.strictEqual(sb.portValue(input('2e4'), 9000, 1024), 20000);
  assert.strictEqual(sb.portValue(input('9001'), 9000, 1024), 9001);
  for (const v of ['1.5', '', 'abc', '80', '70000']) {
    const i = input(v);
    assert.strictEqual(sb.portValue(i, 9000, 1024), null, v);
    assert.strictEqual(i.value, '9000', v + ' eski değere döner');
  }
  assert.strictEqual(sb.portValue(input('80'), 6742, 1), 80, 'istemci portu 1024 altı olabilir');
  assert.ok(toasts.length >= 5);
  assert.match(read('src/admin/control.js'), /P\(\)\.portValue\(e\.target, cfg\.control\.osc\.port, 1024\)/);
  assert.match(read('src/admin/stream.js'), /P\(\)\.portValue\(e\.target, s\.port, 1024\)/);
  assert.match(read('src/admin/openrgb-panel.js'), /P\(\)\.portValue\(e\.target, o\.port \|\| 6742, 1\)/);
  assert.doesNotMatch(read('src/admin/control.js') + read('src/admin/stream.js'), /parseInt\(e\.target\.value, 10\) \|\| (9000|8722)/);
});

/* U4: sv_set_autovj {patch:{...}} hiçbir şey yazmadan ok:true dönüyordu. */
test('tanınmayan argümanlar yanıtta söylenir; Otomatik VJ yalnız onlarla reddeder', async () => {
  const c = ctx();
  const before = JSON.stringify(c.cfg.autovj);
  const bad = await call('sv_set_autovj', { patch: { enabled: true } }, c);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /Unknown argument\(s\): patch/);
  assert.strictEqual(JSON.stringify(c.cfg.autovj), before);
  const mixed = await call('sv_set_autovj', { enabled: true, hiz: 3 }, c);
  assert.strictEqual(mixed.ok !== false, true);
  assert.deepStrictEqual(mixed.ignored, ['hiz']);
  assert.strictEqual(c.cfg.autovj.enabled, true);
  const clean = await call('sv_set_autovj', { enabled: false }, c);
  assert.strictEqual(clean.ignored, undefined);
  // Diğer araçlar reddetmez, yalnız söyler
  const other = await call('sv_set_blackout_transition', { duration: 2, sure: 1 }, c);
  assert.strictEqual(other.ok !== false, true);
  assert.deepStrictEqual(other.ignored, ['sure']);
});

/* U5: kayıt durunca kaydetme penceresi açıkken panel yeniden çizilirse
   Anlık Görüntü (ve Kayda Başla) açılıyor, ikinci pencere açılabiliyordu. */
test('dosya yazılırken kayıt düğmeleri kapalı kalır', () => {
  const R = read('src/admin/record-panel.js');
  assert.match(R, /if \(!recording && !saving\) \{\n\s*busy = false;/);
  assert.match(R, /disabled: busy \|\| saving \|\| recording,/);
  assert.match(R, /disabled: \(busy \|\| saving\) && !recording,/);
  const fin = fnBody(R, 'async function finish(');
  assert.match(fin, /saving = true;[\s\S]*await writeRecording[\s\S]*finally \{\n\s*saving = false;/);
  const snap = fnBody(R, 'async function snap(');
  assert.match(snap, /if \(saving \|\| busy\) return;/);
  assert.match(fnBody(R, 'async function start('), /if \(saving\) return \{ ok: false/);
});

test('yeni arayüz metinlerinin İngilizcesi var', () => {
  const src = read('src/shared/i18n.js');
  for (const s of ['Zaten en üstte', 'Zaten en altta', 'Port {lo}–65535 arasında bir tam sayı olmalı.',
    '{n} boş preset dosyası atlanacak.', '{n} boş preset dosyası atlandı.', '{n} dosya MilkDrop preseti değil; atlandı.']) {
    assert.ok(src.indexOf("'" + s + "':") >= 0, s);
  }
});
