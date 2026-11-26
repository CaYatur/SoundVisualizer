'use strict';
/* ÖNİZLEME / PROGRAM (#1167, #1168, #1169). Saf taslak mantığı ve mod KAPALIYKEN eski
   yolun aynen kaldığına dair kaynak denetimleri. Arayüz tıklamaları elle denenir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');
const Core = require('../src/shared/program-draft.js');

const sample = () => ({
  visualizer: { type: 'bars' }, background: { type: 'solid', solidColor: '#112233' },
  audio: { sources: ['default'] }, mapping: { enabled: false, outputs: {} },
  transition: { enabled: true, type: 'crossfade', duration: 0.7 }, scenes: [{ id: 'a' }],
});

test('mod kapalıyken persistent aynı nesneyi döndürür (davranış aynı)', () => {
  const d = Core.create();
  const cfg = sample();
  assert.strictEqual(d.active(), false);
  assert.strictEqual(d.persistent(cfg), cfg);
  let ran = 0;
  assert.strictEqual(d.withProgram(cfg, () => { ran++; return 7; }), 7);
  assert.strictEqual(ran, 1);
  assert.strictEqual(d.syncShared(cfg), false);
  assert.strictEqual(d.take(cfg), null);
  assert.strictEqual(d.adoptProgram(cfg), false);
});

test('taslak düzenlemesi Program’a sızmaz; aygıt ve haritalama dahil', () => {
  const d = Core.create();
  const cfg = sample();
  d.begin(cfg);
  cfg.visualizer.type = 'wave';
  cfg.audio.sources = ['demo'];
  cfg.mapping.enabled = true;
  const out = d.persistent(cfg);
  assert.notStrictEqual(out, cfg);
  assert.strictEqual(out.visualizer.type, 'bars');
  assert.deepStrictEqual(out.audio.sources, ['default']);
  assert.strictEqual(out.mapping.enabled, false);
});

test('withProgram Program’ı değiştirir, taslağı ve referansı korur', () => {
  const d = Core.create();
  const cfg = sample();
  d.begin(cfg);
  cfg.visualizer.type = 'wave';
  const ref = cfg;
  d.withProgram(cfg, () => {
    assert.strictEqual(cfg.visualizer.type, 'bars');
    assert.strictEqual(d.persistent(cfg), cfg, 'iş sırasında çıkış cfg’nin kendisi');
    cfg.background.solidColor = '#000000';
  });
  assert.strictEqual(ref, cfg);
  assert.strictEqual(cfg.visualizer.type, 'wave');
  assert.strictEqual(cfg.background.solidColor, '#112233');
  assert.strictEqual(d.program().background.solidColor, '#000000');
});

test('Sahneye Gönder taslağın tamamını Program yapar; geri alınabilir', () => {
  const d = Core.create();
  const cfg = sample();
  d.begin(cfg);
  cfg.visualizer.type = 'wave';
  cfg.audio.sources = ['demo'];
  d.take(JSON.parse(JSON.stringify(cfg)));
  assert.strictEqual(d.program().visualizer.type, 'wave');
  assert.deepStrictEqual(d.program().audio.sources, ['demo']);
  assert.ok(d.canRevert());
  d.revert();
  assert.strictEqual(d.program().visualizer.type, 'bars');
  assert.strictEqual(d.canRevert(), false);
});

test('kitaplık (kayıtlı sahneler) iki tarafta ortak', () => {
  const d = Core.create();
  const cfg = sample();
  d.begin(cfg);
  cfg.scenes.push({ id: 'b' });
  assert.strictEqual(d.syncShared(cfg), true);
  assert.deepStrictEqual(d.program().scenes.map((s) => s.id), ['a', 'b']);
  assert.strictEqual(d.syncShared(cfg), false);
});

test('çıkış: Program geri verilir, mod kapanır', () => {
  const d = Core.create();
  const cfg = sample();
  d.begin(cfg);
  cfg.visualizer.type = 'wave';
  const p = d.end();
  Core.replaceInPlace(cfg, p);
  assert.strictEqual(cfg.visualizer.type, 'bars');
  assert.strictEqual(d.active(), false);
  assert.strictEqual(d.persistent(cfg), cfg);
});

test('geçiş seçimi: kes, süreli geçiş, sahnenin kendi geçişi', () => {
  const own = { enabled: false, type: 'wipe', duration: 2, params: { a: 1 } };
  assert.strictEqual(Core.transitionFor('cut', own).type, 'cut');
  const f = Core.transitionFor('fade', own, 1.5);
  assert.strictEqual(f.type, 'crossfade');
  assert.strictEqual(f.duration, 1.5);
  assert.strictEqual(f.enabled, true);
  assert.deepStrictEqual(Core.transitionFor('scene', own), own);
  assert.notStrictEqual(Core.transitionFor('scene', own), own);
});

test('dondur / sessiz durumu yapılandırmaya yazılmaz', () => {
  const d = Core.create();
  assert.strictEqual(d.setFrozen(true), true);
  assert.strictEqual(d.setMuted(true), true);
  assert.strictEqual(d.frozen() && d.muted(), true);
});

/* Kaynak denetimleri: mod kapalıyken her yeni yol draftOn() arkasında. */
const admin = read('src/admin/admin.js');

