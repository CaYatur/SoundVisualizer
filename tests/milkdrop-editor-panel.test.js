'use strict';
/* MilkDrop preset düzenleyicisinin oturumu (#578).
 *
 * Ekrandaki preset açılıyor, her düzeltme karışmadan ve geçmişe yazılmadan
 * yükleniyor, asıl preset hiç değişmiyor, kayıt yeni bir kimlikle yapılıyor
 * ve kaydetmeden kapatınca asıl preset geri geliyor. Otomatik geçiş
 * düzenlerken duruyor, kapatınca eski hâline dönüyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
require('../src/shared/milkdrop-cycle.js');
require('../src/shared/milkdrop-library.js');
require('../src/shared/milkdrop.js');
require('../src/shared/milkdrop-edit.js');

const SV = global.window.SV;
const SRC = '[preset00]\r\nfDecay=0.98\r\nzoom=1.0\r\nper_frame_1=zoom = zoom + 0.01;\r\nper_frame_2=q1 = time;\r\n';
const LIB = [{ id: 'm1', name: 'Bir', kind: 'milkdrop', source: SRC, author: 'Yazar' }];

async function fresh() {
  for (const f of ['../src/admin/milkdrop-panel.js', '../src/admin/milkdrop-editor.js']) {
    delete require.cache[require.resolve(f)];
  }
  const cfg = SV.defaultConfig();
  const el = (tag, props, kids) => ({ tag, props: props || {}, kids: kids || [] });
  const toasts = [];
  const saved = [];
  let pushes = 0;
  let applies = 0;
  window.SVPresets = undefined;
  window.SVMdFollow = null;
  window.SVI18n = undefined;
  window.api = {
    listPresets: () => Promise.resolve(LIB.concat(saved.map((p) => Object.assign({}, p)))),
    savePreset: (p) => {
      const i = saved.findIndex((x) => x.id === p.id);
      if (i >= 0) saved[i] = p; else saved.push(p);
      return Promise.resolve({ ok: true, preset: Object.assign({}, p, { updatedAt: 1 }) });
    },
  };
  window.SVPanel = {
    cfg: () => cfg,
    apply() { applies++; },
    push() { pushes++; },
    rerender() {},
    el,
    row: (label, node) => el('row', { label }, [node]),
    toast: (m, k) => toasts.push([m, k]),
  };
  const MP = require('../src/admin/milkdrop-panel.js');
  MP.init();
  await new Promise((r) => setImmediate(r));
  const ED = require('../src/admin/milkdrop-editor.js');
  return { MP, ED, cfg, toasts, saved, pushes: () => pushes, applies: () => applies };
}

// Ekranda m1: elle seçilmiş
function pick(env) {
  env.MP.go(env.cfg, LIB[0]);
}

test('ekrandaki preset açılıyor, otomatik geçiş duruyor', async () => {
  const env = await fresh();
  pick(env);
  env.cfg.milkdropControl.locked = false;
  env.ED.start();
  const S = env.ED.state();
  assert.ok(S, 'oturum açılmadı');
  assert.strictEqual(S.baseId, 'm1');
  assert.deepStrictEqual(S.blocks.per_frame, ['zoom = zoom + 0.01;', 'q1 = time;']);
  assert.strictEqual(S.values.zoom, 1);
  assert.strictEqual(S.name, 'Bir (düzenlendi)');
  assert.strictEqual(env.cfg.milkdropControl.locked, true, 'düzenlerken otomatik geçiş durmalı');
});

test('preset yoksa açılmıyor, söylüyor', async () => {
  const env = await fresh();
  env.cfg.milkdrop.presetId = '';
  env.cfg.milkdrop.source = '';
  env.ED.start();
  assert.strictEqual(env.ED.state(), null);
  assert.ok(env.toasts.some(([m, k]) => k === 'err' && /preset seçin/.test(m)));
});

test('her düzeltme yeni bir kimlikle, karışmadan ve geçmişe yazılmadan yükleniyor', async () => {
  const env = await fresh();
  pick(env);
  const h = env.MP.history();
  const before = h.canBack();
  env.ED.start();
  const S = env.ED.state();
  const pushes = env.pushes();
  S.blocks.per_frame = ['zoom = zoom + 0.02;', 'q1 = time;'];
  env.ED.live(true);
  const id1 = env.cfg.milkdrop.presetId;
  assert.ok(/^edit:m1:\d+$/.test(id1), 'düzeltmenin kimliği: ' + id1);
  assert.strictEqual(env.cfg.milkdropControl.cutTo, id1, 'karışmadan');
  assert.ok(/per_frame_1=zoom = zoom \+ 0\.02;/.test(env.cfg.milkdrop.source));
  assert.ok(env.pushes() > pushes, 'gönderilmeli');
  // Uzunluğu değişmeyen düzeltme de yükleniyor: kimlik yeni
  S.blocks.per_frame = ['zoom = zoom + 0.03;', 'q1 = time;'];
  env.ED.live(true);
  assert.notStrictEqual(env.cfg.milkdrop.presetId, id1);
  assert.strictEqual(h.canBack(), before, 'geçmişe kayıt düşmemeli');
  // Kütüphanedeki asıl preset değişmedi
  assert.strictEqual(LIB[0].source, SRC);
});

test('hatalar presetin satırında', async () => {
  const env = await fresh();
  pick(env);
  env.ED.start();
  const S = env.ED.state();
  S.blocks.per_frame = ['zoom = zoom + 0.01;', 'q1 = sin(time;'];
  env.ED.live(true);
  const d = S.diag.filter((x) => x.code !== 'dropped');
  assert.deepStrictEqual(d.map((x) => [x.block, x.line, x.code]), [['per_frame', 1, 'paren-open']]);
  S.blocks.per_frame = ['zoom = zoom + 0.01;', 'q1 = sin(time);'];
  env.ED.live(true);
  assert.deepStrictEqual(S.diag, []);
  assert.deepStrictEqual(S.over, { zoom: { block: 'per_frame', line: 0, relative: true } }, 'zoom denklemle eziliyor');
});

test('kayıt yeni bir kimlikle; ikinci kayıt aynı kopyayı güncelliyor, yeni kopya yeniden', async () => {
  const env = await fresh();
  pick(env);
  env.ED.start();
  const S = env.ED.state();
  S.values.zoom = 1.05;
  await env.ED.save(false);
  assert.strictEqual(env.saved.length, 1);
  const first = env.saved[0];
  assert.ok(/^md_ed_/.test(first.id) && first.id !== 'm1', 'yeni kimlik: ' + first.id);
  assert.strictEqual(first.name, 'Bir (düzenlendi)');
  assert.strictEqual(first.author, 'Yazar');
  // Dosyada tek basamaklı yazılmıştı; en az üç basamak (MilkDrop'un biçimi)
  assert.ok(/\r\nzoom=1.050\r\n/.test(first.source), first.source);
  assert.strictEqual(LIB[0].source, SRC, 'asıl preset değişmemeli');
  S.values.zoom = 1.06;
  await env.ED.save(false);
  assert.strictEqual(env.saved.length, 1, 'aynı kopya güncellenmeli');
  assert.ok(/\r\nzoom=1.060\r\n/.test(env.saved[0].source));
  await env.ED.save(true);
  assert.strictEqual(env.saved.length, 2, 'yeni kopya');
  assert.notStrictEqual(env.saved[1].id, first.id);
});

test('kaydetmeden kapatınca asıl preset ve kilit geri geliyor', async () => {
  const env = await fresh();
  pick(env);
  env.cfg.milkdropControl.locked = false;
  env.ED.start();
  env.ED.state().blocks.per_frame = ['q1 = 5;'];
  env.ED.live(true);
  assert.notStrictEqual(env.cfg.milkdrop.presetId, 'm1');
  env.ED.close();
  assert.strictEqual(env.ED.state(), null);
  assert.strictEqual(env.cfg.milkdrop.presetId, 'm1');
  assert.strictEqual(env.cfg.milkdrop.source, SRC);
  assert.strictEqual(env.cfg.milkdropControl.locked, false);
});

test('"Baştan" ilk metne dönüyor', async () => {
  const env = await fresh();
  pick(env);
  env.ED.start();
  const S = env.ED.state();
  S.blocks.per_frame = ['q1 = 5;'];
  S.values.zoom = 2;
  env.ED.live(true);
  env.ED.reset();
  assert.deepStrictEqual(S.blocks.per_frame, ['zoom = zoom + 0.01;', 'q1 = time;']);
  assert.strictEqual(S.values.zoom, 1);
  assert.strictEqual(env.cfg.milkdrop.source, SRC);
});
