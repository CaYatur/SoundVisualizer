'use strict';
/* T-BAR (#905). Canlı sayfasındaki çubuk sahne geçişini elle sürüyor: kurulum, ilerleme, bitiş ve
   geri alma. Yığın DOM'suz sınanıyor (tests/layers-transition.test.js ile aynı sahte tuval ve mod).
   Geri almada giden sahnenin örnekleri canlıya AYNEN dönmeli: MilkDrop ya da parçacıklar baştan
   başlarsa iptal, kesmeden kötü görünür. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

function fakeCanvas(log, name) {
  const c = { name, parentNode: null, style: {} };
  c.parentNode = { removeChild(x) { log.push('sök:' + x.name); x.parentNode = null; } };
  return c;
}
function entry(log, key, keep) {
  const mode = { dispose() { log.push('at:' + key); }, draw() {} };
  if (keep) mode.keepAcrossTransitions = true;
  return { layer: { id: key, kind: 'visualizer', type: key }, key, canvas: fakeCanvas(log, key), ctx: null, mode };
}
const SPEC = { type: 'crossfade', duration: 1 };
const OLD_CFG = { layers: [{ id: 'bg' }, { id: 'md' }] };

function started(log, keepMd) {
  const md = entry(log, 'md', keepMd);
  const bg = entry(log, 'bg', false);
  const s = new L.LayerStack(null, {});
  s.entries = [bg, md];
  s.tbar({ phase: 'arm' });
  s.beginTransition(OLD_CFG, SPEC, new Set(keepMd ? ['md'] : []));
  assert.strictEqual(s._claimManual(false), true, 'kurulan geçiş elle sürülüyor');
  // Varış sahnesine yeni kurulan katman
  const neu = entry(log, 'neu', false);
  s.entries.push(neu);
  return { s, md, bg, neu };
}

test('kurulan geçiş kare saatiyle ilerlemiyor, çubuğun değerini gösteriyor', () => {
  const { s } = started([], false);
  assert.strictEqual(s._tickTransition(5).p, 0, '5 saniye geçse de karışım çubukta');
  s.tbar({ phase: 'move', p: 0.4 });
  assert.strictEqual(s._tickTransition(1 / 60).p, 0.4, 'doğrusal');
  s.tbar({ phase: 'move', p: 7 });
  assert.strictEqual(s._tickTransition(1 / 60).p, 1, 'sınırlanıyor');
  assert.ok(s.trans, 'uçta da kendiliğinden bitmiyor: bırakılınca biter');
});

test('bitiş: giden sahne atılıyor, varış sahnesi canlı', () => {
  const log = [];
  const { s, neu } = started(log, false);
  s.tbar({ phase: 'move', p: 1 });
  s.tbar({ phase: 'end' });
  assert.strictEqual(s.trans, null);
  assert.ok(log.includes('at:bg') && log.includes('at:md'), log.join(','));
  assert.ok(!log.includes('at:neu'));
  assert.ok(s.entries.includes(neu));
});

test('geri alma: giden sahnenin örnekleri aynen dönüyor, yeni kurulanlar atılıyor', () => {
  const log = [];
  const { s, md, bg, neu } = started(log, true);
  assert.notStrictEqual(s.entries.indexOf(md), -1, 'iki sahnede duran katman varış yığınında');
  s.tbar({ phase: 'move', p: 0.3 });
  s.tbar({ phase: 'cancel' });
  assert.strictEqual(s.trans, null);
  assert.deepStrictEqual(s.entries, [bg, md], 'aynı örnekler, aynı sıra');
  assert.ok(log.includes('at:neu'), 'varış sahnesine kurulan atıldı');
  assert.ok(!log.includes('at:bg') && !log.includes('at:md'), 'giden sahneye dokunulmadı: ' + log.join(','));
  assert.strictEqual(s.prevCfg, OLD_CFG);
  assert.strictEqual(s.lastSig, L.sceneSignature(OLD_CFG), 'panel eski görünümü gönderince yeni geçiş başlamıyor');
  assert.strictEqual(s.signature, 'bg;md');
});

test('kurulum tek geçişlik, süresi geçince ve karartmada tutmuyor', () => {
  const log = [];
  const s = new L.LayerStack(null, {});
  s.entries = [entry(log, 'a', false)];
  s.tbar({ phase: 'arm' });
  s.beginTransition({}, SPEC, new Set());
  assert.strictEqual(s._claimManual(true), false, 'karartma geçişi elle sürülmüyor');
  s.endTransition();
  s.beginTransition({}, SPEC, new Set());
  assert.strictEqual(s._claimManual(false), false, 'kurulum ilk geçişte harcandı');
  s.endTransition();
  s.tbar({ phase: 'arm' });
  s._manualArm -= 5000;
  s.beginTransition({}, SPEC, new Set());
  assert.strictEqual(s._claimManual(false), false, 'süresi geçen kurulum alakasız geçişi yakalamıyor');
  assert.ok(!s.trans.manual);
  // Elle sürülmeyen geçişe çubuk iletisi dokunmuyor
  s.tbar({ phase: 'move', p: 0.5 });
  s.tbar({ phase: 'cancel' });
  assert.ok(s.trans && s.trans.elapsed === 0, 'otomatik geçiş yerinde');
});

test('çizelgeye bağlı geçiş elle sürülen geçişi ezmiyor', () => {
  const { s } = started([], false);
  s.tbar({ phase: 'move', p: 0.25 });
  window.SVTimeline = { transitionAt: () => { throw new Error('çağrılmamalı'); } };
  s.syncTimeline({ tracks: [] }, 3);
  delete window.SVTimeline;
  assert.strictEqual(s._tickTransition(0.1).p, 0.25);
});

test('ileti yolu: panel → ana süreç → her çıkış, kaplama ve panel önizlemesi', () => {
  const main = read('src/main/main.js');
  assert.match(main, /const TBAR_PHASES = new Set\(\['arm', 'move', 'end', 'cancel'\]\);/);
  assert.match(main, /ipcMain\.on\('tbar', \(e, m\) => \{\s*if \(!m \|\| !TBAR_PHASES\.has\(m\.phase\)\) return;\s*const msg = \{ phase: m\.phase, p: Math\.max\(0, Math\.min\(1, Number\(m\.p\) \|\| 0\)\) \};\s*sendToVisualizers\('tbar', msg\);/);
  assert.match(main, /streamServer\.broadcast\(\{ type: 'tbar', m: msg \}, 'overlay'\)/);
  assert.match(read('src/main/preload-admin.js'), /sendTbar: \(m\) => ipcRenderer\.send\('tbar', m\),/);
  assert.match(read('src/main/preload-visualizer.js'), /onTbar: \(cb\) => ipcRenderer\.on\('tbar', \(e, m\) => cb\(m\)\),/);
  assert.match(read('src/visualizer/visualizer.js'), /window\.api\.onTbar\(\(m\) => \{ if \(stack\) stack\.tbar\(m\); \}\);/);
  const shim = read('src/web/web-shim.js');
  assert.match(shim, /msg\.type === 'tbar'\) \{\s*handlers\.tbar\.forEach\(\(h\) => h\(msg\.m\)\);/);
  assert.match(shim, /onTbar: \(cb\) => handlers\.tbar\.push\(cb\),/);
  assert.match(read('src/admin/preview.js'), /tbar: \(m\) => \{ if \(stack\) stack\.tbar\(m\); \},/);
});

test('panel: çubuk tutulurken sayfa kurulmuyor, uçta bitiyor, başta geri alınıyor', () => {
  const ls = read('src/admin/live-shell.js');
  assert.match(ls, /if \(tb\.drag\) \{ tb\.dirty = true; return; \}/);
  assert.match(ls, /tbarSend\(\{ phase: 'arm' \}\);\s*const snap = P\(\)\.tbarStart\(cue\);/, 'kurulum sahneden önce');
  assert.match(ls, /if \(tb\.p >= TB_END\) tbarFinish\(\);\s*else if \(tb\.p <= TB_START\) tbarCancel\(\);\s*else \{ tbarFlush\(\); paintSoon\(\); \}/);
  assert.match(ls, /tbarSend\(\{ phase: 'cancel' \}\);\s*tbarReset\(\);\s*P\(\)\.tbarRestore\(snap\);/, 'çıkış geri aldıktan sonra eski görünüm');
  const admin = read('src/admin/admin.js');
  assert.match(admin, /if \(!sc \|\| !sc\.data \|\| isBlackedOut\(\)\) return null;/, 'karartmada çubuk çalışmıyor');
  assert.match(admin, /noRender: true \}\);\s*return snap;/);
  assert.match(admin, /if \(opts && opts\.noRender\) return;\s*render\(\);/);
});

test('çeviri: çubuğun metinleri İngilizcede de var', () => {
  const src = read('src/shared/i18n.js');
  for (const k of ['T-bar', 'Karışımı tamamla', 'Sürükle: sıradaki sahneyi elle karıştır. Uca varınca canlıya geçer, başa dönünce geri alınır.']) {
    assert.ok(src.includes("'" + k + "':"), k);
  }
});

test('OSC ağacı: show/tbar mutlak konum, sınırlanıyor; panel yakalamadan önce oynatmıyor', () => {
  global.window = global.window || {};
  const tree = require('../src/shared/osc-tree.js');
  const plan = (args) => tree.plan([{ address: '/cayadev/show/tbar', args }], { layers: [] });
  assert.strictEqual(plan([0.4]).consumed.length, 1);
  const step = (args) => JSON.stringify(plan(args)).match(/"op":"tbar","value":([0-9.]+)/);
  assert.strictEqual(Number(step([0.4])[1]), 0.4);
  assert.strictEqual(Number(step([3])[1]), 1, 'sınırlanıyor');
  assert.strictEqual(plan(['x']).consumed.length, 0, 'sayı olmayan düşüyor');
  assert.match(read('src/admin/control.js'), /if \(step\.op === 'tbar'\) \{\s*if \(window\.SVLiveShell && window\.SVLiveShell\.tbarTo\) window\.SVLiveShell\.tbarTo\(step\.value\);/);
  const ls = read('src/admin/live-shell.js');
  assert.match(ls, /if \(!tb\.live && !tb\.ext\) \{\s*if \(Math\.abs\(x - tb\.rest\) > 0\.05\) return;\s*tb\.ext = true;/, 'yakalama');
  assert.match(read('docs/REMOTE-PROTOCOL.md'), /\| `show\/tbar` \| `\[0–1\]` \|/);
});

test('sahne sayacı: aynı yapılı iki sahne de geçiş yapıyor, ayar sürüklemek yapmıyor', () => {
  const base = { visualizer: { type: 'none' }, background: { type: 'gradient' }, layers: [{ kind: 'background', type: 'solid' }] };
  const a = L.sceneSignature(Object.assign({}, base, { _sceneSeq: 4 }));
  const b = L.sceneSignature(Object.assign({}, base, { _sceneSeq: 5 }));
  assert.notStrictEqual(a, b, 'elle sahne değişimi imzayı değiştiriyor');
  assert.strictEqual(L.sceneSignature(Object.assign({}, base, { _sceneSeq: 4, master: 0.3 })), a, 'ayar değişimi değiştirmiyor');
  assert.strictEqual(L.sceneSignature(base), L.sceneSignature(Object.assign({}, base)), 'sayaçsız (dışa aktarım) aynı');
  const admin = read('src/admin/admin.js');
  assert.match(admin, /if \(!\(opts && opts\.light\) && cfg\._activeSceneId !== id\) cfg\._sceneSeq = \(\(cfg\._sceneSeq \| 0\) \+ 1\) % 1000000000;/,
    'çizelge (light) ve etkin sahneyi yeniden uygulamak saymıyor');
  assert.match(admin, /if \(snap\.seq === undefined\) delete cfg\._sceneSeq;\s*else cfg\._sceneSeq = snap\.seq;/, 'geri almada sayaç da dönüyor');
});
