'use strict';
/* KATMANLAR ATILIRKEN WebGL BAĞLAMLARINI BIRAKIYOR.
 *
 * Tarayıcı bir WebGL bağlamını ancak tuvali çöp toplandığında bırakıyor ve o
 * ana kadar ETKİN sayıyor. Chromium sınırı aşılınca en eski bağlamı
 * kaybettiriyor: atılmış bir katmanınkini değil, hâlâ çizen bir katmanın ya
 * da efekt zincirinin bağlamını. Sahne değiştikçe katmanlar kurulup
 * atıldığı için (Otomatik VJ bunu sürekli yapıyor) her WebGL katmanı
 * `dispose`da bağlamını `WEBGL_lose_context` ile bırakmalı.
 *
 * Stüdyo shader arka planında `dispose` hiç yoktu. Ölçüldü (gerçek Electron
 * sayfası): canlı bir WebGL2 bağlamı açıkken arka plan 40 kez kurulup
 * layers.js'in yaptığı gibi atıldı; 16. atımda canlı bağlam kayboldu. Şimdi
 * kaybolmuyor ve atılan 40 bağlamın 40'ı hemen bırakılıyor. MilkDrop
 * katmanı bağlamını ilk çizimde kuruyor; onunki milkdrop-dispose.test.js'te.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'src', 'visualizer', 'modes');
const WEBGL = /getContext\(\s*['"](?:webgl2?|experimental-webgl)['"]/;
// Bağlamını kurucuda alan katman dosyaları
const FILES = ['gradient.js', 'geometry3d.js', 'shaderhost.js'];

test('WebGL bağlamı isteyen her mod dosyası sınanıyor', () => {
  const found = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.js') && WEBGL.test(fs.readFileSync(path.join(DIR, f), 'utf-8')))
    .sort();
  /* Yeni bir WebGL katmanı eklenirse burada görünür ve aşağıdaki listeye
     (ya da MilkDrop gibi kendi testine) girmesi gerekir. */
  assert.deepStrictEqual(found, ['geometry3d.js', 'gradient.js', 'milkdrop.js', 'shaderhost.js']);
});

test('kurucuda WebGL bağlamı alan her katman sınıfı onu dispose\'da bırakıyor', () => {
  const contexts = [];
  const fakeGl = () => {
    const rec = { lost: 0 };
    contexts.push(rec);
    return new Proxy({}, {
      get(_, k) {
        if (k === 'getExtension') {
          return (n) => (n === 'WEBGL_lose_context' ? { loseContext: () => { rec.lost++; } } : null);
        }
        if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
        if (k === 'canvas') return { width: 2, height: 2 };
        if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
        return () => ({});
      },
    });
  };
  const ctx2d = new Proxy({}, { get: () => () => ({}) });
  const canvas = () => ({
    width: 2, height: 2, style: {}, addEventListener() {},
    getContext: (k) => (k === '2d' ? ctx2d : fakeGl()),
  });
  const sandbox = { window: {}, document: { createElement: canvas }, console, performance: { now: () => 0 } };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf-8'), sandbox, { filename: f });

  const classes = [];
  for (const group of ['SVModes', 'SVBackgrounds']) {
    for (const [name, C] of Object.entries(sandbox.window[group] || {})) classes.push([group + '.' + name, C]);
  }
  let checked = 0;
  for (const [name, C] of classes) {
    const before = contexts.length;
    const inst = new C(canvas());
    const made = contexts.slice(before);
    if (!made.length) continue;
    checked++;
    // layers.js _disposeEntry: dispose varsa çağırıyor, yoksa geçiyor
    assert.strictEqual(typeof inst.dispose, 'function', name + ' dispose etmiyor');
    inst.dispose();
    assert.deepStrictEqual(made.map((r) => r.lost), made.map(() => 1), name + ' bağlamını bırakmıyor');
  }
  // gradient, geometry, custom, feedback ve stüdyo shader arka planı
  assert.strictEqual(checked, 5, 'sınanan sınıf sayısı');
});
