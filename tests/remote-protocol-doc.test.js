'use strict';
/* docs/REMOTE-PROTOCOL.md kumanda istemcilerinin sözleşmesi (#443): koddaki izin listeleriyle
   aynı kalmalı. Liste kodda değişip belge unutulursa burada düşer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const DOC = read('docs/REMOTE-PROTOCOL.md');

test('belge: her adlı eylem ve her izinli ayar yolu yazılı', () => {
  const RC = require('../src/main/remote-commands.js');
  for (const id of RC.ACTIONS) assert.ok(DOC.includes('`' + id + '`'), 'run: ' + id);
  const main = read('src/main/main.js');
  const block = main.slice(main.indexOf('const REMOTE_ALLOWED = ['), main.indexOf('];', main.indexOf('const REMOTE_ALLOWED = [')));
  const paths = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length > 10);
  for (const p of paths) assert.ok(DOC.includes('`' + (p.endsWith('.') ? p + '*' : p) + '`'), 'set: ' + p);
});

test('belge: sabit ağaçtaki adresler yazılı, ağacın bilmediği adres yazılmamış', () => {
  global.window = global.window || {};
  const tree = require('../src/shared/osc-tree.js');
  const cfg = { layers: [{ id: 'a' }, { id: 'b' }] };
  const rows = [...DOC.matchAll(/^\| `([a-z/<>n]+)` \| `\[([^\]]*)\]`/gm)].map((m) => m[1]);
  assert.ok(rows.length >= 15, 'tablo okunamadı: ' + rows.length);
  const sample = { 'show/palette': ['theme'], 'show/transition': ['crossfade'], scene: ['A'], visualizer: ['bars'], background: ['ink'], 'milkdrop/preset': ['x'], 'deck/launch': [0, 0] };
  for (const r of rows) {
    const p = r.replace('<n>', '1');
    const args = sample[p] || [1];
    const plan = tree.plan([{ address: '/cayadev/' + p, args }], cfg);
    assert.strictEqual(plan.consumed.length, 1, 'ağaç bu adresi tanımıyor: ' + r);
  }
  assert.ok(read('README.md').includes('docs/REMOTE-PROTOCOL.md'));
});
