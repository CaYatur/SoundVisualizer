'use strict';
/* ÇİZİMİ BEKLETMEDEN DERLEME (#907). Sonucu sormak bekletiyor: sahte GL her
   durum sorgusunu `blocked` olarak sayıyor, yani "derleme sürerken hiçbir şey
   beklemedi" gerçekten sınanıyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const Link = require('../src/shared/gl-link.js');
const L = require('../src/visualizer/layers.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

const COMPLETION = 0x91b1;
function fakeGl(opts = {}) {
  const rec = { blocked: 0, draws: [], programs: [], deleted: [], current: null, fb: null };
  rec.finish = (i) => { rec.programs[i === undefined ? rec.programs.length - 1 : i].done = true; };
  const fails = (p) => p.attached.some((s) => opts.bad && opts.bad.test(s.src));
  const base = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: (type) => ({ type, src: '' }),
    shaderSource: (s, src) => { s.src = src; },
    compileShader() {}, deleteShader() {}, linkProgram() {}, bindAttribLocation() {},
    createProgram: () => { const p = { done: !opts.slow, attached: [] }; rec.programs.push(p); return p; },
    attachShader: (p, s) => { p.attached.push(s); },
    deleteProgram: (p) => { rec.deleted.push(p); },
    getExtension: (n) => {
      if (n === 'KHR_parallel_shader_compile') return opts.noExt ? null : { COMPLETION_STATUS_KHR: COMPLETION };
      return n === 'WEBGL_lose_context' ? { loseContext() {} } : null;
    },
    getProgramParameter: (p, k) => {
      if (k === COMPLETION) return p.done;
      rec.blocked++;
      return !fails(p);
    },
    getShaderParameter: (s) => { rec.blocked++; return !(opts.bad && opts.bad.test(s.src)); },
    getShaderInfoLog: () => 'ERROR: 0:7: bozuk satır',
    getProgramInfoLog: () => 'bağlama',
    getUniformLocation: (p, name) => { rec.blocked++; return { name }; },
    getAttribLocation: () => { rec.blocked++; return 0; },
    useProgram: (p) => { rec.current = p; },
    bindFramebuffer: (t, fb) => { rec.fb = fb; },
    createFramebuffer: () => ({ fbo: true }),
    drawArrays: () => { rec.draws.push({ prog: rec.current, toScreen: rec.fb === null }); },
    isContextLost: () => false,
  };
  const gl = new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 9;
      return () => ({});
    },
  });
  return { gl, rec };
}

const ctx2d = () => new Proxy({ drawn: 0 }, {
  get(t, k) {
    if (k === 'drawImage') return () => { t.drawn++; };
    if (k in t) return t[k];
    return () => ({});
  },
  set(t, k, v) { t[k] = v; return true; },
});
function canvasWith(gl) {
  const c2 = ctx2d();
  return {
    width: 64, height: 64, style: {}, classList: { add() {} }, addEventListener() {},
    getContext: (k) => (k === '2d' ? c2 : gl),
  };
}
/* Modül yüklenirken sınıflar pencereye yazılıyor; her sınama kendi GL'ini `next`ten alır */
let next = null;
global.document = { createElement: () => canvasWith(next) };
require('../src/visualizer/modes/shaderhost.js');
require('../src/visualizer/modes/gradient.js');
require('../src/visualizer/postfx.js');

function host(opts) {
  const f = fakeGl(opts);
  next = f.gl;
  const h = new window.SVShaderHost({ transparent: true });
  f.rec.blocked = 0;
  f.rec.programs.length = 0;
  return { h, rec: f.rec, gl: f.gl };
}

test.afterEach(() => { delete window.SVMilkdropSync; });

test('yardımcı: uzantı yoksa ve dışa aktarımda beklemek gerekiyor', () => {
  assert.strictEqual(Link.canWait(fakeGl().gl), true);
  assert.strictEqual(Link.canWait(fakeGl({ noExt: true }).gl), false);
  window.SVMilkdropSync = true;
  assert.strictEqual(Link.canWait(fakeGl().gl), false);
});

test('yardımcı: başlatmak sonucu sormuyor; hata günlüğü hangi aşamadan geldiğini söylüyor', () => {
  const { gl, rec } = fakeGl({ slow: true, bad: /bozuk/ });
  const h = Link.begin(gl, 'v', 'bozuk');
  assert.strictEqual(rec.blocked, 0);
  assert.strictEqual(Link.ready(gl, h), false);
  rec.finish();
  assert.strictEqual(Link.ready(gl, h), true);
  const r = Link.end(gl, h);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.stage, 'compile');
  assert.match(r.log, /bozuk satır/);
  assert.deepStrictEqual(rec.deleted, [h.p]);
});

