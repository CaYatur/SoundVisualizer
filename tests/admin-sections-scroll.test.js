'use strict';
/* #615 / #616: Admin #sections scroll, render() sonrası sıfırlanmamalı.
 *
 * Konum, kartlar ölçülünce aynı görevde yazılır. Sonraki karede ikinci
 * bir atama, kullanıcının gördüğü kısa kaymayı üretiyordu. Odak, silinen
 * kontrolde kalırsa tarayıcı kaydırmayı başa alır; bu yüzden odak önce
 * kaydırıcıya alınır.
 *
 * Alttaki davranış testleri kelepçe hesabını sahte elemanda doğrular.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const adminSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'admin', 'admin.js'),
  'utf8'
);
const panelSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'),
  'utf8'
);

test('kaynak: sections kaydırması aynı görevde, odak kaymadan yazılır', () => {
  assert.match(adminSrc, /function holdSectionsFocus\s*\(/);
  assert.match(adminSrc, /root\.focus\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/);
  assert.match(adminSrc, /function applySectionsScroll\s*\(/);
  assert.match(
    adminSrc,
    /const max\s*=\s*Math\.max\(\s*0\s*,\s*root\.scrollHeight\s*-\s*root\.clientHeight\s*\)/
  );
  assert.match(adminSrc, /Math\.min\(\s*want\s*,\s*max\s*\)/);
  const renderAt = adminSrc.indexOf('function render()');
  const renderEnd = adminSrc.indexOf('function columnCount', renderAt);
  const body = adminSrc.slice(renderAt, renderEnd);
  const hold = body.indexOf('holdSectionsFocus(root)');
  const clear = body.indexOf('root.innerHTML');
  const layout = body.indexOf('layoutCards(root)');
  const apply = body.indexOf('applySectionsScroll(root, anchoredScroll(root, anchor, prevScroll))');
  const cap = body.indexOf('captureLayerPaneScroll(root)');
  const restorePane = body.indexOf('restoreLayerPaneScroll(root, paneScroll)');
  assert.ok(hold > 0 && clear > hold, 'odak, içerik silinmeden tutulmalı');
  assert.ok(cap > 0 && cap < clear, 'alt sekme kaydırması silinmeden okunmalı');
  assert.ok(layout > clear && restorePane > layout && apply > restorePane, 'kaydırma, ızgara oturduktan sonra yazılmalı');
  assert.ok(body.indexOf('anchoredScroll(root, anchor, prevScroll)') > layout, 'hedef, yerleşmiş kutudan bir kez hesaplanır');
  assert.doesNotMatch(body, /placeSectionAnchor/);
  assert.doesNotMatch(body, /requestAnimationFrame\([\s\S]*scrollTop/);
  const layoutFn = adminSrc.slice(adminSrc.indexOf('function layoutCards'), adminSrc.indexOf('function buildCard'));
  assert.doesNotMatch(layoutFn, /applySectionsScroll/);
  assert.match(layoutFn, /nudgeScroll\(scroller, pin, before\)/);
  assert.match(layoutFn, /nudgeScroll\(root, pin, before\)/);
  const marks = adminSrc.slice(adminSrc.indexOf('function refreshModifiedMarks'), adminSrc.indexOf('function setAdvanced'));
  assert.match(marks, /parkResetFocus\(root\)/);
  assert.ok(marks.indexOf('parkResetFocus(root)') < marks.indexOf('nudgeScroll(root, pin, before)'),
    'odak, boy değişmeden önce park edilmeli');
  assert.match(adminSrc, /box\.getAttribute\('data-path'\) \|\| box\.getAttribute\('data-anchor'\)/);
  assert.match(panelSrc, /'data-anchor': String\(label\)\.slice\(0, 80\)/);
  assert.doesNotMatch(panelSrc, /alignOpened/);
  assert.doesNotMatch(adminSrc, /function alignOpened/);
  /* Sıfırlama düğmesi odaktayken push onu gizler. Kaydırma o andan önce okunmalı. */
  const localReset = panelSrc.slice(panelSrc.indexOf('function attachDefault'), panelSrc.indexOf('function moveItem'));
  assert.ok(localReset.indexOf('P().rerender') > 0 && localReset.indexOf('P().rerender') < localReset.indexOf('P().push(true)'),
    'katman sıfırlaması yeniden çizimi kayıttan önce yapmalı');
  const pathReset = adminSrc.slice(adminSrc.indexOf('function resetPath'), adminSrc.indexOf('function refreshModifiedMarks'));
  assert.ok(pathReset.indexOf('render()') > 0 && pathReset.indexOf('render()') < pathReset.indexOf('push(true)'),
    'yol sıfırlaması yeniden çizimi kayıttan önce yapmalı');
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

