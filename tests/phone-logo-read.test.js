'use strict';
/* PC hedefinde yerel logo baytı yoksa telefon bağlantıdan ister. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('logoLibRead falls back to logo.get only while the PC is the target', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/mobile/android-host.js'), 'utf8');
  assert.match(src, /if \(rec && rec\.b64\) return rec/);
  assert.match(src, /if \(!pc\.on\) return rec \|\| null/);
  assert.match(src, /pcAsk\('logo\.get', \{ id \}\)/);
});
