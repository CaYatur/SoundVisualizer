'use strict';
/* #615 / #616: Admin #sections scroll, render() sonrası sıfırlanmamalı.
 *
 * DOM/Electron olmadan iki katman doğrulanır:
 *  1) Kaynak sözleşmesi — admin.js içinde gen++, çift rAF, clamp, isConnected.
 *  2) Davranış — restore algoritması sahte eleman + kontrollü rAF kuyruğu ile.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const adminSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'admin', 'admin.js'),
  'utf8'
);

test('kaynak: #615 sections scroll restore deseni admin.js içinde', () => {
  assert.match(adminSrc, /let sectionsScrollRestoreGen\s*=\s*0/);
  assert.match(adminSrc, /const gen\s*=\s*\+\+sectionsScrollRestoreGen/);
  assert.match(adminSrc, /const restoreSectionsScroll\s*=\s*\(\)\s*=>/);
  assert.match(
    adminSrc,
    /if\s*\(\s*gen\s*!==\s*sectionsScrollRestoreGen\s*\|\|\s*!root\.isConnected\s*\)\s*return/
  );
  assert.match(
    adminSrc,
    /const max\s*=\s*Math\.max\(\s*0\s*,\s*root\.scrollHeight\s*-\s*root\.clientHeight\s*\)/
  );
  assert.match(adminSrc, /root\.scrollTop\s*=\s*Math\.min\(\s*prevScroll\s*,\s*max\s*\)/);
  assert.match(
    adminSrc,
    /requestAnimationFrame\(\s*\(\)\s*=>\s*\{\s*restoreSectionsScroll\(\);\s*requestAnimationFrame\(restoreSectionsScroll\);\s*\}\)/
  );
});

/** admin.js ile aynı restore algoritması; rAF enjekte edilebilir. */
function makeRestore(root, prevScroll, opts) {
  const state = opts.state;
  const raf = opts.raf;
  const gen = ++state.gen;
  const restoreSectionsScroll = () => {
    if (gen !== state.gen || !root.isConnected) return;
    const max = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTop = Math.min(prevScroll, max);
  };
  restoreSectionsScroll();
  raf(() => {
    restoreSectionsScroll();
    raf(restoreSectionsScroll);
  });
  return { gen, restoreSectionsScroll };
}

function fakeRoot(init) {
  return {
    scrollTop: init.scrollTop ?? 0,
    scrollHeight: init.scrollHeight ?? 0,
    clientHeight: init.clientHeight ?? 0,
    isConnected: init.isConnected !== false,
  };
}

function makeRafQueue() {
  const q = [];
  const raf = (fn) => {
    q.push(fn);
    return q.length;
  };
  const flushOne = () => {
    assert.ok(q.length > 0, 'rAF kuyruğu boş');
    const fn = q.shift();
    fn();
  };
  const flushAll = () => {
    while (q.length) flushOne();
  };
  return { raf, flushOne, flushAll, queue: q };
}

test('davranış: içerik yeniden kurulunca scroll korunur (yükseklik yeter)', () => {
  const root = fakeRoot({ scrollTop: 240, scrollHeight: 800, clientHeight: 400 });
  const prevScroll = root.scrollTop;
  // rebuild: içerik temizlenip yeniden dolduruluyor; scrollTop sıfırlanabilir
  root.scrollTop = 0;
  root.scrollHeight = 800;
  root.clientHeight = 400;

  const state = { gen: 0 };
  const { raf, flushAll } = makeRafQueue();
  makeRestore(root, prevScroll, { state, raf });
  assert.strictEqual(root.scrollTop, 240, 'sync restore hemen uygulamalı');
  flushAll();
  assert.strictEqual(root.scrollTop, 240, 'çift rAF sonrası scroll aynı kalmalı');
});

test('davranış: max küçülünce clamp edilir', () => {
  const root = fakeRoot({ scrollTop: 500, scrollHeight: 1000, clientHeight: 400 });
  const prevScroll = root.scrollTop;
  root.scrollTop = 0;
  // yeniden kurulum sonrası daha kısa içerik
  root.scrollHeight = 500;
  root.clientHeight = 400;
  const max = Math.max(0, root.scrollHeight - root.clientHeight); // 100

  const state = { gen: 0 };
  const { raf, flushAll } = makeRafQueue();
  makeRestore(root, prevScroll, { state, raf });
  assert.strictEqual(root.scrollTop, max);
  flushAll();
  assert.strictEqual(root.scrollTop, 100);
});

test('davranış: sonraki render\'ın gen\'i eski rAF restore\'unu ezer', () => {
  const root = fakeRoot({ scrollTop: 300, scrollHeight: 900, clientHeight: 400 });
  const state = { gen: 0 };
  const { raf, flushOne, queue } = makeRafQueue();

  // ilk render: prev=300
  makeRestore(root, 300, { state, raf });
  assert.strictEqual(root.scrollTop, 300);
  assert.strictEqual(queue.length, 1, 'ilk rAF planlandı');

  // kullanıcı kaydırdı / ikinci render yeni prev ile
  root.scrollTop = 50;
  makeRestore(root, 50, { state, raf });
  assert.strictEqual(root.scrollTop, 50);
  assert.strictEqual(state.gen, 2);

  // eski (gen=1) dış rAF çalışır — stale, dokunmamalı
  flushOne();
  assert.strictEqual(root.scrollTop, 50, 'eski gen scroll\'u ezmemeli');

  // yeni render\'ın dış rAF'ı: restore + iç rAF
  flushOne();
  assert.strictEqual(root.scrollTop, 50);
  // iç rAF
  flushOne();
  assert.strictEqual(root.scrollTop, 50);
  // eski render\'ın iç rAF'ı (stale) kuyrukta kalmış olabilir
  while (queue.length) flushOne();
  assert.strictEqual(root.scrollTop, 50);
});

test('davranış: isConnected false iken restore atlanır', () => {
  const root = fakeRoot({
    scrollTop: 0,
    scrollHeight: 800,
    clientHeight: 400,
    isConnected: false,
  });
  const state = { gen: 0 };
  const { raf, flushAll } = makeRafQueue();
  makeRestore(root, 200, { state, raf });
  assert.strictEqual(root.scrollTop, 0, 'bağlı değilken sync restore yok');
  flushAll();
  assert.strictEqual(root.scrollTop, 0, 'bağlı değilken rAF restore yok');
});
