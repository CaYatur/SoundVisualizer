'use strict';
/* WEBGL BAĞLAMI KAYBOLUNCA MOTOR GERİ GELİYOR (#572).
 *
 * Sürücü sıfırlanması, GPU sürecinin çökmesi ya da uzun bir gecede bir GPU
 * takılması bağlamı götürüyor: programlar, dokular, tamponlar gidiyor.
 * Kodda hiçbir yerde `webglcontextlost` dinleyicisi yoktu; katman uygulama
 * yeniden açılana kadar siyah kalıyordu.
 *
 * Buradaki testler motoru Node'da sahte bir tuval ve sahte bir GL ile
 * kuruyor ve GERÇEKTEN ne yaptığını okuyor: olayın geri çevrilmesi
 * (preventDefault olmadan tarayıcı bağlamı hiç geri vermiyor), kaybolan
 * nesnelerin unutulması, presetin ve saatin korunması, tarayıcı geri
 * vermediğinde yeni tuvale geçilmesi. Gerçek bir bağlamda kaybettirip
 * karelerin geri geldiğini öz test ölçüyor (main.js, "bağlam kaybı").
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js');
const CODE = fs.readFileSync(FILE, 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* Sahte GL: her çağrıyı kaydeder, `create*` benzersiz nesne döndürür.
   `isContextLost` testin denetiminde — gerçek hayatta kaybın kendisi de
   olaydan önce buradan görülebiliyor. */
function fakeGl() {
  const calls = [];
  const state = { lost: false, ext: null };
  let n = 0;
  const gl = new Proxy({}, {
    get(_, k) {
      const name = String(k);
      if (name === 'isContextLost') return () => state.lost;
      if (name === 'getExtension') {
        return (ext) => {
          calls.push('getExtension:' + ext);
          if (ext !== 'WEBGL_lose_context') return null;
          return (state.ext = { loseContext: () => { state.lost = true; calls.push('loseContext'); } });
        };
      }
      if (/^[A-Z_0-9]+$/.test(name)) return name;          // gl.RGBA8 gibi sabitler
      if (/^create/.test(name)) {
        return () => { calls.push(name); return { gl: name + (++n) }; };
      }
      /* Derleme ve bağlama BAŞARILI — ama kaybolmuş bir bağlamda değil:
         gerçek WebGL orada null döndürüyor ve motor bunu başarısızlık
         sayıyor. */
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => !state.lost;
      if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
      if (name === 'getError') return () => 'NO_ERROR';
      if (name === 'getParameter') return () => 16;
      if (name === 'getUniformLocation') return (_p, u) => u;
      return (...args) => { calls.push(name); return args[0]; };
    },
  });
  return { gl, calls, state };
}

/* Sahte tuval: dinleyicileri tutuyor ki olay gönderilebilsin. Her tuval
   KENDİ bağlamını veriyor — yeni tuvale geçişin gerçekten yeni bir bağlam
   demek olduğu ancak böyle görülür. */
function makeCanvas(made) {
  const listeners = {};
  const c = {
    width: 320, height: 240,
    gl: null,
    getContext(kind) {
      if (kind === '2d') return new Proxy({}, { get: () => () => undefined });
      if (!this.gl) this.gl = fakeGl();
      return this.gl.gl;
    },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    fire(type, e) { for (const fn of listeners[type] || []) fn(e); },
    listeners,
  };
  if (made) made.push(c);
  return c;
}

function load() {
  const made = [];
  const clock = { t: 1000 };
  const ctx = {
    window: {},
    document: { createElement: () => makeCanvas(made) },
    performance: { now: () => clock.t },
    console,
  };
  ctx.window.document = ctx.document;
  ctx.window.performance = ctx.performance;
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: FILE });
  const canvas = makeCanvas(made);
  const m = new ctx.window.SVModes.milkdrop(canvas);
  return { m, made, clock, canvas, ctx };
}

/* Motoru bir bağlama oturtur: `_initGL` sabit kaynakları kurar, dinleyiciler
   ekran dışı tuvale bağlanır. */
function init(m) {
  assert.strictEqual(m._initGL(64, 64), true, 'sahte GL ile kurulum başarısız');
  return m.gl2;
}

test('kayıp olayı GERİ ÇEVRİLİYOR: yoksa tarayıcı bağlamı hiç geri vermez', () => {
  const { m } = load();
  const canvas = init(m);
  let prevented = 0;
  canvas.fire('webglcontextlost', { preventDefault: () => { prevented++; } });
  assert.strictEqual(prevented, 1, 'preventDefault çağrılmadı');
  assert.ok(m._lost, 'kayıp kaydedilmedi');
  assert.strictEqual(m._lost.restored, false);
});

test('dinleyici GÖRÜNÜR tuvale değil, bağlamın sahibi tuvale bağlanıyor', () => {
  /* `this.canvas` 2D yüzey; bağlam ekran dışı `gl2`de. Yanlış tuvale
     bağlanan bir dinleyici hiç çalışmaz ve hata da vermez. */
  const { m, canvas } = load();
  init(m);
  assert.ok(m.gl2.listeners.webglcontextlost, 'gl2 dinlenmiyor');
  assert.ok(!canvas.listeners.webglcontextlost, 'görünür tuval dinleniyor');
});

