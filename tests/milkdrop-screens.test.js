'use strict';
/* HER EKRANDA AYNI PRESET (#585).
 *
 * Her görselleştirici penceresi, Spout/Syphon ve web çıkışı kendi otomatik
 * geçiş sayacını koşturuyordu: rastgele sırada her ekran başka bir preset
 * gösteriyordu. Aynı preset seçilse bile iki şey ekrandan ekrana
 * değişiyordu: `rand_preset`in dört sayısı ve geçiş deseni, ikisi de
 * `Math.random`dan.
 *
 * Artık seçimi tek motor yapıyor (ilk pencere, yoksa Spout/Syphon, o da
 * yoksa panel önizlemesi) ve seçim tohumuyla birlikte diğerlerine gidiyor.
 * `rand_preset` ve geçiş deseni o tohumdan türüyor. "Her ekran kendi
 * seçer" (`milkdropControl.independent`, varsayılan kapalı) eski davranış.
 *
 * Motor burada sahte bir pencereyle kuruluyor ve iki kopyası yan yana
 * koşturuluyor: biri lider, biri izleyen. Ana süreç Electron olmadan
 * yüklenemediği için onun dağıtımı kaynaktan denetleniyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const PRESETS = [
  { id: 'p1', name: 'Bir', kind: 'milkdrop', source: '[preset00]\nfDecay=0.98\nper_frame_1=zoom = 1.01;\n' },
  { id: 'p2', name: 'İki', kind: 'milkdrop', source: '[preset00]\nfDecay=0.95\nper_frame_1=rot = 0.02;\n' },
  { id: 'p3', name: 'Üç', kind: 'milkdrop', source: '[preset00]\nfDecay=0.90\nper_frame_1=warp = 0.5;\n' },
];

/* Bir motor: kendi penceresi, kendi modülleri. İki motor aynı pencereyi
   paylaşmıyor — gerçek ekranlar da paylaşmıyor. */
function engine() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.SVPresets = { byKind: (k) => PRESETS.filter((p) => p.kind === k) };
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  return { m, win: ctx.window };
}

const cfgFor = (p, extra) => ({
  milkdrop: Object.assign({ presetId: p.id, source: p.source, blendTime: 2, autoNext: 0 }, extra || {}),
  milkdropControl: {},
  milkdropLibrary: {},
});

// Lider bir seçim yapmış gibi: seçimi ve tohumu doğrudan veriliyor
function leaderPick(m, p, seed, blend) {
  m.autoPick = { id: p.id, name: p.name, source: p.source, cut: false, blend: blend == null ? 2 : blend, seed };
}

// İzleyen: liderin mesajı `SVMdFollow` olarak geliyor
function follow(e, cfg, fields) {
  e.win.SVMdFollow = Object.assign({ at: performance.now(), base: e.m._manualKey }, fields);
  e.m._autoCycle(cfg, 1 / 60, {});
}

// ------------------------------------------------------------------ motor

test('izleyen, liderin seçimini ve TOHUMUNU alıyor', () => {
  const cfg = cfgFor(PRESETS[0]);
  const B = engine();
  B.m._ensurePreset(cfg);
  follow(B, cfg, { id: 'p2', cut: false, blend: 1.5, seed: 123456789 });
  assert.strictEqual(B.m.autoPick.id, 'p2');
  assert.strictEqual(B.m.autoPick.seed, 123456789);
  assert.strictEqual(B.m.autoPick.blend, 1.5);
  // İzleyenin kendi yayını da aynı tohumu söylüyor: lider kapanınca bu
  // pencere lider olursa izleyenleri sıçramadan aynı yerden sürdürüyor.
  assert.strictEqual(B.m.livePreset().seed, 123456789);
});

test('aynı seçim her ekranda aynı rand_preset ve aynı geçiş deseni', () => {
  const cfg = cfgFor(PRESETS[0]);
  const A = engine();
  const B = engine();
  A.m._ensurePreset(cfg);
  B.m._ensurePreset(cfg);
  leaderPick(A.m, PRESETS[1], 987654321);
  A.m._ensurePreset(cfg);
  follow(B, cfg, A.m.livePreset());
  B.m._ensurePreset(cfg);
  assert.deepStrictEqual(Array.from(B.m.randPreset), Array.from(A.m.randPreset));
  assert.ok(A.m.oldPreset && B.m.oldPreset, 'iki ekranda da geçiş başlamalı');
  A.m._ensureBlendPattern();
  B.m._ensureBlendPattern();
  assert.deepStrictEqual(Array.from(B.m.blendA), Array.from(A.m.blendA));
  assert.deepStrictEqual(Array.from(B.m.blendC), Array.from(A.m.blendC));
});