test('sürücü "bitti" demezse beş saniye sonra sonuç doğrudan alınıyor', () => {
  const { gl, rec } = fakeGl({ slow: true });
  const h = Link.begin(gl, 'v', 'f');
  assert.strictEqual(Link.ready(gl, h), false);
  h.startedAt -= 4000;
  assert.strictEqual(Link.ready(gl, h), false);
  h.startedAt -= 2000;
  assert.strictEqual(Link.ready(gl, h), true);
  assert.strictEqual(Link.end(gl, h).ok, true);
  assert.ok(rec.blocked > 0);
});

test('bağlam kaybı derleme hatası sayılmıyor: gradyan düz renge düşmüyor, efekt işaretlenmiyor', () => {
  const g = gradient({ slow: true });
  const lost = (gl) => { gl.isContextLost = () => true; };
  g.rec.finish();
  lost(g.gl);
  g.m.draw(noAudio, gradCfg(), 0);
  assert.strictEqual(g.m.failed, false, 'kalıcı düz renge düştü');
  assert.strictEqual(g.rec.blocked, 0);
  const fx = postfx({ slow: true });
  frame(fx.fx);
  fx.rec.programs.forEach((p) => { p.done = true; });
  lost(fx.gl);
  frame(fx.fx);
  assert.deepStrictEqual(fx.fx._failed, {});
  const h = host({ slow: true });
  h.h.beginSource('a', []);
  h.rec.finish();
  lost(h.gl);
  assert.strictEqual(h.h.pollSource(), null);
  assert.strictEqual(h.h.error, null);
});

test('Studio: yeni program hazır olana kadar eskisi çiziyor, kimse beklemiyor', () => {
  const { h, rec } = host({ slow: true });
  assert.strictEqual(h.beginSource('void mainImage(out vec4 c, vec2 f){c=vec4(1);}', []), null);
  rec.finish();
  assert.deepStrictEqual(h.pollSource(), { ok: true });
  const old = h.program;
  assert.ok(old);
  rec.blocked = 0;

  assert.strictEqual(h.beginSource('void mainImage(out vec4 c, vec2 f){c=vec4(0);}', []), null);
  assert.strictEqual(h.pollSource(), null);
  assert.strictEqual(h.pollSource(), null);
  assert.strictEqual(h.program, old, 'eski program yerinde');
  assert.strictEqual(rec.blocked, 0, 'derleme sürerken durum soruldu');

  rec.finish();
  assert.deepStrictEqual(h.pollSource(), { ok: true });
  assert.notStrictEqual(h.program, old);
  assert.ok(rec.deleted.includes(old), 'eski program silindi');
  assert.strictEqual(h.frame, 0);
});

test('Studio: aynı kaynak yeniden derlenmiyor, sürerken gelen yeni seçim eskisini iptal ediyor', () => {
  const { h, rec } = host({ slow: true });
  h.beginSource('a', []);
  h.beginSource('a', []);
  assert.strictEqual(rec.programs.length, 1, 'aynı kaynak ikinci kez başladı');
  const first = rec.programs[0];
  h.beginSource('b', []);
  assert.strictEqual(rec.programs.length, 2);
  assert.ok(rec.deleted.includes(first), 'iptal edilen iş silinmedi');
  rec.finish(1);
  assert.deepStrictEqual(h.pollSource(), { ok: true });
  assert.strictEqual(h.program, rec.programs[1]);
  // Ekrandakini yeniden seçmek iş başlatmıyor
  assert.deepStrictEqual(h.beginSource('b', []), { ok: true });
  assert.strictEqual(rec.programs.length, 2);
});

test('Studio: derleme hatası satırıyla geliyor, ekrandaki program kalıyor', () => {
  const { h, rec } = host({ slow: true, bad: /bozuk/ });
  h.beginSource('iyi', []);
  rec.finish();
  h.pollSource();
  const good = h.program;
  h.beginSource('bozuk', []);
  rec.finish();
  const r = h.pollSource();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.line, 7);
  assert.match(r.error.message, /bozuk satır/);
  assert.strictEqual(h.program, good);
  assert.strictEqual(h.pollSource(), null, 'sonuç bir kez');
});

test('Studio: dışa aktarımda ve uzantı yoksa eski bekleyen yol', () => {
  window.SVMilkdropSync = true;
  const a = host({ slow: true });
  assert.deepStrictEqual(a.h.beginSource('x', []), { ok: true });
  assert.ok(a.rec.blocked > 0);
  assert.ok(a.h.program);
  delete window.SVMilkdropSync;
  const b = host({ noExt: true, bad: /bozuk/ });
  const r = b.h.beginSource('bozuk', []);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.line, 7);
});

