'use strict';
/* Boş ekran seçimi boş kalır. Eski kod liste boşalınca harici ya da
   birincil ekranı geri seçiyordu; açılış da aynı listeyi birincile çeviriyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'src', 'admin', 'admin.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8');

function resolveDisplayIds() {
  const src = main.match(/function resolveDisplayIds\(input\) \{\r?\n[\s\S]*?\r?\n\}/);
  assert.ok(src, 'resolveDisplayIds bulunamadı');
  return new Function('screen', src[0] + '\nreturn resolveDisplayIds;');
}

test('panel boş seçimi geri doldurmaz', () => {
  assert.doesNotMatch(admin, /selectedDisplayIds = \[\(ext \|\| displays\[0\]\)\.id\]/);
  assert.doesNotMatch(admin, /if \(!selectedDisplayIds\.length && displays\.length\)/);
  assert.match(admin, /Boş liste boş kalır/);
  assert.match(admin, /if \(!selectedDisplayIds\.length\) return 'Ekran seçilmedi'/);
});

test('boş veya bilinmeyen ekran listesi birincil ekrana düşmez', () => {
  const fn = resolveDisplayIds()({
    getAllDisplays: () => [{ id: 1 }, { id: 2 }],
    getPrimaryDisplay: () => { throw new Error('birincil ekrana düşmemeli'); },
  });
  assert.deepStrictEqual(fn([]), []);
  assert.deepStrictEqual(fn(null), []);
  assert.deepStrictEqual(fn(''), []);
  assert.deepStrictEqual(fn([9]), []);
  assert.deepStrictEqual(fn([2, 2, 9, 1]), [2, 1]);
  assert.deepStrictEqual(fn(1), [1]);
});

test('açık görselleştirici boş seçimde istenmeyen ekranı kapatır', () => {
  const body = main.slice(main.indexOf('function openVisualizer'), main.indexOf('function configuredSources'));
  assert.match(body, /if \(wanted\.indexOf\(id\) === -1\) closeVisualizer\(id\)/);
  assert.match(body, /for \(const id of wanted\)/);
  /* Birincil ekran yalnız istenen kimlik listede yoksa yerleşim için.
     Döngü boş wanted ile hiç girmez. */
  assert.match(body, /all\.find\(\(d\) => d\.id === id\) \|\| screen\.getPrimaryDisplay\(\)/);
});