test('farklı tohum farklı rand_preset ve farklı desen', () => {
  const cfg = cfgFor(PRESETS[0]);
  const A = engine();
  const B = engine();
  A.m._ensurePreset(cfg);
  B.m._ensurePreset(cfg);
  leaderPick(A.m, PRESETS[1], 1111);
  leaderPick(B.m, PRESETS[1], 2222);
  A.m._ensurePreset(cfg);
  B.m._ensurePreset(cfg);
  assert.notDeepStrictEqual(Array.from(B.m.randPreset), Array.from(A.m.randPreset));
  A.m._ensureBlendPattern();
  B.m._ensureBlendPattern();
  assert.notDeepStrictEqual(Array.from(B.m.blendC), Array.from(A.m.blendC));
  for (const v of A.m.randPreset) assert.ok(v >= 0 && v < 1, 'rand_preset 0..1 aralığında olmalı: ' + v);
});

test('elle seçim de her ekranda aynı: tohum seçimin kendisinden', () => {
  const A = engine();
  const B = engine();
  A.m._ensurePreset(cfgFor(PRESETS[2]));
  B.m._ensurePreset(cfgFor(PRESETS[2]));
  assert.deepStrictEqual(Array.from(B.m.randPreset), Array.from(A.m.randPreset));
  const C = engine();
  C.m._ensurePreset(cfgFor(PRESETS[1]));
  assert.notDeepStrictEqual(Array.from(C.m.randPreset), Array.from(A.m.randPreset));
});

test('desen geçişin ortasında ağ değişirse aynı tohumdan yeniden kuruluyor', () => {
  const cfg = cfgFor(PRESETS[0]);
  const A = engine();
  A.m._ensurePreset(cfg);
  leaderPick(A.m, PRESETS[1], 42);
  A.m._ensurePreset(cfg);
  A.m._ensureBlendPattern();
  const first = Array.from(A.m.blendC);
  A.m.meshX = 32; A.m.meshY = 24;
  A.m._ensureBlendPattern();
  const B = engine();
  B.m._ensurePreset(cfg);
  leaderPick(B.m, PRESETS[1], 42);
  B.m._ensurePreset(cfg);
  B.m.meshX = 32; B.m.meshY = 24;
  B.m._ensureBlendPattern();
  assert.deepStrictEqual(Array.from(A.m.blendC), Array.from(B.m.blendC));
  assert.notStrictEqual(first.length, A.m.blendC.length);
});

test('liderin kendi seçimi 32 bitlik bir tohum taşıyor', () => {
  const E = bare(read('src/visualizer/modes/milkdrop.js'));
  // Döngünün kendi rastgele akışından değil: sıra seçimi etkilenmesin
  assert.match(E, /blend: this\.cycle\.blend,\s*seed: \(Math\.random\(\) \* 4294967296\) >>> 0,/);
  assert.match(E, /seed: a && Number\.isInteger\(a\.seed\) \? a\.seed : null,/);
  // Kare başına rastgelelik ekranlar arasında eşitlenemiyor; ikisi kaldı
  assert.strictEqual((E.match(/Math\.random\(\)/g) || []).length, 6,
    'yeni bir tohumsuz Math.random eklenmiş olabilir');
});

// -------------------------------------------------------------- dağıtım