test('katlanır alt bölüm başlığı yerinde kalır ve kart payı yenilenir', () => {
  const fold = panelSrc.slice(panelSrc.indexOf('function foldable'), panelSrc.indexOf('function layerOpenState'));
  assert.match(fold, /fitLayerCard\(head\.closest\('\.card'\)\)/);
  assert.match(fold, /keepViewport\(root, head, before\)/);
  const fit = panelSrc.slice(panelSrc.indexOf('function fitLayerCard'), panelSrc.indexOf('function layerTabs'));
  const off = fit.indexOf("classList.remove('masonry')");
  const measure = fit.indexOf('getBoundingClientRect().height');
  const on = fit.indexOf("classList.add('masonry')");
  const restore = fit.indexOf('root.scrollTop = keep');
  assert.ok(off > 0 && measure > off && on > measure && restore > on, 'ölçüm kaydırmayı bırakıp geri almamalı');
});

function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > 0, name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('end ' + name);
}

function anchorFns() {
  const names = [
    'boxLabel', 'anchorBoxOf', 'layerOf', 'tabKeyOf', 'foldKeyOf',
    'anchorIdentity', 'sameIdentity', 'sectionAnchor', 'findAnchorNode',
    'anchoredScroll', 'touchedBox', 'topVisibleBox', 'inScrollerView', 'noteTouch',
    'nudgeScroll', 'captureLayerPaneScroll', 'restoreLayerPaneScroll',
  ];
  return new Function('let lastTouch = null;\n' + names.map((n) => sliceFn(adminSrc, n)).join('\n') + '\nreturn { noteTouch, sectionAnchor, findAnchorNode, anchoredScroll, nudgeScroll, captureLayerPaneScroll, restoreLayerPaneScroll };')();
}

function uiNode(tag, cls, text) {
  const self = {
    tag,
    classes: new Set((cls || '').split(/\s+/).filter(Boolean)),
    _text: text || '',
    children: [],
    parentElement: null,
    attrs: {},
    nodeType: 1,
    top: 0,
    classList: { contains: (c) => self.classes.has(c) },
    get childNodes() {
      const out = [];
      if (self._text) out.push({ nodeType: 3, nodeValue: self._text, textContent: self._text });
      return out.concat(self.children);
    },
    get textContent() {
      return (self._text || '') + self.children.map((c) => c.textContent || '').join('');
    },
    setAttribute(k, v) { self.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(self.attrs, k) ? self.attrs[k] : null; },
    add(...kids) {
      for (const c of kids) { c.parentElement = self; self.children.push(c); }
      return self;
    },
    getBoundingClientRect() {
      const height = self.height || 40;
      return {
        top: self.top,
        bottom: self.bottom != null ? self.bottom : self.top + height,
        height,
      };
    },
    closest(sel) {
      let n = self;
      while (n) {
        if (matchList(n, sel)) return n;
        n = n.parentElement;
      }
      return null;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      for (const part of sel.split(',')) collectDesc(self, part.trim().split(/\s+/), out);
      return out;
    },
    contains(other) {
      let n = other;
      while (n) { if (n === self) return true; n = n.parentElement; }
      return false;
    },
  };
  return self;
}

function matchCompound(n, sel) {
  if (!sel || !n || !n.classes) return false;
  if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => n.classes.has(c));
  return n.tag === sel;
}

function matchList(n, sel) {
  return sel.split(',').some((p) => {
    const bits = p.trim().split(/\s+/);
    return bits.length === 1 && matchCompound(n, bits[0]);
  });
}

function collectDesc(scope, compounds, out) {
  const [head, ...rest] = compounds;
  const walk = (n) => {
    for (const c of n.children) {
      if (matchCompound(c, head)) {
        if (!rest.length) out.push(c);
        else collectDesc(c, rest, out);
      }
      walk(c);
    }
  };
  walk(scope);
}

