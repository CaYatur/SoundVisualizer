'use strict';
/* Raf kartı boş kalmasın: sahne dışı sayfa #svShelf'i boşaltıp sahne
 * listesini yan rafa taşıyınca, imza aynı olduğu için Sahne'ye dönüşte
 * raf yeniden çizilmiyordu (kart boş, "görselleştirici kapalıyken gidiyor"). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SHELL = fs.readFileSync(path.join(__dirname, '..', 'src/admin/scene-shell.js'), 'utf8').replace(/\r\n/g, '\n');

test('paint boş rafı imza aynı olsa da yeniden çizer', () => {
  assert.match(SHELL, /if \(shelfStale \|\| sig !== shelfPainted \|\| mdMissing \|\| shelfEmpty\(c\)\)/);
});

function load(state) {
  const src = SHELL.match(/function shelfEmpty\(c\) \{[\s\S]*?\n  \}/)[0];
  // eslint-disable-next-line no-new-func
  return new Function('state', 'with (state) { return (' + src + '); }')(state);
}
const node = (kids) => ({ childElementCount: kids.length, contains: (n) => kids.includes(n) });

test('shelfEmpty: boşaltılmış kart, boş gövde ve taşınmış sahne listesi', () => {
  const list = {};
  const st = { shelfOpen: true, shelfTab: 'scenes', scenesNode: list };
  const fn = load(st);
  assert.strictEqual(fn({ querySelector: () => null }), true, 'replaceChildren() sonrası');
  assert.strictEqual(fn({ querySelector: () => node([]) }), true, 'boş gövde');
  assert.strictEqual(fn({ querySelector: () => node([{}]) }), true, 'liste yan rafa taşınmış');
  assert.strictEqual(fn({ querySelector: () => node([list]) }), false, 'liste yerinde');
  const closed = load({ shelfOpen: false, shelfTab: 'scenes', scenesNode: list });
  assert.strictEqual(closed({ querySelector: () => node([]) }), false, 'kapalı raf boş kalabilir');
  const vis = load({ shelfOpen: true, shelfTab: 'vis', scenesNode: list });
  assert.strictEqual(vis({ querySelector: () => node([{}]) }), false);
});
