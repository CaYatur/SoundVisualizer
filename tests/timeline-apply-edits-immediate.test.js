'use strict';
/* Düzenlemeleri anında uygula: varsayılan kapalı; açıkken commit kafadaki
 * klipleri yeniden yazar; kapalıyken idle-drive (dururken ezmeme) korunur. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/admin/timeline-panel.js'), 'utf8');
const def = fs.readFileSync(path.join(__dirname, '../src/shared/defaults.js'), 'utf8');

test('applyEditsImmediately varsayılan false', () => {
  assert.match(def, /applyEditsImmediately:\s*false/);
});

test('panel: Anında Uygula düğmesi ve maybeApplyEditsNow commit sonrası', () => {
  assert.match(src, /function maybeApplyEditsNow\(/);
  assert.match(src, /tl-liveedit/);
  assert.match(src, /Anında Uygula/);
  assert.match(src, /maybeApplyEditsNow\(\);/);
  const commitAt = src.indexOf('function commit()');
  const body = src.slice(commitAt, commitAt + 900);
  assert.match(body, /maybeApplyEditsNow\(\)/);
});

test('panel: kapalıyken maybeApplyEditsNow erken döner', () => {
  assert.match(src, /if \(!cfg \|\| !cfg\.applyEditsImmediately\) return;/);
});
