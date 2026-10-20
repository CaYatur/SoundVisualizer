'use strict';
/* MilkDrop'un sabit programları arka planda derleniyor (#777).

   Katman kurulurken yedi sabit programın durumu hemen soruluyordu ve ilk
   eşzamanlı soru bağlamın GPU sürecinde hazır olmasını da bekliyordu.
   Ölçüldü (1920x1080, MilkDrop'a geçiş): uzun kare ılıkta 53-67 ms,
   soğukta 133 ms. Artık `KHR_parallel_shader_compile` varken derleme
   başlatılıyor ve hazır olana kadar `_initGL` 'pending' dönüyor; çevrimdışı
   işler (`SVMilkdropSync`: dışa aktarım, küçük resimler) eskisi gibi
   bekliyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js');
const CODE = fs.readFileSync(FILE, 'utf-8');

function fakeGl(state) {
  const calls = [];
  const gl = new Proxy({}, {
    get(_, k) {
      const name = String(k);
      if (name === 'isContextLost') return () => false;
      if (name === 'getExtension') {
        return (ext) => {
          if (ext === 'KHR_parallel_shader_compile') return state.parallel ? { COMPLETION_STATUS_KHR: 'COMPLETION_STATUS_KHR' } : null;
          if (ext === 'WEBGL_lose_context') return { loseContext() {} };
          return null;
        };
      }
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      if (/^create/.test(name)) return () => ({ gl: name });
      if (name === 'getProgramParameter') {
        return (_p, pname) => {
          calls.push('getProgramParameter:' + pname);
          return pname === 'COMPLETION_STATUS_KHR' ? state.ready : true;
        };
      }
      if (name === 'getShaderParameter') return (_s, pname) => { calls.push('getShaderParameter:' + pname); return true; };
      if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
      if (name === 'getError') return () => 'NO_ERROR';
      if (name === 'getParameter') return () => 16;
      if (name === 'getUniformLocation') return (_p, u) => u;
      return (...args) => args[0];
    },
  });
  return { gl, calls };
}

function load(state, sync) {
  let fake = null;
  const canvas = () => ({
    width: 320, height: 240,
    getContext(kind) {
      if (kind === '2d') return new Proxy({}, { get: () => () => undefined });
      if (!fake) fake = fakeGl(state);
      return fake.gl;
    },
    addEventListener() {},
  });
  const ctx = { window: {}, document: { createElement: canvas }, performance: { now: () => 1000 }, console };
  ctx.window.document = ctx.document;
  ctx.window.performance = ctx.performance;
  if (sync) ctx.window.SVMilkdropSync = true;
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: FILE });
  const m = new ctx.window.SVModes.milkdrop(canvas());
  return { m, calls: () => (fake ? fake.calls : []) };
}

test('uzantı varken derleme beklenmiyor: hazır olana kadar pending, sonuç sorulmuyor', () => {
  const state = { parallel: true, ready: false };
  const { m, calls } = load(state);
  assert.strictEqual(m._initGL(64, 64), 'pending');
  assert.ok(!m.warpFixed, 'program henüz atanmamalı');
  assert.ok(!calls().some((c) => /LINK_STATUS|COMPILE_STATUS/.test(c)), 'bağlama sonucu eşzamanlı soruldu');
  // İkinci kare: hâlâ derleniyor, işler yeniden başlatılmıyor
  const jobs = m._staticJobs;
  assert.strictEqual(m._initGL(64, 64), 'pending');
  assert.strictEqual(m._staticJobs, jobs, 'derleme her karede yeniden başlatıldı');
  // Hazır: kurulum tamamlanıyor
  state.ready = true;
  assert.strictEqual(m._initGL(64, 64), true);
  assert.ok(m.warpFixed && m.compFixed && m.blurProg && m.lineProg && m.aaProg && m.shapeTexProg && m.flashProg);
  assert.strictEqual(m._staticJobs, null);
  assert.ok(calls().some((c) => c === 'getProgramParameter:LINK_STATUS'), 'sonuç hazır olunca alınıyor');
});

test('çevrimdışı işte (dışa aktarım, küçük resim) ilk karede bekleniyor', () => {
  const { m } = load({ parallel: true, ready: false }, true);
  assert.strictEqual(m._initGL(64, 64), true);
  assert.ok(m.warpFixed);
});

test('uzantı yoksa eskisi gibi ilk karede kuruluyor', () => {
  const { m } = load({ parallel: false, ready: false });
  assert.strictEqual(m._initGL(64, 64), true);
  assert.ok(m.warpFixed);
});

test('bağlam kaybı yarım kalan sabit derlemeyi unutturuyor; çizim pending iken çıkıyor', () => {
  const { m } = load({ parallel: true, ready: false });
  assert.strictEqual(m._initGL(64, 64), 'pending');
  assert.ok(m._staticJobs);
  m._forgetGL();
  assert.strictEqual(m._staticJobs, null, 'ölü bağlamın derleme işi kaldı');
  assert.match(CODE, /const init = this\._initGL\(GW, GH\);\s*\n\s*\/\/[^\n]*\n\s*if \(init === 'pending'\) return;/);
});
