'use strict';
/* Ready Templates card: modified badge roots must match template apply SCENE_KEYS,
 * and reset must use resetScene so the badge does not rebound. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const templates = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'templates.js'), 'utf8');
const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'template-panel.js'), 'utf8');

test('templates section roots follow SVTemplates.SCENE_KEYS (not partial trio)', () => {
  const start = admin.indexOf("id: 'templates'");
  assert.ok(start > 0);
  const slice = admin.slice(start, start + 1200);
  assert.match(slice, /SVTemplates\.SCENE_KEYS/);
  assert.doesNotMatch(slice, /roots:\s*\['visualizer',\s*'background',\s*'postfx'\]/);
  assert.match(slice, /rootOmit:/);
  assert.match(slice, /background\.transparent/);
  assert.match(slice, /logo\.src/);
});

test('resetSection uses SVTemplates.resetScene for templates card', () => {
  assert.match(admin, /sec\.id === 'templates'/);
  assert.match(admin, /SVTemplates\.resetScene/);
  assert.match(templates, /function resetScene/);
  assert.match(templates, /SCENE_KEYS, apply, resetScene/);
  assert.match(panel, /clearLastApplied/);
});