test('Studio: elle derleme (setSource) süren işi bırakıp hemen sonuç veriyor', () => {
  const { h, rec } = host({ slow: true });
  h.beginSource('a', []);
  assert.deepStrictEqual(h.setSource('b', []), { ok: true });
  assert.strictEqual(h.pollSource(), null);
  assert.ok(rec.deleted.includes(rec.programs[0]));
});

test('özel görselleştirici: yeni preset derlenirken ekrandakinin denetimleriyle çiziyor', () => {
  const f = fakeGl({ slow: true });
  next = f.gl;
  const canvas = canvasWith(f.gl);
  const A = { id: 'a', updatedAt: 1, engine: 'shader', shader: 'a', controls: [{ name: 'uA' }] };
  const B = { id: 'b', updatedAt: 1, engine: 'shader', shader: 'b', controls: [{ name: 'uB' }] };
  let current = A;
  window.SVPresets = { get: () => current, paramValues: (p) => ({ from: p.id }) };
  const M = new window.SVModes.custom(canvas);
  f.rec.programs.length = 0;
  const seen = [];
  const real = M.host.render.bind(M.host);
  M.host.render = (a, c, t, dt, controls, values) => { seen.push([controls[0].name, values.from]); return real(a, c, t, dt, controls, values); };
  const cfg = { custom: { visualizerId: 'x' }, visualizer: {} };
  const audio = { bass: 0, level: 0 };
  M.draw(audio, cfg, 0, 0.016);
  // İlk preset: henüz program yok, render false döner ve hiçbir şey çizilmez
  assert.strictEqual(f.rec.draws.length, 0);
  f.rec.finish();
  M.draw(audio, cfg, 0, 0.016);
  assert.deepStrictEqual(seen[seen.length - 1], ['uA', 'a']);
  current = B;
  M.draw(audio, cfg, 0, 0.016);
  assert.deepStrictEqual(seen[seen.length - 1], ['uA', 'a'], 'derlenirken yeni denetimler eski programa yazıldı');
  f.rec.finish();
  M.draw(audio, cfg, 0, 0.016);
  assert.deepStrictEqual(seen[seen.length - 1], ['uB', 'b']);
  delete window.SVPresets;
});

function gradient(opts) {
  const f = fakeGl(opts);
  const m = new window.SVModes.gradient(canvasWith(f.gl));
  return { m, rec: f.rec, gl: f.gl };
}
const gradCfg = () => window.SV.defaultConfig();
const noAudio = { bass: 0, level: 0, mid: 0, high: 0 };

test('gradyan: kurucu beklemiyor, hazır olunca çizmeye başlıyor', () => {
  const { m, rec } = gradient({ slow: true });
  assert.strictEqual(rec.blocked, 0, 'kurucu sonucu sordu');
  m.draw(noAudio, gradCfg(), 0);
  assert.strictEqual(rec.draws.length, 0);
  assert.strictEqual(rec.blocked, 0);
  rec.finish();
  m.draw(noAudio, gradCfg(), 0.1);
  assert.strictEqual(rec.draws.length, 1);
  assert.strictEqual(m.failed, false);
});

test('gradyan: arka planda başarısızsa `failed` kalkıyor; dışa aktarımda kurucu fırlatıyor', () => {
  const { m, rec } = gradient({ slow: true, bad: /gl_FragColor/ });
  rec.finish();
  m.draw(noAudio, gradCfg(), 0);
  assert.strictEqual(m.failed, true);
  assert.strictEqual(rec.draws.length, 0);
  m.draw(noAudio, gradCfg(), 0);
  window.SVMilkdropSync = true;
  assert.throws(() => gradient({ bad: /gl_FragColor/ }));
  delete window.SVMilkdropSync;
  // Bağlam alınamayan makine eskisi gibi kurucuda düşüyor (K1)
  assert.throws(() => new window.SVModes.gradient(canvasWith(null)));
});