test('kendi bıraktığımız bağlam kayıp sayılmıyor', () => {
  /* `dispose` bağlamı bilerek kaybettiriyor (Chromium etkin bağlam
     sınırı). O olay kurtarma başlatsaydı atılmış bir örnek dirilirdi. */
  const { m } = load();
  const canvas = init(m);
  m.dispose();
  let prevented = 0;
  canvas.fire('webglcontextlost', { preventDefault: () => { prevented++; } });
  assert.strictEqual(prevented, 0, 'atılmış örnek olayı geri çevirmemeli');
  assert.strictEqual(m._lost, null);
});

test('kaybolan bağlamın bütün GL nesneleri unutuluyor', () => {
  /* Envanter kaynaktan çıkarılıyor: motora yeni bir tampon eklenip
     listeye yazılmazsa ölü bağlamın nesnesiyle çizilirdi. */
  const names = new Set();
  const re = /this\.([A-Za-z_]\w*) = (?:gl\.create(?:Buffer|VertexArray|Program|Texture|Sampler|Framebuffer)\(\)|\w+\.prog);/g;
  let mt;
  while ((mt = re.exec(BODY))) names.add(mt[1]);
  assert.ok(names.size >= 15, 'envanter taraması çalışmadı (' + names.size + ')');
  const { m } = load();
  init(m);
  for (const n of names) m[n] = { name: n };
  m.targets = [1, 2]; m.blur = [1]; m.flash = {}; m.noise = {}; m.samplers = {};
  m.userTex = { x: { tex: 1 } };
  m._forgetGL();
  const left = [...names].filter((n) => m[n] !== null);
  assert.deepStrictEqual(left, [], 'unutulmayan nesne: ' + left.join(', '));
  for (const k of ['targets', 'blur', 'flash', 'noise', 'samplers', 'warpPreset', 'compPreset', 'oldPreset']) {
    assert.strictEqual(m[k], null, k + ' unutulmadı');
  }
  /* `deepStrictEqual` ile boş nesne karşılaştırılmıyor: motor vm içinde
     kurulu, oradaki {} başka bir realm'in prototipini taşıyor. */
  assert.strictEqual(Object.keys(m.userTex).length, 0, 'kullanıcı dokuları unutulmadı');
});

