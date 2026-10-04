'use strict';
/* Kitaplık sil düğmesi gerçek bir currentColor çarpı çizer ve seçili
   öğeyi kaldırınca kaydı temizler. Eski düğme icon özniteliğini SVG'ye
   çevirmiyordu: koyu boş daire, tıklanınca da seçim silinmiyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function element(tag) {
  const node = {
    tag,
    children: [],
    attrs: {},
    style: {},
    className: '',
    text: '',
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node.text; },
    set(v) { node.text = v == null ? '' : String(v); },
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; },
    set(v) { if (v === '') node.children = []; },
  });
  Object.defineProperty(node, 'childNodes', { get() { return node.children; } });
  node.classList = {
    toggle(name, on) {
      const parts = node.className.split(/\s+/).filter(Boolean);
      const has = parts.includes(name);
      const want = on === undefined ? !has : !!on;
      node.className = (want ? parts.concat(has ? [] : [name]) : parts.filter((p) => p !== name)).join(' ');
    },
  };
  return node;
}

function walk(node, out) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

test('sil düğmesi çarpı çizer, dosyayı siler ve seçimi bırakır', async () => {
  global.window = global;
  global.setInterval = () => 0;
  global.clearInterval = () => {};
  global.document = {
    createElement: element,
    createElementNS: (ns, tag) => { const n = element(tag); n.attrs.xmlns = ns; return n; },
    body: { appendChild() {} },
  };
  delete require.cache[require.resolve('../src/shared/icons.js')];
  delete require.cache[require.resolve('../src/admin/logo-lib-ui.js')];
  require('../src/shared/icons.js');
  require('../src/admin/logo-lib-ui.js');

  const removed = [];
  let cleared = null;
  window.api = {
    logoLibList: async () => [{ id: 'a', name: 'Kapak', kind: 'image' }, { id: 'b', name: 'Diğer', kind: 'gif' }],
    logoLibRemove: async (id) => { removed.push(id); return { ok: true }; },
  };
  const wrap = window.SVLogoLibUi.mount({
    selectedId: 'a',
    onRemove: (it) => { cleared = it.id; },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const nodes = walk(wrap, []);
  const dels = nodes.filter((n) => n.tag === 'button' && String(n.className).indexOf('logo-lib-del') >= 0);
  assert.strictEqual(dels.length, 2);
  const icon = dels[0].children[0];
  assert.ok(icon, 'sil düğmesinde ikon');
  assert.match(icon.attrs.class, /svi-x/);
  assert.strictEqual(icon.attrs.stroke, 'currentColor');
  assert.strictEqual(dels[0].attrs['data-icon'], 'x');
  const add = nodes.find((n) => n.tag === 'button' && /Kitaplığa Ekle/.test(n.textContent || ''));
  assert.match(add.children[0].attrs.class, /svi-import/);

  await dels[0].listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepStrictEqual(removed, ['a']);
  assert.strictEqual(cleared, 'a');

  cleared = null;
  await dels[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepStrictEqual(removed, ['a', 'b']);
  assert.strictEqual(cleared, 'b', 'seçili olmayan kart da sahnedeki logoyu bırakır');

  window.api.logoLibRemove = async () => ({ ok: false });
  cleared = null;
  await dels[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(cleared, null);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.css'), 'utf8');
  assert.match(css, /\.logo-lib-del \{[\s\S]*z-index:\s*3/);
  assert.match(css, /\.logo-lib-del \.svi \{[^}]*color:\s*#fff/);
  assert.match(css, /\.logo-lib-del:hover,\s*\n\.logo-lib-del:focus-visible \{[^}]*background:\s*#e23b3b/);

  window.api.mediaLibList = async () => [{ id: 'v1', name: 'Klip', url: 'sv-media://local/x', kind: 'video' }];
  const media = window.SVMediaLibUi.mount({ selectedId: 'v1' });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const vids = walk(media, []).filter((n) => n.tag === 'video');
  assert.strictEqual(vids.length, 1);
  assert.strictEqual(vids[0].attrs.preload, 'metadata');
  const cfg = {
    media: { libraryId: 'v1', file: 'sv-media://local/x', fileName: 'Klip' },
    layers: [
      { settings: { media: { libraryId: 'v1', file: 'u', fileName: 'Klip' } } },
      { settings: { media: { libraryId: 'other', file: 'keep', fileName: 'Diger' } } },
    ],
  };
  assert.strictEqual(window.SVMediaLibUi.forget(cfg, { id: 'v1' }), true);
  assert.strictEqual(cfg.media.file, '');
  assert.strictEqual(cfg.media.libraryId, '');
  assert.strictEqual(cfg.layers[0].settings.media.file, '');
  assert.strictEqual(cfg.layers[1].settings.media.file, 'keep');
});