test('katman: gradyan sonradan başarısız olursa yeni tuvalle düz renge düşüyor', () => {
  const creates = [];
  global.document = {
    createElement: () => {
      const c = canvasWith(null);
      c.parentNode = null;
      creates.push(c);
      return c;
    },
  };
  const realGradient = window.SVModes.gradient;
  window.SVModes.gradient = function () { this.failed = false; this.draw = () => { this.failed = true; }; };
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const cfg = { background: { type: 'gradient', solidColor: '#abcdef' } };
  const e = stack._create(L.normalizeLayer({ id: 'b', kind: 'background', type: 'gradient' }), 'b', cfg);
  stack.entries = [e];
  const first = e.canvas;
  assert.strictEqual(e.gl, true);
  stack._drawEntryRaw(e, { ready: false }, cfg, 0, 1 / 60);
  assert.strictEqual(e.gl, false);
  assert.strictEqual(e.solid, true);
  assert.notStrictEqual(e.canvas, first, 'WebGL bağlamı alınmış tuvalden 2D bağlam alınamaz');
  assert.ok(e.ctx);
  assert.strictEqual(stack.hasGradientWebGLFallback(), true);
  stack._drawEntryRaw(e, { ready: false }, cfg, 0, 1 / 60);
  assert.strictEqual(e.ctx.fillStyle, '#abcdef');
  window.SVModes.gradient = realGradient;
  global.document = { createElement: () => canvasWith(next) };
});

function postfx(opts) {
  const f = fakeGl(opts);
  next = f.gl;
  const fx = new window.SVPostFX.PostFX();
  fx.setChain([{ type: 'bloom', enabled: true }, { type: 'crt', enabled: true }]);
  fx.resize(64, 64);
  f.rec.programs.length = 0;
  f.rec.draws.length = 0;
  return { fx, rec: f.rec, gl: f.gl };
}
const SRC = {};
const frame = (fx, see) => fx.render(SRC, { bass: 0 }, 0, 0.016, see);

test('efektler: hiçbiri hazır değilken sahne efektsiz ekranda', () => {
  const { fx, rec } = postfx({ slow: true });
  assert.strictEqual(frame(fx), true);
  // İki iş başladı, üçüncü program yalnız kopya
  assert.strictEqual(rec.programs.length, 3);
  assert.strictEqual(rec.draws.length, 1);
  assert.strictEqual(rec.draws[0].toScreen, true);
  assert.strictEqual(rec.draws[0].prog, fx.programs.__opaque.prog);
  // Efektler gibi opak: saydam olmayan yolda boş köşe saydam kalmamalı
  const frag = rec.draws[0].prog.attached.map((s) => s.src).join('');
  assert.match(frag, /outColor = vec4\(texture\(uTex, vUV\)\.rgb, 1\.0\)/);
});

test('efektler: hazır olan devreye giriyor, ekrana çizen son HAZIR efekt', () => {
  const { fx, rec } = postfx({ slow: true });
  frame(fx);
  const [bloom, crt] = rec.programs;
  bloom.done = true;
  rec.draws.length = 0;
  frame(fx);
  assert.deepStrictEqual(rec.draws, [{ prog: bloom, toScreen: true }]);
  crt.done = true;
  rec.draws.length = 0;
  frame(fx);
  assert.deepStrictEqual(rec.draws, [{ prog: bloom, toScreen: false }, { prog: crt, toScreen: true }]);
});

test('efektler: saydam modda hazır efekt yokken de örtü kuruluyor', () => {
  const { fx, rec } = postfx({ slow: true });
  frame(fx, true);
  assert.strictEqual(rec.draws.length, 1);
  assert.strictEqual(rec.draws[0].prog, fx.programs.__resolve.prog);
});

test('efektler: derlenemeyen efekt her karede yeniden derlenmiyor', () => {
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const { fx, rec } = postfx({ bad: /./ });
    frame(fx);
    frame(fx);
    const n = rec.programs.length;
    frame(fx);
    frame(fx);
    assert.strictEqual(rec.programs.length, n);
    assert.strictEqual(warned, 2, 'her efekt için bir uyarı');
  } finally {
    console.warn = warn;
  }
});

test('efektler: dışa aktarımda ilk karede hepsi çiziliyor', () => {
  window.SVMilkdropSync = true;
  const { fx, rec } = postfx({ slow: true });
  frame(fx);
  assert.strictEqual(rec.draws.length, 2);
  assert.strictEqual(rec.draws[1].toScreen, true);
});

test('dört sayfa da yardımcıyı kullanan modüllerden önce yüklüyor', () => {
  for (const page of ['src/visualizer/index.html', 'src/admin/index.html', 'src/exporter/index.html', 'src/web/overlay.html']) {
    const s = read(page);
    const a = s.indexOf('shared/gl-link.js');
    assert.ok(a > 0, page);
    assert.ok(a < s.indexOf('modes/gradient.js'), page);
    assert.ok(a < s.indexOf('postfx.js'), page);
    assert.ok(a < s.indexOf('modes/shaderhost.js'), page);
  }
});
