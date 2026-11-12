'use strict';
/* Panel ayraçları: Sahne sayfasında raf yüksekliği ve yan panel genişlikleri sürüklenerek
   değişiyor, pay olarak saklanıyor ve Ayarlar'dan sıfırlanıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function withStorage(fn) {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    delete require.cache[require.resolve('../src/admin/panel-splits')];
    return fn(require('../src/admin/panel-splits'), store);
  } finally {
    delete global.localStorage;
  }
}

test('pay: sayı değilse ya da sınır dışındaysa yok sayılıyor', () => withStorage((S) => {
  assert.strictEqual(S.parse('shelf', null), null);
  assert.strictEqual(S.parse('shelf', ''), null);
  assert.strictEqual(S.parse('shelf', 'abc'), null);
  assert.strictEqual(S.parse('shelf', '1.5'), null);
  assert.strictEqual(S.parse('left', '0.6'), null, 'yan panel sahnenin üçte birini geçemez');
  assert.strictEqual(S.parse('right', '0.4'), null);
  assert.strictEqual(S.parse('nope', '0.3'), null);
  assert.strictEqual(S.parse('shelf', '0.333333'), 0.3333);
  assert.strictEqual(S.parse('left', 0.2), 0.2);
}));

test('kaydet, oku, tek tek ve hep birlikte sıfırla', () => withStorage((S, store) => {
  assert.strictEqual(S.customized(), false);
  let calls = 0;
  S.onChange(() => { calls += 1; });
  S.set('shelf', 0.42);
  S.set('left', 0.2);
  assert.strictEqual(store.get('sv-split-shelf'), '0.42');
  assert.strictEqual(S.get('left'), 0.2);
  assert.strictEqual(S.customized(), true);
  S.reset('shelf');
  assert.strictEqual(store.has('sv-split-shelf'), false);
  assert.strictEqual(S.get('left'), 0.2);
  S.reset();
  assert.strictEqual(S.customized(), false);
  assert.strictEqual(store.size, 0);
  assert.ok(calls >= 4, 'Ayarlar düğmesi değişikliği duyuyor');
  // Bozuk değer yazılmıyor, varsayılan kalıyor
  S.set('right', 'x');
  assert.strictEqual(store.has('sv-split-right'), false);
}));

test('CSS: pay oranlı, piksel sınırları clamp ile, dar pencere kademeleri korunuyor', () => {
  const css = read('src/admin/shell.css');
  assert.match(css, /grid-template-columns: var\(--sv-lw, var\(--sv-l0\)\) minmax\(0, 1fr\) var\(--sv-rw, var\(--sv-r0\)\)/);
  // Sol panel en çok %32, ama orta sütuna en az 420 px (ve iki boşluk) bırakıyor
  assert.match(css, /\.sv-scene\[data-split-left\] \{ --sv-lw: clamp\(160px, calc\(var\(--sv-lw-frac\) \* 100%\), min\(32%, calc\(100% - var\(--sv-rw, var\(--sv-r0\)\) - 440px\)\)\); \}/);
  assert.match(css, /\.sv-scene\[data-split-right\] \{ --sv-rw: clamp\(220px, calc\(var\(--sv-rw-frac\) \* 100%\), 38%\); \}/);
  assert.match(css, /\.sv-center\[data-split-shelf\] \{ --below: clamp\(150px, calc\(var\(--sv-shelf-frac\) \* 100cqh\), calc\(100cqh - 150px\)\); \}/);
  // Raf kapalıyken pay yok sayılıyor: .tall kuralı paydan SONRA ve aynı özgüllükte
  assert.ok(css.indexOf('.sv-center.tall { --below: 66px; }') > css.indexOf('.sv-center[data-split-shelf]'));
  // Kademeler sütun şablonunu değil yalnız varsayılan genişliği değiştiriyor (kullanıcı payı ezilmesin)
  assert.match(css, /@media \(max-width: 1360px\) \{\s*body\[data-page='scene'\] \.sv-scene \{ --sv-l0: 236px; --sv-r0: 300px; \}/);
  assert.match(css, /@media \(max-width: 1120px\) \{\s*body\[data-page='scene'\] \.sv-scene \{ --sv-l0: 200px; --sv-r0: 260px; \}/);
  assert.ok(!/\.sv-scene \{ grid-template-columns: \d+px/.test(css));
});

test('ayraçlar sayfada, erişilebilir ve raf yeniden çizilince silinmiyor', () => {
  const html = read('src/admin/index.html');
  for (const name of ['shelf', 'left', 'right']) {
    const m = html.match(new RegExp('<div class="sv-split [^"]*" data-split="' + name + '"[^>]*>'));
    assert.ok(m, name);
    assert.match(m[0], /role="separator"/);
    assert.match(m[0], /tabindex="0"/);
    assert.match(m[0], /aria-label="[^"]+"/);
  }
  // Raf ayracı #svShelf'in DIŞINDA: paintShelf rafın içini her çizimde baştan kuruyor
  const shelf = html.indexOf('<section id="svShelf"');
  assert.ok(html.indexOf('data-split="shelf"') < shelf);
  assert.ok(html.indexOf('panel-splits.js') > 0 && html.indexOf('panel-splits.js') < html.indexOf('scene-shell.js'));
  // Ayar dosyasına değil bu makineye (localStorage) yazılıyor
  const mod = read('src/admin/panel-splits.js');
  assert.match(mod, /localStorage/);
  assert.ok(!/SVPanel\.(set|push)|cfg\./.test(mod));
});

test('Ayarlar: Panel grubunda sıfırlama düğmesi, aranabiliyor, iki dilde', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /\{ type: 'panelsizes', group: 'Panel' \}/);
  assert.match(admin, /case 'panelsizes':\s*return panelSizesCtrl\(\);/);
  assert.match(admin, /function panelSizesCtrl\(\) \{[\s\S]{0,400}S\.reset\(\);/);
  assert.match(admin, /'panel boyutu', 'raf yüksekliği', 'ayraç', 'panel size', 'shelf height', 'splitter', 'resize'/);
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Panel Boyutları', 'Panel Boyutlarını Sıfırla', 'Panel boyutları varsayılana döndü.', 'Raf yüksekliği (çift tık: varsayılan)',
    'Katmanlar paneli genişliği (çift tık: varsayılan)', 'Denetçi paneli genişliği (çift tık: varsayılan)', 'Raf yüksekliği', 'Katmanlar paneli genişliği', 'Denetçi paneli genişliği']) {
    assert.ok(i18n.includes("'" + s + "':"), s);
  }
});