test('preset ve saat kayıptan sağ çıkıyor, shader yeniden derleniyor', () => {
  /* İstenen bu: "çalışan preseti ve denklem durumunu koru". Havuz saf JS,
     yani kaybolan yalnız GPU tarafı. */
  const { m } = load();
  init(m);
  const preset = { pool: 'havuz' };
  m.preset = preset;
  m.presetKey = 'x';
  m.time = 42;
  m._presetSrc = 'decay=0.9\n';
  m._forgetGL();
  assert.strictEqual(m.preset, preset, 'preset nesnesi değişti');
  assert.strictEqual(m.time, 42, 'saat sıfırlandı');
  assert.strictEqual(m._shadersLost, true, 'shader yeniden derlenmeyecek');
  /* Çizim, preset değişmemiş olsa bile shader'ları kaynaktan kuruyor. */
  assert.match(BODY, /if \(\(this\._shadersLost \|\| this\._stagesAcc !== \(this\._wantAcc !== false\)\) && this\._presetSrc\) \{\s*this\._buildPresetShaders\(this\._presetSrc\);/);
  assert.match(BODY, /this\._presetSrc = src;/);
});

test('geri gelene kadar çizilmiyor: son kare duruyor, saat durmuş oluyor', () => {
  const { m, clock } = load();
  init(m);
  m.gl2.fire('webglcontextlost', { preventDefault() {} });
  assert.strictEqual(m._recover(), false, 'kayıpken çizim sürüyor');
  clock.t += 1000;
  assert.strictEqual(m._recover(), false, 'süre dolmadan yeni tuvale geçti');
  // Çizim gerçekten burada duruyor: kurtarma başarısızsa kare çizilmiyor.
  assert.match(BODY, /if \(!this\._recover\(\)\) return;/);
});

test('tarayıcı geri verirse AYNI bağlamda sürüyor', () => {
  const { m } = load();
  const canvas = init(m);
  const before = m.gl;
  canvas.gl.state.lost = true;
  canvas.fire('webglcontextlost', { preventDefault() {} });
  canvas.gl.state.lost = false;
  canvas.fire('webglcontextrestored', {});
  assert.strictEqual(m._recover(), true, 'geri gelen bağlamla çizim başlamadı');
  assert.strictEqual(m.gl, before, 'aynı bağlam kullanılmalı');
  assert.strictEqual(m.gl2, canvas, 'tuval değişmemeli');
  assert.strictEqual(m.recoveredBy, 'restored');
  assert.strictEqual(m.warpFixed, null, 'sabit kaynaklar unutulmadı');
  // Ve yeniden kuruluyor: `_initGL` sabitleri eksik bulunca baştan kurar.
  assert.strictEqual(m._initGL(64, 64), true);
  assert.ok(m.warpFixed, 'sabit kaynaklar yeniden kurulmadı');
});

test('tarayıcı geri vermezse süre dolunca YENİ tuvalde yeni bağlam', () => {
  /* Elle kaybettirilen bir bağlam (WEBGL_lose_context) ve tarayıcının
     vazgeçtiği durumlar hiç `webglcontextrestored` üretmiyor. Beklemekle
     kalmak, ekranın sonsuza kadar siyah kalması demekti. */
  const { m, clock } = load();
  const first = init(m);
  first.gl.state.lost = true;
  first.fire('webglcontextlost', { preventDefault() {} });
  clock.t += 3001;
  assert.strictEqual(m._recover(), true, 'süre dolunca yeni bağlam kurulmuyor');
  assert.notStrictEqual(m.gl2, first, 'eski tuval bırakılmadı');
  assert.strictEqual(m.gl, null, 'yeni bağlam bir sonraki _initGL ile alınmalı');
  assert.strictEqual(m.recoveredBy, 'new-canvas');
  assert.strictEqual(m._initGL(64, 64), true, 'yeni tuvalde bağlam alınamadı');
  assert.ok(m.gl && !m.gl.isContextLost(), 'yeni bağlam kayıp');
  assert.ok(m.warpFixed, 'yeni bağlamda sabit kaynaklar kurulmadı');
});

test('terk edilen tuvalin bağlamı sonradan geri gelirse bırakılıyor', () => {
  /* Yoksa kimsenin çizmediği bir bağlam etkin sayılmaya devam eder ve
     Chromium'un sınırını canlı katmanların aleyhine doldururdu. */
  const { m, clock } = load();
  const first = init(m);
  first.gl.state.lost = true;
  first.fire('webglcontextlost', { preventDefault() {} });
  clock.t += 3001;
  m._recover();
  first.fire('webglcontextrestored', {});
  assert.ok(first.gl.calls.includes('loseContext'), 'terk edilen bağlam bırakılmadı');
  assert.strictEqual(m.gl2 === first, false);
});

test('olay kaçarsa bağlamın kendisi söylüyor', () => {
  /* Dinleyici eklenmeden önce kaybolan ya da olayı hiç göndermeyen bir
     durumda da kare başında `isContextLost` soruluyor. */
  const { m, clock } = load();
  const canvas = init(m);
  canvas.gl.state.lost = true;
  assert.strictEqual(m._recover(), false, 'kayıp fark edilmedi');
  assert.ok(m._lost, 'kayıp kaydedilmedi');
  clock.t += 3001;
  assert.strictEqual(m._recover(), true);
  assert.strictEqual(m.recoveredBy, 'new-canvas');
});

test('bağlam hiç alınamazsa deneme aralıklı, her karede değil', () => {
  /* GPU süreci daha kalkmamışken `getContext` null dönüyor. Her karede
     yeniden denemek saniyede altmış tuval demekti. */
  assert.match(BODY, /this\._noCtxAt = performance\.now\(\);/);
  assert.match(BODY, /performance\.now\(\) - this\._noCtxAt < CONTEXT_RETRY_MS/);
  const m = /const CONTEXT_RETRY_MS = (\d+);/.exec(CODE);
  assert.ok(m && +m[1] >= 500, 'yeniden deneme aralığı yok');
});

test('GPU çökünce Chromium 3B\'yi kapatmasın diye alan engellemesi kapalı', () => {
  /* Chromium, GPU süreci çökerse o alanı 3B API'lerden engelliyor;
     engellenen sayfa bizim kendi sayfamız ve o hâlde yeni bağlam da
     alınamıyor, yani kurtarma işlemez hâle geliyor. */
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf-8');
  assert.match(main, /app\.disableDomainBlockingFor3DAPIs\(\);/);
  const at = main.indexOf('app.disableDomainBlockingFor3DAPIs();');
  const ready = main.indexOf('app.whenReady()');
  assert.ok(at > 0 && at < ready, 'çağrı ready\'den önce olmalı (Electron başka türlü kabul etmiyor)');
});

test('öz test bağlamı gerçekten kaybettirip kareleri ve pikselleri ölçüyor', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf-8');
  assert.match(main, /WEBGL_lose_context/, 'öz test bağlamı kaybettirmiyor');
  assert.match(main, /restoreContext\(\)/, 'geri verilen bağlam yolu sınanmıyor');
  assert.match(main, /context loss \(' \+ phase \+ '\): no frames after the context came back/);
  assert.match(main, /the picture did not come back/);
  /* Yığına erişim: öz testin çizen motoru bulabilmesi için tek kapı. */
  const vis = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'visualizer.js'), 'utf-8');
  assert.match(vis, /window\.SVStage = \{ stack: \(\) => stack \};/);
});
