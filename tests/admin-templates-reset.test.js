'use strict';
/* Hazır Şablonlar: kartın rozeti ve sıfırla düğmesi bilinçli olarak gizli
 * (hideCardReset). Sıfırlama bütün sahneyi fabrika ayarına döndürüyor;
 * "şablonu geri al" sanılıp kullanıcının katmanlarını silmesin. SCENE_KEYS
 * ve resetScene yerinde: bir "son şablonu geri al" bunların üstüne kurulabilir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const templates = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'templates.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'template-panel.js'), 'utf8');

test('templates section hides card reset chrome via hideCardReset flag', () => {
  const start = admin.indexOf("id: 'templates'");
  assert.ok(start > 0);
  const slice = admin.slice(start, start + 2200);
  assert.match(slice, /hideCardReset:\s*true/);
  assert.match(admin, /function sectionShowsResetChrome/);
  assert.match(admin, /sectionShowsResetChrome\(sec\)/);
});

test('templates roots still follow SCENE_KEYS for easy re-enable', () => {
  const start = admin.indexOf("id: 'templates'");
  const slice = admin.slice(start, start + 2200);
  assert.match(slice, /SVTemplates\.SCENE_KEYS/);
  assert.match(slice, /rootOmit:/);
  assert.match(templates, /function resetScene/);
  assert.match(templates, /SCENE_KEYS, apply, resetScene/);
  assert.match(admin, /SVTemplates\.resetScene/);
  assert.match(panel, /clearLastApplied/);
});