test('ana süreç: liderin seçimi diğer pencerelere, Spout/Syphon\'a ve web\'e', () => {
  const M = bare(read('src/main/main.js'));
  const fn = /function relayMdFollow\(sender, mp\) \{[\s\S]*?\n\}/.exec(M);
  assert.ok(fn, 'relayMdFollow bulunamadı');
  const f = fn[0];
  assert.match(f, /if \(ctl && ctl\.independent === true\) return;/, '"her ekran kendi seçer" açıkken dağıtılmamalı');
  assert.match(f, /if \(key === mdFollowSent\.key && now - mdFollowSent\.at < 250\) return;/);
  assert.match(f, /for \(const win of openWindows\(\)\) \{\s*if \(win\.webContents !== sender\) win\.webContents\.send\('md-follow', follow\);/);
  assert.match(f, /if \(ts && ts\.webContents !== sender\) ts\.webContents\.send\('md-follow', follow\);/);
  assert.match(f, /streamServer\.broadcast\(\{ type: 'md-follow', follow \}, 'overlay'\);/);
  assert.match(f, /seed: Number\.isInteger\(mp\.seed\) \? mp\.seed : null/);
  // Lider: ölçer mesajı geçirilen pencere. Birincil pencere yoksa Spout/Syphon.
  assert.match(M, /if \(primary && e\.sender !== primary\.webContents\) return;\s*if \(data && data\.mdPreset\) relayMdFollow\(e\.sender, data\.mdPreset\);/);
  // Pencere ve Spout/Syphon yokken lider önizleme
  assert.match(M, /ipcMain\.on\('md-live', \(e, mp\) => \{\s*if \(openWindows\(\)\.length \|\| textureShare\.window\(\)\) return;\s*relayMdFollow\(e\.sender, mp\);/);
});

test('pencereler ve web çıkışı izleme mesajını SVMdFollow yapıyor', () => {
  assert.match(read('src/main/preload-visualizer.js'),
    /onMdFollow: \(cb\) => ipcRenderer\.on\('md-follow', \(e, p\) => cb\(p\)\),/);
  const V = bare(read('src/visualizer/visualizer.js'));
  assert.match(V, /window\.api\.onMdFollow\(\(p\) => \{\s*window\.SVMdFollow = p \? Object\.assign\(\{ at: performance\.now\(\) \}, p\) : null;/);
  assert.match(V, /window\.SVMdLive = mdPreset;/);
});

test('web köprüsü md-follow iletisini dinleyiciye veriyor', () => {
  const sockets = [];
  class FakeWS {
    constructor() { this.readyState = 1; sockets.push(this); }
    send() {}
    close() {}
  }
  const win = {
    location: { search: '?token=t', pathname: '/', protocol: 'http:', host: 'localhost:1' },
    URLSearchParams,
    WebSocket: FakeWS,
    document: { documentElement: { setAttribute() {} } },
    setTimeout: () => 0,
    Date,
  };
  win.window = win;
  vm.runInContext(read('src/web/web-shim.js'), vm.createContext(win), { filename: 'web-shim.js' });
  const got = [];
  win.api.onMdFollow((p) => got.push(p));
  const payload = { id: 'p2', base: 'p1|40', cut: false, blend: 2, seed: 7 };
  sockets[0].onmessage({ data: JSON.stringify({ type: 'md-follow', follow: payload }) });
  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(got[0])), payload);
});

test('önizleme lider olduğunda seçimini yolluyor, izlerken yollamıyor', () => {
  assert.match(read('src/main/preload-admin.js'), /sendMdLive: \(p\) => ipcRenderer\.send\('md-live', p\),/);
  const P = bare(read('src/admin/preview.js'));
  const fn = /function reportMdLive\(now\) \{[\s\S]*?\n  \}/.exec(P);
  assert.ok(fn, 'reportMdLive bulunamadı');
  assert.match(fn[0], /if \(F && now - F\.at < 1500\) return;/, 'bir pencereyi izlerken lider değil');
  assert.match(fn[0], /if \(key === mdLiveKey && now - mdLiveAt < 500\) return;/);
  assert.match(P, /stack\.draw\(audio, mcfg, t, dt\);\s*reportMdLive\(now\);/);
});

// ---------------------------------------------------------------- ayar

test('seçenek varsayılan kapalı ve sahnelerin dışında', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const d = global.window.SV.defaultConfig();
  assert.strictEqual(d.milkdropControl.independent, false);
  assert.strictEqual(d.milkdrop.independent, undefined, 'sahneyle gelip gitmemeli');
  // Sahne ve şablon listelerinin hiçbiri milkdropControl'ü taşımıyor
  for (const f of ['src/admin/admin.js', 'src/admin/control.js', 'src/main/main.js', 'src/shared/templates.js']) {
    const s = read(f);
    const lists = s.match(/SCENE_KEYS = \[[\s\S]*?\]/g) || [];
    assert.ok(lists.length, f + ': sahne listesi bulunamadı');
    for (const l of lists) assert.ok(!/milkdropControl/.test(l), f + ': sahne listesinde milkdropControl var');
  }
});

test('panel seçeneği ve metinlerin İngilizcesi', () => {
  const PANEL = read('src/admin/milkdrop-panel.js');
  const I18N = read('src/shared/i18n.js');
  assert.match(bare(PANEL), /P\(\)\.row\('Ekranlar', selOf\(\[\s*\[0, 'Hepsinde aynı preset'\],\s*\[1, 'Her ekran kendi seçer'\],\s*\], control\(cfg\)\.independent === true \? 1 : 0, \(v\) => \{ control\(cfg\)\.independent = Number\(v\) === 1; \}\)\)\);/);
  for (const k of ['Ekranlar', 'Hepsinde aynı preset', 'Her ekran kendi seçer']) {
    assert.ok(I18N.includes("'" + k + "':"), k + ' sözlükte yok');
  }
  const note = /text: '(Hepsinde aynı presette[^\n]*?)',\r?\n/.exec(PANEL);
  assert.ok(note, 'not panelde bulunamadı');
  assert.ok(I18N.includes("'" + note[1] + "':"), 'notun İngilizcesi yok ya da metin uyuşmuyor');
});
