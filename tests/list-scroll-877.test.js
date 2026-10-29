'use strict';
/* LİSTE KAYDIRMASI SAYFAYI OYNATMASIN (#877). Yeniden çizimde kaydırma
 * konumunu geri yükleyen listeler etkin satırı `scrollIntoView` ile
 * gösteriyordu; o çağrı bütün ata kaydırıcıları da oynattığı için katman
 * kartındaki her değişiklik sayfayı etkin MilkDrop presetine atlatıyordu.
 * Artık yalnız listenin kendisi kaydırılıyor (`SVPanel.revealInList`). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

test('#877: yeniden çizilen listeler scrollIntoView çağırmıyor', () => {
  for (const f of ['src/admin/milkdrop-panel.js', 'src/admin/studio.js', 'src/admin/template-panel.js']) {
    const src = read(f);
    assert.ok(!/\.scrollIntoView\(/.test(src), f + ' scrollIntoView çağırıyor');
    assert.ok(/revealInList\(/.test(src), f + ' revealInList kullanmıyor');
  }
});

// admin.js içindeki yardımcıyı tek başına çalıştır
function loadReveal() {
  const src = read('src/admin/admin.js');
  const m = src.match(/function revealInList\(list, node\) \{[\s\S]*?\n {2}\}/);
  assert.ok(m, 'revealInList bulunamadı');
  return vm.runInNewContext('(' + m[0] + ')');
}

const rect = (top, h) => ({ getBoundingClientRect: () => ({ top, bottom: top + h }) });

test('#877: görünür satırda liste kaydırılmıyor', () => {
  const reveal = loadReveal();
  const list = Object.assign(rect(100, 300), { scrollTop: 50 });
  reveal(list, rect(150, 30));
  assert.strictEqual(list.scrollTop, 50);
});

test('#877: yukarıda ya da aşağıda kalan satır listenin içine getiriliyor', () => {
  const reveal = loadReveal();
  const up = Object.assign(rect(100, 300), { scrollTop: 200 });
  reveal(up, rect(60, 30));
  assert.strictEqual(up.scrollTop, 160);
  const down = Object.assign(rect(100, 300), { scrollTop: 0 });
  reveal(down, rect(420, 30));
  assert.strictEqual(down.scrollTop, 50);
  // listeden uzun satır: üstü görünsün
  const tall = Object.assign(rect(100, 300), { scrollTop: 0 });
  reveal(tall, rect(500, 400));
  assert.strictEqual(tall.scrollTop, 400);
});
