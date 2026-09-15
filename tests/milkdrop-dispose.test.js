'use strict';
/* KATMAN KAPANIRKEN WebGL BAĞLAMI BIRAKILIYOR.
 *
 * MilkDrop katmanı `dispose`da GL nesnelerini tek tek siliyordu ama
 * bağlamın kendisini bırakmıyordu. Tarayıcı bağlamı ancak tuval çöp
 * toplandığında bırakıyor ve o ana kadar ETKİN sayıyor; Chromium sınırı
 * aşılınca en eski bağlamı kaybettiriyor — hâlâ çizen bir katmanınkini.
 * Ölçüldü (gerçek Electron sayfası): canlı bir WebGL2 bağlamı açıkken
 * katman 40 kez kurulup iki kare çizip atıldı. Önce 16. atımda "Too many
 * active WebGL contexts" uyarısı geldi ve canlı bağlam kayboldu; şimdi
 * uyarı yok, canlı bağlam duruyor, atılan 40 bağlamın 40'ı hemen kayıp.
 *
 * Buradaki testler motoru Node'da sahte bir tuval ve sahte bir GL ile
 * kuruyor: `dispose`un GERÇEKTEN ne çağırdığı kaydediliyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js');
const CODE = fs.readFileSync(FILE, 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function load() {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: FILE });
  return { Mode: ctx.window.SVModes.milkdrop, canvas };
}

// Her çağrıyı sırasıyla kaydeden sahte GL
function fakeGl(withExt) {
  const calls = [];
  const gl = new Proxy({}, {
    get(_, k) {
      if (k === 'getExtension') {
        return (name) => {
          calls.push('getExtension:' + name);
          return withExt ? { loseContext: () => calls.push('loseContext') } : null;
        };
      }
      return (...args) => { calls.push(String(k)); return args[0]; };
    },
  });
  return { gl, calls };
}

// Motorun kurduğu GL nesneleri: `this.X = gl.createX()` ve `this.X = y.prog;`
function ownedNames() {
  const names = new Set();
  const re = /this\.([A-Za-z_]\w*) = (?:gl\.create(?:Buffer|VertexArray|Program|Texture|Sampler|Framebuffer)\(\)|\w+\.prog);/g;
  let m;
  while ((m = re.exec(BODY))) names.add(m[1]);
  return [...names];
}

test('dispose: bağlam bırakılıyor, en son', () => {
  const { Mode, canvas } = load();
  const m = new Mode(canvas());
  const { gl, calls } = fakeGl(true);
  m.gl = gl;
  for (const n of ownedNames()) m[n] = { name: n };
  m.dispose();
  assert.strictEqual(calls.filter((c) => c === 'loseContext').length, 1);
  assert.strictEqual(calls[calls.length - 1], 'loseContext', 'bağlam silmelerden SONRA bırakılmalı');
  assert.ok(calls.includes('getExtension:WEBGL_lose_context'));
  assert.strictEqual(m.gl, null);
  assert.strictEqual(m._disposed, true);
});

/* Envanter: motorun kaynakta kurduğu her tampon, köşe dizisi ve program
   `dispose`da siliniyor. Dokulu şekil tamponu ve flaş sınırlama programı
   listede yoktu. Bağlam bırakılınca sürücü hepsini zaten bırakıyor, ama
   uzantının olmadığı bir bağlamda silme tek yol. */
test('dispose: motorun kurduğu her GL nesnesi siliniyor', () => {
  const names = ownedNames();
  for (const must of ['vao', 'vbo', 'ibo', 'lineProg', 'flashProg', 'shapeTexVao', 'shapeTexVbo']) {
    assert.ok(names.includes(must), 'envanter taraması ' + must + ' bulamadı');
  }
  const { Mode, canvas } = load();
  const m = new Mode(canvas());
  const deleted = [];
  m.gl = new Proxy({}, {
    get: (_, k) => (k === 'getExtension' ? () => null
      : (obj) => { if (/^delete/.test(String(k)) && obj && obj.name) deleted.push(obj.name); }),
  });
  for (const n of names) m[n] = { name: n };
  m.dispose();
  const missing = names.filter((n) => !deleted.includes(n));
  assert.deepStrictEqual(missing, [], 'dispose silmiyor: ' + missing.join(', '));
});

test('dispose: bağlam uzantısı yoksa ya da bağlam hiç kurulmadıysa çökmüyor', () => {
  const { Mode, canvas } = load();
  const a = new Mode(canvas());
  a.gl = fakeGl(false).gl;
  assert.doesNotThrow(() => a.dispose());
  assert.strictEqual(a._disposed, true);
  const b = new Mode(canvas());
  assert.doesNotThrow(() => b.dispose());
  assert.strictEqual(b._disposed, true);
});

/* Atılan örnek bir daha çizmiyor: `_initGL` aynı tuvalden bağlam isteseydi
   kaybedilmiş bağlamı geri alır ve sessizce siyah çizerdi. `draw` burada
   geçersiz argümanlarla çağrılıyor — ilerleseydi ilk satırlarda çökerdi. */
test('dispose: atılan örnek çizmiyor', () => {
  const { Mode, canvas } = load();
  const m = new Mode(canvas());
  m.gl = fakeGl(true).gl;
  m.dispose();
  assert.doesNotThrow(() => m.draw(null, null, 0, 0));
  assert.strictEqual(m.gl, null, 'çizim bağlamı yeniden kurmamalı');
  const fresh = new Mode(canvas());
  assert.throws(() => fresh.draw(null, null, 0, 0), 'atılmamış örnek bu argümanlarla çökmeliydi');
});
