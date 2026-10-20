'use strict';
/* Ses Köprüsü kartının '?' yardımı (#813): kart her saniye yeniden çiziliyor;
   açık yardım açık kalmalı. İkinci tık, dışarı tık ya da Esc kapatır. */
const test = require('node:test');
const assert = require('node:assert');

function fakeDocument() {
  const all = [];
  const docL = {};
  const mk = (tag) => {
    const n = {
      tag, attrs: {}, children: [], listeners: {}, hidden: false, parent: null, className: '', style: {},
      classList: { toggle(c, on) { const s = new Set(n.className.split(' ').filter(Boolean)); if (on) s.add(c); else s.delete(c); n.className = Array.from(s).join(' '); }, contains: (c) => n.className.split(' ').includes(c) },
      set textContent(v) { n.attrs.text = v; },
      setAttribute(k, v) { n.attrs[k] = v; if (k === 'hidden') n.hidden = true; },
      getAttribute(k) { return n.attrs[k] == null ? null : n.attrs[k]; },
      addEventListener(t, f) { n.listeners[t] = f; },
      appendChild(c) { c.parent = n; n.children.push(c); return c; },
      closest(sel) { let x = n; const c = sel.slice(1); while (x) { if (x.className && x.className.split(' ').includes(c)) return x; x = x.parent; } return null; },
    };
    all.push(n);
    return n;
  };
  return {
    all, docL,
    createElement: mk,
    createTextNode: (t) => ({ text: t }),
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); },
    querySelectorAll(sel) {
      const cls = sel.split('[')[0].slice(1);
      return all.filter((n) => n.className.split(' ').includes(cls) && n.attrs['data-help-key'] != null && n.live !== false);
    },
  };
}

test("'?' yardımı: yeniden çizimde açık kalır; ikinci tık, dışarı tık ve Esc kapatır", () => {
  const doc = fakeDocument();
  global.document = doc;
  global.window = { SVI18n: { t: (s) => s } };
  delete require.cache[require.resolve('../src/admin/bridge-view.js')];
  require('../src/admin/bridge-view.js');
  const V = global.window.SVBridgeView;
  const draw = () => { const body = V.helpBody('Port açıklaması'); const btn = V.helpButton(body); return { body, btn }; };
  const ev = () => ({ preventDefault() {}, stopPropagation() { this.stopped = true; } });

  let { body, btn } = draw();
  assert.strictEqual(body.hidden, true, 'kapalı başlar');
  const e1 = ev();
  btn.listeners.click(e1);
  assert.strictEqual(body.hidden, false, 'tık açar');
  assert.ok(e1.stopped, 'tık belgeye ulaşmaz');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');

  // Kart yeniden çizildi: eski düğümler gitti, yenileri açık başlıyor
  body.live = false; btn.live = false;
  ({ body, btn } = draw());
  assert.strictEqual(body.hidden, false, 'yeniden çizimde açık kalır');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');

  // Yardımın içine tık kapatmaz; dışarı tık kapatır
  for (const f of doc.docL.click) f({ target: body });
  assert.strictEqual(body.hidden, false);
  for (const f of doc.docL.click) f({ target: doc.createElement('div') });
  assert.strictEqual(body.hidden, true, 'dışarı tık kapatır');

  // Esc kapatır
  btn.listeners.click(ev());
  assert.strictEqual(body.hidden, false);
  for (const f of doc.docL.keydown) f({ key: 'Escape' });
  assert.strictEqual(body.hidden, true, 'Esc kapatır');

  // İkinci tık kapatır
  btn.listeners.click(ev()); btn.listeners.click(ev());
  assert.strictEqual(body.hidden, true, 'ikinci tık kapatır');
  // Belge dinleyicileri bir kez kuruluyor
  assert.strictEqual(doc.docL.click.length, 1);
  delete global.document; delete global.window;
});
