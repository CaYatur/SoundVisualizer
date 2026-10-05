'use strict';
/* Kararlı kart sütunları (#695).

   Masonry ızgarasında kartın yeri boyundan hesaplanıyordu: bir kart açılıp
   kapanınca sonraki kartlar sütun değiştiriyordu (öbür sütundaki bir kart
   916 px oynadı). Şimdi geniş kart kendi satırı, aradaki yarım kartlar bir
   şerit; kart en kısa sütuna bir kez konur ve kategori ile sütun sayısı
   aynı kaldıkça orada kalır. Fonksiyonlar admin.js'ten alınıp sahte DOM'da
   çalıştırılıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');

function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > 0, name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('end ' + name);
}

function node(cls, attrs) {
  const self = {
    classes: new Set(String(cls || '').split(/\s+/).filter(Boolean)),
    attrs: attrs || {},
    children: [],
    style: { vars: {}, setProperty(k, v) { this.vars[k] = v; } },
    h: 0,
    classList: { contains: (c) => self.classes.has(c) },
    getAttribute: (k) => (k in self.attrs ? self.attrs[k] : null),
    appendChild(c) {
      if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
      c.parent = self;
      self.children.push(c);
      return c;
    },
    set textContent(v) { self.children.forEach((c) => { c.parent = null; }); self.children = []; },
    get offsetHeight() {
      return self.children.reduce((s, c) => s + (c.offsetHeight || 0), 0) + Math.max(0, self.children.length - 1) * 14;
    },
  };
  return self;
}
const card = (id, h, wide) => { const c = node('card' + (wide ? ' wide' : ''), { 'data-card': id }); Object.defineProperty(c, 'offsetHeight', { get: () => c.h }); c.h = h; return c; };

function load() {
  const src = ['columnCount', 'buildBand', 'fillBand', 'layoutCards'].map((n) => sliceFn(admin, n)).join('\n');
  const env = { activeCategory: 'scene', width: 900 };
  const api = new Function('env', 'node', `
    const MIN_COL = 330; const COL_GAP = 14;
    const columnPlans = new Map(); let sectionsCols = 0;
    const el = (tag, p) => node(p && p.class);
    const getComputedStyle = () => ({ paddingLeft: '20px', paddingRight: '20px' });
    const watchSectionsWidth = () => {};
    let activeCategory;
    ${src}
    return {
      layout(root, cards) { activeCategory = env.activeCategory; root.clientWidth = env.width; layoutCards(root, cards); return sectionsCols; },
      columnCount(root) { root.clientWidth = env.width; return columnCount(root); },
    };`)(env, node);
  return { api, env };
}

const colOf = (c) => (c.parent && c.parent.classes.has('sec-col') ? c.parent.parent.children.indexOf(c.parent) : -1);

test('geniş kart kendi satırı, aradakiler şerit; kart en kısa sütuna gider', () => {
  const { api } = load();
  const root = node('sections');
  const A = card('a', 200, true), B = card('b', 300), C = card('c', 100), D = card('d', 100), E = card('e', 50, true), F = card('f', 80);
  assert.strictEqual(api.layout(root, [A, B, C, D, E, F]), 2);
  assert.deepStrictEqual(root.children.map((c) => (c.classes.has('sec-band') ? 'band' : c.attrs['data-card'])), ['a', 'band', 'e', 'band']);
  assert.deepStrictEqual([colOf(B), colOf(C), colOf(D)], [0, 1, 1]);
  // Tek kart kalan şerit tam genişlik
  assert.strictEqual(F.parent.parent.style.vars['--cols'], '1');
  assert.strictEqual(B.parent.parent.style.vars['--cols'], '2');
});

test('kart boyu değişince yeniden çizimde sütun değiştirmez', () => {
  const { api } = load();
  const root = node('sections');
  const B = card('b', 300), C = card('c', 100), D = card('d', 100);
  api.layout(root, [B, C, D]);
  assert.deepStrictEqual([colOf(B), colOf(C), colOf(D)], [0, 1, 1]);
  // C açıldı: masonry olsaydı D artık daha kısa olan 0. sütuna geçerdi
  C.h = 1000;
  const B2 = card('b', 300), C2 = card('c', 1000), D2 = card('d', 100);
  api.layout(root, [B2, C2, D2]);
  assert.deepStrictEqual([colOf(B2), colOf(C2), colOf(D2)], [0, 1, 1]);
  // Sonradan görünen kart yine en kısa sütuna
  const B3 = card('b', 300), C3 = card('c', 1000), N = card('new', 50), D3 = card('d', 100);
  api.layout(root, [B3, C3, N, D3]);
  assert.strictEqual(colOf(N), 0);
  assert.strictEqual(colOf(D3), 1);
});

test('sütun sayısı pencereye göre; tek sütunda kartlar alt alta', () => {
  const { api, env } = load();
  const root = node('sections');
  env.width = 1300;
  assert.strictEqual(api.columnCount(root), 3);
  env.width = 600;
  assert.strictEqual(api.columnCount(root), 1);
  const B = card('b', 300), C = card('c', 100);
  api.layout(root, [B, C]);
  assert.deepStrictEqual(root.children, [B, C]);
  root.classes.add('single');
  env.width = 1300;
  assert.strictEqual(api.columnCount(root), 1);
});

test('düzen 4 px ızgara ve boy gözlemcisi kullanmıyor', () => {
  assert.doesNotMatch(css, /masonry/);
  assert.match(css, /\.sec-band\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--cols/s);
  assert.match(css, /\.sections\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.card\s*\{[^}]*min-width:\s*0/s);
  const layout = admin.slice(admin.indexOf('function layoutCards'), admin.indexOf('// Tek bir kart'));
  assert.doesNotMatch(layout, /gridRowEnd|masonryRO/);
  // Kart rozetleri kart kimliğiyle bulunur; sütunlarda belge sırası bölüm sırası değil
  const marks = admin.slice(admin.indexOf('function refreshModifiedMarks'), admin.indexOf('function setAdvanced'));
  assert.match(marks, /cardOf\[sec\.id\]/);
});
