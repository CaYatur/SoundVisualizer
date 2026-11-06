'use strict';
/* Açık çıkışın sahne/şablon değişiminde bir geride kalması.

   Panel önizlemesi setConfig sonunda drawOnce çağırır ve gerçek ses
   yokken demo sinyale düşer; bu yüzden seçim hemen görünür. Görselleştirici
   penceresi sessizlikte duraklat açıkken (ve ses yokken) stack.draw'ı
   atlıyordu: applyConfig yığını güncellese de tuval önceki karenin
   piksellerinde kalıyordu. Bir sonraki değişiklik geçişle çizince ekranda
   "bir önceki seçim" belirdi — Şablon ve Sahne aynı applyConfig yolunu
   kullandığı için ikisinde de.

   Düzeltme: applyConfig needsPaint=true; sessizlik atlaması bu bayrağı
   yok sayar; ilk gerçek çizimde bayrak iner. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const VIS = read('src/visualizer/visualizer.js');
const PREV = read('src/admin/preview.js');
const ADMIN = read('src/admin/admin.js');
const TPL = read('src/admin/template-panel.js');

test('applyConfig yapılandırma gelince needsPaint ister', () => {
  const at = VIS.indexOf('function applyConfig(newCfg)');
  assert.ok(at > 0);
  const body = VIS.slice(at, VIS.indexOf('function applyMaster', at));
  assert.match(body, /needsPaint\s*=\s*true/);
});

test('sessizlikte duraklat needsPaint varken çizimi atlamaz; çizince bayrak iner', () => {
  assert.match(
    VIS,
    /const silent = cfg\.power\.pauseOnSilence && audio\.level < 0\.008 && audio\.bass < 0\.01 && !stack\.trans && !needsPaint;/
  );
  assert.match(VIS, /stack\.draw\(audio, mcfg, t, dt\);\n\s*needsPaint = false;/);
});

test('önizleme setConfig sonunda drawOnce ile boyar (çıkışla aynı seçim yolu)', () => {
  const at = PREV.indexOf('function setConfig(next)');
  assert.ok(at > 0);
  const body = PREV.slice(at, PREV.indexOf('function ingest', at));
  assert.match(body, /drawOnce\(\)/);
});

test('sahne ve şablon aynı push/apply yolundan çıkar (özel şablon yolu yok)', () => {
  const sceneAt = ADMIN.indexOf('actions.applyScene = (id, opts) => {');
  assert.ok(sceneAt > 0);
  const nextAction = ADMIN.indexOf('\n  actions.', sceneAt + 10);
  const sceneBody = ADMIN.slice(sceneAt, nextAction > 0 ? nextAction : sceneAt + 8000);
  assert.match(sceneBody, /push\(true\)/);
  assert.match(TPL, /P\(\)\.apply\(\)/);
  const applyAt = ADMIN.indexOf('function applyAll()');
  assert.ok(applyAt > 0);
  const applyBody = ADMIN.slice(applyAt, applyAt + 220);
  assert.match(applyBody, /previewFromPush = true/);
  assert.match(applyBody, /push\(true\)/);
  const pushAt = ADMIN.indexOf('function push(immediate)');
  const pushBody = ADMIN.slice(pushAt, ADMIN.indexOf('function lightSig', pushAt));
  assert.match(pushBody, /SVPreview\.setConfig\(outputConfig\(\)\)/);
  assert.match(pushBody, /sendFullConfig\(\)/);
});