function labeledCtrl(label, top) {
  const input = uiNode('select', '', '');
  const lbl = uiNode('label', 'lbl', label);
  lbl.add(uiNode('button', 'ctrl-reset', ''));
  const box = uiNode('div', 'ctrl', '').add(uiNode('div', 'row', '').add(lbl, input));
  box.top = top;
  input.top = top + 28;
  return { box, input };
}

test('aynı adlı ikinci kontrol ve sekmedeki kopya yerinde kalır', () => {
  const api = anchorFns();
  const root = uiNode('div', 'sections', '');
  root.scrollTop = 0;
  root.scrollHeight = 2400;
  root.clientHeight = 500;
  const layer = uiNode('div', 'layer', '');
  const name = uiNode('button', 'layer-name', '').add(uiNode('b', '', 'Şarkı Sözü'));
  const body = uiNode('div', 'layer-body', '');
  const first = labeledCtrl('Kaynak', 80);
  const second = labeledCtrl('Kaynak', 360);
  const tab = uiNode('button', 'layer-tab active', 'Dönüşüm');
  tab.setAttribute('data-k', 'transform');
  const bar = uiNode('div', 'layer-tabs', '').add(tab);
  const paneCtrl = labeledCtrl('Dikey Konum', 640);
  const pane = uiNode('div', 'layer-pane', '').add(paneCtrl.box);
  const bodyCtrl = labeledCtrl('Dikey Konum', 140);
  body.add(first.box, second.box, bodyCtrl.box, bar, pane);
  layer.add(name, body);
  root.add(layer);

  const prevDoc = global.document;
  global.document = { activeElement: second.input };
  const sourceAnchor = api.sectionAnchor(root);
  assert.strictEqual(sourceAnchor.label, 'Kaynak');
  assert.strictEqual(sourceAnchor.nth, 1);
  assert.strictEqual(sourceAnchor.top, 360);

  global.document = { activeElement: paneCtrl.input };
  const tabAnchor = api.sectionAnchor(root);
  assert.strictEqual(tabAnchor.label, 'Dikey Konum');
  assert.strictEqual(tabAnchor.tabKey, 'transform');
  assert.strictEqual(tabAnchor.nth, 0);
  assert.strictEqual(tabAnchor.top, 640);
  global.document = prevDoc;

  second.box.top = 900;
  first.box.top = 200;
  paneCtrl.box.top = 1100;
  bodyCtrl.box.top = 260;
  const foundSource = api.findAnchorNode(root, sourceAnchor);
  assert.strictEqual(foundSource, second.box);
  assert.strictEqual(api.anchoredScroll(root, sourceAnchor, 0), 540);
  const foundTab = api.findAnchorNode(root, tabAnchor);
  assert.strictEqual(foundTab, paneCtrl.box);
  assert.strictEqual(api.anchoredScroll(root, tabAnchor, 0), 460);

  const other = uiNode('div', 'layer', '');
  other.setAttribute('data-id', 'ly-b');
  layer.setAttribute('data-id', 'ly-a');
  const otherName = uiNode('button', 'layer-name', '').add(uiNode('b', '', 'Şarkı Sözü'));
  const otherCtrl = labeledCtrl('Kaynak', 1500);
  other.add(otherName, uiNode('div', 'layer-body', '').add(otherCtrl.box));
  root.add(other);
  global.document = { activeElement: otherCtrl.input };
  const dup = api.sectionAnchor(root);
  assert.strictEqual(dup.layer, 'Şarkı Sözü');
  assert.strictEqual(dup.layerId, 'ly-b');
  assert.strictEqual(dup.nth, 0);
  otherCtrl.box.top = 1700;
  assert.strictEqual(api.findAnchorNode(root, dup), otherCtrl.box);
  assert.notStrictEqual(api.findAnchorNode(root, dup), second.box);

  second.box.setAttribute('data-anchor', 'Kaynak');
  second.box.children[0].children[0]._text = 'Source';
  global.document = { activeElement: second.input };
  const translated = api.sectionAnchor(root);
  assert.strictEqual(translated.label, 'Kaynak', 'çevrilmiş yazı tutamacı kaçırmamalı');
  assert.strictEqual(api.findAnchorNode(root, translated), second.box);
  root.scrollTop = 100;
  second.box.top = 940;
  api.nudgeScroll(root, second.box, 900);
  assert.strictEqual(root.scrollTop, 140, 'kutu kayınca kaydırma aynı ekran yerini tutar');

  const paneA = uiNode('div', 'layer-pane open', '');
  paneA.scrollTop = 120;
  paneA.scrollHeight = 900;
  paneA.clientHeight = 400;
  layer.add(paneA);
  const paneB = uiNode('div', 'layer-pane open', '');
  paneB.scrollTop = 40;
  paneB.scrollHeight = 900;
  paneB.clientHeight = 400;
  other.add(paneB);
  const saved = api.captureLayerPaneScroll(root);
  paneA.scrollTop = 0;
  paneB.scrollTop = 0;
  api.restoreLayerPaneScroll(root, saved);
  assert.strictEqual(paneA.scrollTop, 120);
  assert.strictEqual(paneB.scrollTop, 40);
  global.document = prevDoc;
});

