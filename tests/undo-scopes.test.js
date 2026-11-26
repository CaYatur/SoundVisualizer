/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GERİ AL KAPSAMLARI (#1170) ve önizleme kipinin canlı kullanım açıkları (#1168).
   Kapsamlar iç içe düzenlemede yalnız kendi değişikliklerini geri alıyor; kip kapalıyken
   sahne yığını eskisi gibi. Kaynak denetimleri: T-bar, Canlı faderleri, kumanda ve MCP. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/admin/undo.js');
const D = require('../src/shared/program-draft.js');
const RC = require('../src/main/remote-commands.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

const SCENE = ['visualizer', 'layers'];
// Yapılandırma ve kip: draft açıkken anahtarlar yapılandırmanın tamamı (kitaplık hariç)
function rig() {
  const cfg = { visualizer: { type: 'bars' }, layers: [], audio: { device: 'a' }, scenes: [] };
  const st = { draft: false, applied: 0 };
  const h = U.create({
    get keys() { return st.draft ? Object.keys(cfg).filter((k) => k !== 'scenes') : SCENE; },
    get: (k) => cfg[k],
    set: (k, v) => { if (v === undefined) delete cfg[k]; else cfg[k] = v; },
    apply: () => { st.applied++; },
    changed: () => {},
  });
  const edit = (fn) => { fn(); h.settleNow(); };
  h.settleNow();
  return { cfg, st, h, edit };
}

test('kip kapalı: sahne yığını yalnız sahne anahtarlarını geri alır (aygıta dokunmaz)', () => {
  const { cfg, h, edit } = rig();
  edit(() => { cfg.visualizer = { type: 'wave' }; cfg.audio = { device: 'b' }; });
  h.undo();
  assert.strictEqual(cfg.visualizer.type, 'bars');
  assert.strictEqual(cfg.audio.device, 'b');
  h.redo();
  assert.strictEqual(cfg.visualizer.type, 'wave');
});

test('taslak kapsamı: iç içe düzenlemede her yığın kendi değişikliğini geri alır', () => {
  const { cfg, st, h, edit } = rig();
  edit(() => { cfg.visualizer = { type: 'wave' }; }); // sahne adımı
  h.setBase('draft', () => { st.draft = true; });
  edit(() => { cfg.audio = { device: 'staged' }; }); // taslakta aygıt da geri alınır
  edit(() => { cfg.visualizer = { type: 'ring' }; });
  h.undo();
  assert.strictEqual(cfg.visualizer.type, 'wave');
  h.undo();
  assert.strictEqual(cfg.audio.device, 'a');
  assert.strictEqual(h.canUndo(), false, 'taslak yığını sahne adımını görmez');
  h.setBase('', () => { st.draft = false; });
  h.dropBase('draft');
  assert.strictEqual(h.canUndo(), true, 'sahne yığını geri geldi');
  h.undo();
  assert.strictEqual(cfg.visualizer.type, 'bars');
});

test('yinele yığını yalnız aynı kapsamdaki yeni düzenlemeyle silinir', () => {
  const { cfg, st, h, edit } = rig();
  edit(() => { cfg.visualizer = { type: 'wave' }; });
  h.undo();
  assert.strictEqual(h.canRedo(), true);
  h.setBase('draft', () => { st.draft = true; });
  edit(() => { cfg.layers = [{ id: 'x' }]; });
  h.setBase('', () => { st.draft = false; });
  assert.strictEqual(h.canRedo(), true, 'taslaktaki düzenleme sahne yinelemesini silmedi');
  edit(() => { cfg.visualizer = { type: 'ring' }; });
  assert.strictEqual(h.canRedo(), false);
});

test('Sahneye Gönder taslak geçmişini kapatır (reset), kopyada olmayan anahtar silinir', () => {
  const { cfg, st, h, edit } = rig();
  h.setBase('draft', () => { st.draft = true; });
  edit(() => { cfg.extra = { on: true }; });
  h.undo();
  assert.strictEqual(cfg.extra, undefined, 'eski kopyada olmayan anahtar geri alınca kalkar');
  h.redo();
  assert.deepStrictEqual(cfg.extra, { on: true });
  h.reset();
  assert.strictEqual(h.canUndo(), false);
  assert.strictEqual(h.canRedo(), false);
});

test('Timeline klip kapsamı taslak açıkken taslağa özel, kapanınca eski klip yığını döner', () => {
  const { cfg, st, h, edit } = rig();
  h.scope('clip:a');
  edit(() => { cfg.visualizer = { type: 'wave' }; });
  h.setBase('draft', () => { st.draft = true; });
  assert.strictEqual(h.scopeKey(), 'clip:a');
  assert.strictEqual(h.canUndo(), false);
  h.setBase('', () => { st.draft = false; });
  assert.strictEqual(h.canUndo(), true);
});

test('adım listesi değişen alanları adlandırır; bellek sınırı en eski adımları atar', () => {
  const { cfg, h, edit } = rig();
  edit(() => { cfg.layers = [{ id: 'a' }]; });
  edit(() => { cfg.visualizer = { type: 'wave' }; });
  assert.deepStrictEqual(h.steps(5), [['visualizer'], ['layers']]);
  h.undo();
  assert.deepStrictEqual(h.redoSteps(5), [['visualizer']]);
  assert.ok(U.MAX_CHARS > 1024 * 1024);
  const big = 'x'.repeat(Math.ceil(U.MAX_CHARS / 3));
  for (let i = 0; i < 6; i++) edit(() => { cfg.visualizer = { type: 'wave', pad: big + i }; });
  assert.ok(h.steps(60).length <= 3, 'toplam boy sınırı aşılınca eski adımlar düştü');
});

test('withProgram: kitaplık yerinde kalır, Program tarafındaki kitaplık değişikliği taslağa geçer', () => {
  const s = D.create();
  const cfg = { a: 1, scenes: [{ id: 's1' }] };
  s.begin({ a: 0, scenes: [{ id: 's1' }] });
  const draftA = cfg.a;
  const scenesRef = cfg.scenes;
  s.withProgram(cfg, () => {
    assert.strictEqual(cfg.a, 0);
    assert.strictEqual(cfg.scenes, scenesRef, 'kitaplık kopyalanmadı');
    cfg.a = 5;
    cfg.scenes.push({ id: 's2' });
  });
  assert.strictEqual(cfg.a, draftA);
  assert.strictEqual(cfg.scenes.length, 2);
  assert.strictEqual(s.program().a, 5);
  assert.strictEqual(s.program().scenes.length, 2);
  assert.notStrictEqual(s.program().scenes, cfg.scenes, 'Program kendi kopyasını tutar');
});

test('kumanda ve MCP: gönderim ve dondurma izinli, araçlar paneli olmadan düzgün hata verir', async () => {
  assert.ok(RC.actionAllowed('previewTake'));
  assert.ok(RC.actionAllowed('outputFreeze'));
  const mcp = require('../src/shared/mcp.js');
  const tools = mcp.tools('en');
  const take = tools.find((t) => t.name === 'sv_preview_take');
  const freeze = tools.find((t) => t.name === 'sv_set_output_freeze');
  assert.ok(take && freeze);
  const html = read('src/web/remote.html');
  assert.match(html, /data-run="previewTake"/);
  assert.match(html, /data-run="outputFreeze"/);
  const control = read('src/admin/control.js');
  const at = control.indexOf('function runAction(action, cfg)');
  const body = control.slice(at, control.indexOf('function runActionManual', at));
  // Program sarmalayıcısından ÖNCE: gönderim taslağı okur
  assert.ok(body.indexOf("action === 'previewTake'") < body.indexOf('panel.onProgram('));
});

test('çıkış dondurma: DOM videoları durur, web çıkışı ve sonradan açılan kaplama da alır', () => {
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /frozenMedia\.add\(v\)/);
  assert.match(read('src/web/web-shim.js'), /msg\.type === 'output-safety'/);
  const main = read('src/main/main.js');
  assert.match(main, /broadcast\(\{ type: 'output-safety', m: outputSafetyState \}, 'overlay'\)/);
  assert.match(read('src/main/stream-server.js'), /hooks\.getOutputSafety\(\)/);
});

test('önizleme kipi: T-bar taslağı karıştırır, Canlı faderleri Program\'ı sürer; kip kapalıyken eski yollar', () => {
  const live = read('src/admin/live-shell.js');
  assert.match(live, /P\(\)\.tbarStart\(P\(\)\.draftCue\)/);
  assert.match(live, /const cfg = pv \? P\(\)\.programView\(\) : P\(\)\.cfg\(\);/);
  // Kip kapalı: fader eski gönderim yolunu kullanır
  assert.match(live, /if \(commit\) commit\(false\); else P\(\)\.push\(false\);/);
  const admin = read('src/admin/admin.js');
  assert.match(admin, /if \(id === DRAFT_CUE\) return draftTbarStart\(\);/);
  assert.match(admin, /const blacked = isBlackedOut\(\) && !draftOn\(\);/);
  assert.match(admin, /activeSceneId: \(\) => \(draftOn\(\) && activeCategory === 'live' \? programSceneId : activeSceneId\)/);
  assert.match(admin, /const undoKeys = \(\) => \(draftOn\(\) \? Object\.keys\(cfg\)\.filter\(\(k\) => SHARED\.indexOf\(k\) < 0\) : SCENE_KEYS\);/);
  // programEdit kip kapalıyken doğrudan cfg + push
  assert.match(admin, /if \(!draftOn\(\)\) \{ fn\(cfg\); push\(!!now\); return; \}/);
});