test('admin: çıkış yapılandırması taslak kapalıyken eski yol', () => {
  assert.match(admin, /function draftView\(\) \{ return window\.SVTimelineTarget \? window\.SVTimelineTarget\.persistent\(cfg\) : cfg; \}/);
  assert.match(admin, /function outputConfig\(\) \{ const base = draftView\(\); return draft \? draft\.persistent\(base\) : base; \}/);
  assert.match(admin, /function draftOn\(\) \{ return !!\(draft && draft\.active\(\)\); \}/);
  // Önizleme her yerde aynı hedefi kullanıyor; kapalıyken previewTarget() === outputConfig()
  assert.ok(!/SVPreview\.setConfig\(outputConfig\(\)\)/.test(admin));
  assert.match(admin, /function previewTarget\(\) \{ return draftOn\(\) \? draftView\(\) : outputConfig\(\); \}/);
});

test('admin: yeni yollar yalnız mod açıkken', () => {
  assert.match(admin, /if \(draftOn\(\)\) draftAfterEdit\(\);\n\s*if \(isBlackedOut\(\) && !draftOn\(\)\)/);
  assert.match(admin, /if \(draftOn\(\) && !n && !draftProgramDirty\) return;/);
  assert.match(admin, /function toggleBlackout\(opts\) \{\n\s*if \(!draftOn\(\)\) return toggleBlackoutRaw\(opts\);/);
  assert.match(admin, /function acceptExternalConfig\(incoming\) \{[\s\S]{0,200}if \(draftOn\(\)\) \{/);
  assert.match(admin, /applyScene: \(id, opts\) => \(draftOn\(\) && activeCategory === 'live' \? onProgram\(\(\) => actions\.applyScene\(id, opts\)\) : actions\.applyScene\(id, opts\)\)/);
  assert.match(admin, /function onProgram\(fn\) \{\n\s*if \(!draftOn\(\)\) return fn\(\);/);
});

test('kontrol: kısayol, MIDI ve uzak eylemler önizleme modunda Program’ı sürer', () => {
  const c = read('src/admin/control.js');
  assert.match(c, /if \(panel && panel\.draftOn && panel\.draftOn\(\) && panel\.cfg\(\) === cfg\) \{/);
});

test('mod varsayılan kapalı: arayüz kendiliğinden taslak açmaz', () => {
  const ui = read('src/admin/preview-mode.js');
  const begins = ui.match(/draftBegin\(\)/g) || [];
  assert.strictEqual(begins.length, 1, 'yalnız enter() taslak açar');
  assert.match(ui, /function enter\(\) \{\n\s*if \(armed\(\)\) return;\n\s*if \(!P\(\)\.draftBegin\(\)\) return;/);
  const html = read('src/admin/index.html');
  const iCore = html.indexOf('../shared/program-draft.js');
  const iAdmin = html.indexOf('<script src="admin.js">');
  const iUi = html.indexOf('<script src="preview-mode.js">');
  assert.ok(iCore > 0 && iCore < iAdmin && iAdmin < iUi, 'betik sırası');
});

test('çıkış güvenliği: dondur çizimi atlar, yeni pencere durumu alır', () => {
  const v = read('src/visualizer/visualizer.js');
  assert.match(v, /if \(!outputFrozen\) stack\.draw\(audio, mcfg, t, dt\);/);
  const m = read('src/main/main.js');
  assert.match(m, /ipcMain\.on\('output-safety'/);
  assert.match(m, /ipcMain\.handle\('program:snapshot'/);
  assert.match(m, /win\.webContents\.send\('output-safety', outputSafetyState\)/);
});

/* Taslak katman değişimi (göster/gizle, solo, rafta mod/preset) push(true) ile gelir.
   Program değişmediği için çıkış imzası aynı kalıyor ve push erken dönüyordu: önizleme
   ancak sonraki ilgisiz bir çizimde güncelleniyordu. Gerçek push/previewConfig kodu
   taklitlerle çalıştırılıyor. */
test('önizleme modu: Program değişmese de taslak değişimi önizlemeyi hemen yeniler', () => {
  const src = read('src/admin/admin.js');
  const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };
  const code = cut('  function draftSig() {', '  /* AYAR GÖNDERİMİ (#695).');
  const env = {
    window: { SVPreview: { setConfig: (c) => env.sent.push(JSON.stringify(c)) } },
    sent: [], full: 0,
  };
  const make = new Function('env', `
    const window = env.window;
    let program = { layers: [{ id: 'a', enabled: true }] };
    let cfg = { layers: [{ id: 'a', enabled: true }] };
    let draft = { active: () => true, persistent: () => program };
    const sendStats = { preview: 0 };
    let lastOutSig = null, pendingOutSig = null, pushTimer = null, marksFresh = false;
    let activeSceneId = '', sceneActionInFlight = false;
    const isBlackedOut = () => false, refreshModifiedMarks = () => {}, clearActiveScene = () => {};
    const draftAfterEdit = () => {}, sendConfigPatch = () => {};
    const sendFullConfig = () => { env.full++; lastOutSig = pendingOutSig; };
    function draftOn() { return !!(draft && draft.active()); }
    function draftView() { return cfg; }
    function outputConfig() { return draft.persistent(cfg); }
    function previewTarget() { return cfg; }
    ${code}
    return { push, cfg: () => cfg };
  `);
  const api = make(env);
  api.push(true); // ilk tam gönderim
  // Her katman türü aynı yoldan: MilkDrop, şarkı sözü, görselleştirici, Studio, medya, metin, çalan parça
  const kinds = [['milkdrop', {}], ['text', { settings: { text: { source: 'lyrics' } } }], ['visualizer', { type: 'bars' }],
    ['studio', {}], ['media', {}], ['text', {}], ['nowplaying', {}]];
  api.cfg().layers = kinds.map(([kind, extra], i) => Object.assign({ id: 'l' + i, kind, enabled: true, solo: false, opacity: 1 }, extra));
  api.push(true);
  for (let i = 0; i < kinds.length; i++) {
    for (const [key, val] of [['enabled', false], ['solo', true], ['opacity', 0.4], ['type', 'wave']]) {
      const before = env.sent.length;
      const l = api.cfg().layers[i];
      const old = l[key];
      l[key] = val; // yalnız taslak
      api.push(true);
      assert.strictEqual(env.sent.length, before + 1, kinds[i][0] + ' ' + key + ': önizleme yenilenmedi');
      assert.deepStrictEqual(JSON.parse(env.sent[env.sent.length - 1]).layers[i][key], val);
      l[key] = old;
      api.push(true);
    }
  }
  assert.strictEqual(env.full, 1, 'Program değişmedi: çıkışa yeniden tam gönderim yok');
  // Hiçbir şey değişmediyse önizleme de yeniden kurulmaz
  const n = env.sent.length;
  api.push(true);
  assert.strictEqual(env.sent.length, n);
});
