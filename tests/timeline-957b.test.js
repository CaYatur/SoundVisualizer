/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
'use strict';
// #957: belirlenimci geçiş, işaret vuruş testi, sahne bileşimi, başlık sığdırma,
// otomasyon hedefi kaldırma / öğren ve tema yazma yolu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const TL = require('../src/shared/timeline.js');
const FIT = require('../src/admin/topbar-fit.js');
const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('geçiş ilerlemesi zamanın saf işlevi: %50 → 0.5 (eğriyle)', () => {
  const c = { start: 10, fade: 2, transType: 'crossfade' };
  const lin = TL.transitionProgress(c, 11, 0.7);
  assert.strictEqual(lin.raw, 0.5);
  const sq = TL.transitionProgress(c, 11, 0.7, (x) => x * x);
  assert.strictEqual(sq.p, 0.25);
  assert.strictEqual(TL.transitionProgress(c, 12, 0.7), null);
  assert.strictEqual(TL.transitionProgress({ start: 0, fade: 1, transType: 'cut' }, 0.5, 1), null);
  // Klip süresi 0: genel süre
  assert.strictEqual(TL.transitionProgress({ start: 0, fade: 0 }, 0.35, 0.7).raw, 0.5);
});

test('parametre değişimi yeniden oynatmadan: süre her çağrıda klipten okunur', () => {
  const c = { start: 0, fade: 2 };
  assert.strictEqual(TL.transitionProgress(c, 1, 1).raw, 0.5);
  c.fade = 4;
  assert.strictEqual(TL.transitionProgress(c, 1, 1).raw, 0.25);
  const L = src('src/visualizer/layers.js');
  assert.match(L, /syncTimeline/);
  assert.match(src('src/visualizer/visualizer.js'), /syncTimeline\(cfg\.timeline, showT\)/);
});

test('işaret vuruş testi: kapsül, çizgi ±4, sağdaki kazanır', () => {
  const ms = [{ id: 'a', t: 1 }, { id: 'b', t: 1.2 }];
  const o = { xOf: (t) => t * 100, widthOf: () => 40, rulerH: 30 };
  assert.strictEqual(TL.markerHit(ms, 100, 2, o), null, 'üstteki döngü bandı işarete gitmez');
  assert.strictEqual(TL.markerHit(ms, 125, 20, o).id, 'b');
  assert.strictEqual(TL.markerHit(ms, 96, 20, o).id, 'a');
  assert.strictEqual(TL.markerHit(ms, 300, 20, o), null);
  assert.strictEqual(TL.markerHit(ms, 100, 40, o), null);
  assert.strictEqual(TL.markerStep(ms, 1, 1).id, 'b');
  assert.strictEqual(TL.markerStep(ms, 1.2, -1).id, 'a');
  assert.strictEqual(TL.markerStep(ms, 5, 1), null);
});

test('sahne yığını: üstteki önde, susturulan atlanır, solo süzer', () => {
  const tl = TL.makeTimeline({ tracks: [
    { id: 'u', kind: 'clip', clips: [{ id: 'c1', type: 'scene', ref: 's1', start: 0, dur: 10 }] },
    { id: 'l', kind: 'clip', clips: [{ id: 'c2', type: 'scene', ref: 's2', start: 0, dur: 10 }] },
  ] });
  const st = TL.sceneStack(tl, 5);
  assert.strictEqual(st.length, 2);
  tl.tracks[1].muted = true;
  assert.strictEqual(TL.sceneStack(tl, 5).length, 1);
  tl.tracks[1].muted = false;
  tl.tracks[1].solo = true;
  const so = TL.sceneStack(tl, 5);
  assert.strictEqual(so.length, 1);
  assert.strictEqual(so[0].clip.id, 'c2');
  assert.strictEqual(TL.makeTrack({}).opacity, 1);
  assert.strictEqual(TL.makeTrack({ opacity: 3 }).opacity, 1);
});

test('başlık sığdırma: çakışma ve en düşük düzey', () => {
  assert.strictEqual(FIT.overlaps({ right: 100 }, { left: 110, right: 200 }, { left: 220 }, 8), false);
  assert.strictEqual(FIT.overlaps({ right: 100 }, { left: 104, right: 200 }, { left: 220 }, 8), true);
  assert.strictEqual(FIT.fitLevel((lv) => lv < 3), 3);
  assert.strictEqual(FIT.fitLevel(() => false), 0);
});

test('otomasyon: hedef kaldırma, öğren, kayıt yapılandırmaya yazılır', () => {
  const T = src('src/admin/timeline-panel.js');
  assert.match(T, /function clearTarget/);
  assert.match(T, /'Hedefi Kaldır'/);
  assert.match(T, /it\.path === trk\.target\) clearTarget/);
  assert.match(T, /function startLearn/);
  assert.match(T, /ct\.keys = trk\.keys\.map/);
  assert.match(T, /closest\('input, button, select'\)/);
  assert.match(src('src/shared/i18n.js'), /'Hedefi Kaldır': 'Remove Target'/);
});

test('tema: başlık menüsü ve Ayarlar aynı yoldan yazar', () => {
  const A = src('src/admin/admin.js');
  assert.match(A, /function commitUiTheme/);
  assert.match(A, /onclick: \(\) => \{ commitUiTheme\(c\.id\); menu\.remove\(\); \}/);
  assert.doesNotMatch(A, /onclick: \(\) => \{ T\.set\(c\.id\)/);
});

test('ad düzenleme ve bileşim kaynakları', () => {
  const S = src('src/admin/scene-shell.js');
  assert.match(S, /sv-renaming/);
  const A = src('src/admin/admin.js');
  assert.match(A, /tlUnder/);
  assert.match(A, /data\.layers = data\.layers\.filter\(\(l\) => !\(l && l\.tlUnder\)\)/);
});

test('#957 cihaz varsayılanı işletim sistemini izler', () => {
  const T = require('../src/shared/ui-themes.js');
  assert.strictEqual(T.resolve('system', true).id, 'dark');
  assert.strictEqual(T.resolve('system', false).id, 'light');
  assert.strictEqual(T.resolve('system', true, true).id, 'contrast');
  assert.strictEqual(T.resolve('system', false, true).id, 'contrast');
});
