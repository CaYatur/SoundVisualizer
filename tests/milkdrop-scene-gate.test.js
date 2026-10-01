'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Scene MilkDrop category is gated by stack + MilkDrop usage', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
  const i = admin.indexOf("id: 'milkdrop'");
  assert.ok(i > 0);
  const chunk = admin.slice(i, i + 900);
  assert.match(chunk, /show:\s*\(\)\s*=>/);
  assert.match(chunk, /isStackOn\(\)/);
  assert.match(chunk, /type === 'milkdrop'/);
  assert.match(chunk, /kind === 'visualizer'/);
  assert.ok(admin.includes('MilkDrop Preset'), 'studio MilkDrop tools remain');
});