test('kaynak: kategori scroll haritasi (bellekte, diske yazilmaz)', () => {
  assert.match(adminSrc, /const categoryScrollById\s*=\s*new Map\(\)/);
  assert.match(adminSrc, /let pendingCategoryScrollId\s*=\s*null/);
  assert.match(adminSrc, /function saveCategoryScroll\s*\(/);
  assert.match(adminSrc, /saveCategoryScroll\(activeCategory\)/);
  assert.match(adminSrc, /pendingCategoryScrollId\s*=\s*id/);
  assert.match(adminSrc, /pendingCategoryScrollId\s*===\s*activeCategory/);
  assert.doesNotMatch(adminSrc, /localStorage\.[gs]etItem\([^)]*scroll/i);
  assert.doesNotMatch(adminSrc, /categoryScrollById[^;]*localStorage/);
  assert.match(panelSrc, /'data-id': l\.id/);
});

/* #695: anahtar girişi display:none olduğu için tıklanınca odak almıyordu;
   yeniden çizim tıklanan kutuyu bulamıyor, "Katman Yığınını Kullan"
   anahtarı ~1260 px kayıp gidiyordu. Son dokunuş odağın yerini tutar. */
test('odak panelin dışındayken son dokunulan kutu tutulur', () => {
  const api = anchorFns();
  const root = uiNode('div', 'sections', '');
  root.bottom = 800;
  const a = labeledCtrl('Şeffaf Arkaplan', 100);
  const b = labeledCtrl('Katman Yığınını Kullan', 420);
  root.add(a.box, b.box);
  const prevDoc = global.document;
  global.document = { activeElement: { tag: 'body' } };
  api.noteTouch({ target: b.input });
  const anchor = api.sectionAnchor(root);
  assert.strictEqual(anchor.label, 'Katman Yığınını Kullan');
  assert.strictEqual(anchor.top, 420);
  // Dokunuş yoksa ekranın üstünde tamamen görünen ilk kutu
  api.noteTouch({ target: null });
  root.scrollTop = 0;
  const top = api.sectionAnchor(root);
  assert.strictEqual(top.label, 'Şeffaf Arkaplan');
  global.document = prevDoc;
});

test('anahtar girişi odaklanabilir, arka plan çizimleri zamanlayıcıdan geçer', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
  assert.doesNotMatch(css, /\.switch input\s*\{\s*display:\s*none/);
  assert.match(css, /\.switch input:focus-visible \+ \.track/);
  assert.match(adminSrc, /addEventListener\('pointerdown', \(e\) => \{ noteTouch\(e\); holdPointer\(\); \}, true\)/);
  /* Açılır liste / renk seçici pointerup'ı yutabilir: change ve focusout da
     bırakır, bayrak en geç HOLD_MAX_MS sonra düşer. */
  assert.match(adminSrc, /addEventListener\('change', releasePointer, true\)/);
  assert.match(adminSrc, /addEventListener\('focusout', releasePointer, true\)/);
  assert.match(sliceFn(adminSrc, 'holdPointer'), /setTimeout\(releasePointer, HOLD_MAX_MS\)/);
  const sched = sliceFn(adminSrc, 'scheduleRender');
  assert.match(sched, /cats\.indexOf\(activeCategory\) < 0\) return/);
  assert.match(sched, /if \(pointerHeld \|\| renderRaf\) return/);
  // Uzaktan kumanda / MCP, ışık yoklaması, söz kitaplığı doğrudan çizmiyor
  assert.match(adminSrc, /isBlackedOut\(\)\);\s*scheduleRender\(\);/);
  assert.match(adminSrc, /scheduleRender\(\['lighting'\]\)/);
  assert.match(adminSrc, /scheduleRender\(\['scene', 'library'\]\)/);
});
