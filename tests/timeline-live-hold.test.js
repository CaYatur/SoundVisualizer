'use strict';
/* Canlı düzenleme tutuşu + boş yığın: çizelge klibi elle yapılan
   Sahne/Şablon/katman seçimini ezerken önizleme yeni, açık çıkış eski
   kalıyordu. Oynatma kafası boşluktayken sorun yoktu; klipteyken vardı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const TL = read('src/admin/timeline-panel.js');
const ADMIN = read('src/admin/admin.js');
const SHELL = read('src/admin/scene-shell.js');
const LAYERS = read('src/visualizer/layers.js');

test('çizelge noteLiveEdit ve liveHoldHead API sunar', () => {
  assert.match(TL, /function noteLiveEdit\(/);
  assert.match(TL, /let liveHoldHead = null/);
  assert.match(TL, /noteLiveEdit,/);
  assert.match(TL, /_liveHoldHead:\s*\(\)\s*=>\s*liveHoldHead/);
});

test('aynı klipte tutuş varken applyClipsAt sahneyi yeniden ateşlemez', () => {
  const at = TL.indexOf('function applyClipsAt(t)');
  assert.ok(at > 0, 'applyClipsAt bulunamadı');
  const body = TL.slice(at, TL.indexOf('function fireClip', at));
  assert.match(body, /if \(liveHoldHead != null\)/);
  assert.match(body, /if \(head === liveHoldHead\)/);
  assert.match(body, /liveHoldHead = null/);
  assert.match(body, /!scenes\.length[\s\S]*liveHoldHead = null/);
});

test('elle sahne (light değil) ve applyAll çizelgeye noteLiveEdit yazar', () => {
  assert.match(ADMIN, /function noteTimelineLiveEdit\(/);
  const sceneAt = ADMIN.indexOf('actions.applyScene = (id, opts) => {');
  const nextAction = ADMIN.indexOf('\n  actions.', sceneAt + 10);
  const sceneBody = ADMIN.slice(sceneAt, nextAction > 0 ? nextAction : sceneAt + 9000);
  assert.match(sceneBody, /if \(!\(opts && opts\.light\)\) noteTimelineLiveEdit\(\)/);
  const applyAt = ADMIN.indexOf('function applyAll()');
  const applyBody = ADMIN.slice(applyAt, applyAt + 450);
  assert.match(applyBody, /noteTimelineLiveEdit\(\)/);
});

test('tlUnder kilitli olsa da silinebilir', () => {
  const at = SHELL.indexOf('remove(id) {');
  assert.ok(at > 0);
  const body = SHELL.slice(at, at + 450);
  assert.match(body, /list\[i\]\.locked && !list\[i\]\.tlUnder/);
});

test('yığın açık + boş liste resolve sentezlemez (MilkDrop geri gelmez)', () => {
  assert.match(
    LAYERS,
    /const stackOn = !!\(cfg && cfg\.layerStack && cfg\.layerStack\.enabled\);\n\s*const used = list\.length \? list\.map\(normalizeLayer\) : \(stackOn \? \[\] : synthesize\(cfg\)\);/
  );
});
