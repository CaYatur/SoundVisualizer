'use strict';
/* Spout/Syphon kartı: durum ana süreçten gelene dek çıkış anahtarı çizilmez
   (bir an görünüp tıklanabiliyor, sonra kart değişiyordu). */
const test = require('node:test');
const assert = require('node:assert');

function mount(platform, statusPromise) {
  global.window = {};
  window.SV_PLATFORM = platform;
  let rerenders = 0;
  let listener = null;
  window.api = {
    onTextureStatus: (cb) => { listener = cb; },
    textureStatus: () => statusPromise,
    textureSync: async () => ({}),
    textureSenders: async () => [],
  };
  const el = (tag, attrs, kids) => ({ tag, attrs: attrs || {}, kids: (kids || []).filter(Boolean), appendChild(c) { this.kids.push(c); return c; } });
  window.SVPanel = {
    el,
    cfg: () => ({ textureShare: { enabled: false, name: 'X' }, background: {} }),
    row: (label, ctrl) => el('div', { label }, [ctrl]),
    push() {},
    rerender() { rerenders++; },
  };
  delete require.cache[require.resolve('../src/admin/texture-panel.js')];
  const api = require('../src/admin/texture-panel.js');
  api._reset();
  const text = (n) => (n.attrs && n.attrs.text ? n.attrs.text : '') + (n.kids || []).map(text).join('|');
  const has = (n, pred) => pred(n) || (n.kids || []).some((k) => has(k, pred));
  return { api, text, has, rerenders: () => rerenders, push: (s) => listener(s) };
}

test('Linux: anahtar hiç çizilmez, "yok" kartı ilk karede gelir', () => {
  const m = mount({ isLinux: true }, new Promise(() => {}));
  const p = m.api.panel();
  assert.ok(!m.has(p, (n) => n.tag === 'input' && n.attrs.type === 'checkbox'), 'anahtar yok');
  assert.match(m.text(p), /Spout bir Windows/);
});

test('Windows/macOS: durum gelene dek anahtar yok; gelince yeniden çizilir ve anahtar çıkar', async () => {
  let resolve;
  const status = new Promise((r) => { resolve = r; });
  const m = mount({ isWindows: true }, status);
  const p1 = m.api.panel();
  assert.ok(!m.has(p1, (n) => n.tag === 'input'), 'bilinmeyen durumda tıklanacak bir şey yok');
  assert.strictEqual(m.rerenders(), 0);
  resolve({ running: false, supported: true, protocol: 'spout', frames: 0, dropped: 0, error: null, reason: null });
  await status;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(m.rerenders(), 1, 'durum gelince yeniden çizim istendi');
  const p2 = m.api.panel();
  assert.ok(m.has(p2, (n) => n.tag === 'input' && n.attrs.type === 'checkbox'), 'anahtar şimdi var');
  // sonraki durum güncellemeleri yeniden çizimi tetiklemez (döngü yok)
  m.push({ running: true, supported: true, protocol: 'spout', frames: 3 });
  assert.strictEqual(m.rerenders(), 1);
});

test('Windows/macOS: bileşen yoksa durum gelince "yok" kartı', async () => {
  const status = Promise.resolve({ running: false, supported: false, protocol: '', reason: 'NATIVE_MISSING' });
  const m = mount({ isMac: true }, status);
  m.api.panel();
  await status;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(m.rerenders(), 1);
  assert.match(m.text(m.api.panel()), /Spout bir Windows/);
});
