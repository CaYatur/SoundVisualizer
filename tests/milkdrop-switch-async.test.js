'use strict';
/* PRESET DEĞİŞİMİ ÇİZİMİ BEKLETMİYOR (#573).
 *
 * Ölçüldü (scripts/milkdrop-switch-cost.js, 900 preset, 1280x720): preset
 * değişim karesi komşu kareden medyanda 17 ms, en kötü ~119 ms uzundu ve
 * değişimlerin %60'ı yalnız bu yüzden bir kare düşürüyordu. Karenin 14-15
 * ms'si GL derleme ve bağlamaydı: motor derlemenin sonucunu hemen sorduğu
 * için çizim iş parçacığı derleme bitene kadar bekliyordu.
 *
 * Artık `KHR_parallel_shader_compile` varken derleme arka planda sürüyor,
 * ekrandaki preset çizilmeye devam ediyor ve değişim ancak yeni presetin
 * programları hazır olunca yapılıyor. Bu testler motoru sahte bir GL ile
 * kuruyor; "hazır" durumu testin elinde.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* Warp ve comp shader'ı olan küçük presetler: değişim gerçekten derleme
   gerektirsin. */
/* MILKDROP_PRESET_VERSION şart: yoksa MilkDrop dosyayı MilkDrop 1 sayıyor
   ve shader'larını okumuyor; uyum açıkken motor da (#580). */
const shaderPreset = (decay, gain) => [
  'MILKDROP_PRESET_VERSION=201',
  '[preset00]',
  'fDecay=' + decay,
  'PSVERSION=2', 'PSVERSION_WARP=2', 'PSVERSION_COMP=2',
  'warp_1=`shader_body', 'warp_2=`{',
  'warp_3=`    ret = tex2D(sampler_main, uv).xyz * ' + gain + ';', 'warp_4=`}',
  'comp_1=`shader_body', 'comp_2=`{',
  'comp_3=`    ret = tex2D(sampler_main, uv).xyz;', 'comp_4=`}',
  '',
].join('\n');
const A = { id: 'a', source: shaderPreset('0.98', '0.99') };
const B = { id: 'b', source: shaderPreset('0.95', '0.97') };
const C = { id: 'c', source: shaderPreset('0.90', '0.93') };

function fakeGl(opts) {
  const state = { ready: false, deleted: [], links: 0 };
  let n = 0;
  const ext = { COMPLETION_STATUS_KHR: 'COMPLETION_STATUS_KHR' };
  const gl = new Proxy({}, {
    get(_, k) {
      const name = String(k);
      if (name === 'getExtension') {
        return (e) => (e === 'KHR_parallel_shader_compile' && opts.parallel ? ext : null);
      }
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      if (/^create/.test(name)) return () => ({ id: name + (++n) });
      if (name === 'linkProgram') return () => { state.links++; };
      if (name === 'getProgramParameter') {
        return (p, what) => (what === 'COMPLETION_STATUS_KHR' ? state.ready : true);
      }
      if (name === 'getShaderParameter') return () => true;
      if (name === 'getUniformLocation') return (_p, u) => u;
      if (name === 'deleteProgram') return (p) => { if (p) state.deleted.push(p.id); };
      return () => undefined;
    },
  });
  return { gl, ext, state };
}

function engine(opts) {
  const o = Object.assign({ parallel: true, sync: false }, opts || {});
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  if (o.sync) ctx.window.SVMilkdropSync = true;
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-hlsl.js',
    'src/shared/milkdrop-shader.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  const f = fakeGl(o);
  m.gl = f.gl;
  m._parallel = f.gl.getExtension('KHR_parallel_shader_compile');
  return { m, f, win: ctx.window };
}

const cfgFor = (p, blend) => ({
  milkdrop: { presetId: p.id, source: p.source, blendTime: blend == null ? 1.7 : blend, autoNext: 0 },
  milkdropControl: {},
  milkdropLibrary: {},
});

test('ilk yükleme BEKLEYEREK: gösterilecek başka bir preset yok', () => {
  const { m } = engine();
  m._ensurePreset(cfgFor(A));
  assert.ok(m.preset, 'ilk preset kurulmadı');
  assert.strictEqual(m._pending == null, true, 'ilk yükleme arka plana atılmamalı');
  assert.ok(m.warpPreset && m.compPreset, 'shader\'lar derlenmedi: ' + m.shaderNote);
});

test('değişim istenince eski preset sürüyor, derleme arka planda', () => {
  const { m, f } = engine();
  m._ensurePreset(cfgFor(A));
  const first = m.preset, firstWarp = m.warpPreset;
  const links = f.state.links;
  m._ensurePreset(cfgFor(B));
  assert.strictEqual(m.preset, first, 'preset derleme bitmeden değişti');
  assert.strictEqual(m.warpPreset, firstWarp, 'ekrandaki shader bırakıldı');
  assert.ok(m._pending && m._pending.key.startsWith('b|'), 'arka planda iş başlamadı');
  assert.strictEqual(f.state.links, links + 2, 'iki aşamanın bağlaması başlatılmalı');
  // Hazır değilken kare kare sürüyor
  m._ensurePreset(cfgFor(B));
  m._ensurePreset(cfgFor(B));
  assert.strictEqual(m.preset, first);
  assert.strictEqual(m.oldPreset, null, 'geçiş yarım derlenmiş presetle başlamamalı');
});

test('programlar hazır olunca değişim ve geçiş BİRLİKTE başlıyor', () => {
  const { m, f } = engine();
  m._ensurePreset(cfgFor(A));
  const first = m.preset;
  m._ensurePreset(cfgFor(B));
  f.state.ready = true;
  m._ensurePreset(cfgFor(B));
  assert.notStrictEqual(m.preset, first, 'hazır olduğu hâlde değişmedi');
  assert.strictEqual(m._pending, null);
  assert.ok(m.presetKey.startsWith('b|'));
  assert.strictEqual(m.oldPreset, first, 'geçiş eski presetten başlamalı');
  assert.ok(m.warpPreset && m.compPreset, 'yeni shader\'lar yerleşmedi');
});

test('derlenirken seçim değişirse yarım iş siliniyor', () => {
  const { m, f } = engine();
  m._ensurePreset(cfgFor(A));
  m._ensurePreset(cfgFor(B));
  const bProgs = [m._pending.job.warp.h.p.id, m._pending.job.comp.h.p.id];
  m._ensurePreset(cfgFor(C));
  for (const id of bProgs) assert.ok(f.state.deleted.includes(id), id + ' silinmedi');
  assert.ok(m._pending.key.startsWith('c|'), 'yeni seçimin derlemesi başlamadı');
});

test('derlenirken seçim geri alınırsa yarım iş siliniyor, ekran değişmiyor', () => {
  const { m, f } = engine();
  m._ensurePreset(cfgFor(A));
  const first = m.preset;
  m._ensurePreset(cfgFor(B));
  const bWarp = m._pending.job.warp.h.p.id;
  m._ensurePreset(cfgFor(A));
  assert.strictEqual(m._pending, null);
  assert.strictEqual(m.preset, first);
  assert.ok(f.state.deleted.includes(bWarp));
});

test('çevrimdışı işte (dışa aktarım) değişim hemen, bekleyerek', () => {
  /* Bir presetin hangi karede göründüğü derlemenin hızına kalırsa aynı
     iş iki kez farklı video verirdi. */
  const { m } = engine({ sync: true });
  m._ensurePreset(cfgFor(A));
  const first = m.preset;
  m._ensurePreset(cfgFor(B));
  assert.notStrictEqual(m.preset, first);
  assert.strictEqual(m._pending == null, true);
  assert.match(read('src/exporter/exporter.js'), /window\.SVMilkdropSync = true;/);
  assert.match(read('scripts/milkdrop-render-rate.js'), /window\.SVMilkdropSync = true;/,
    'render oranı ölçümü önceki koşularla karşılaştırılabilir kalmalı');
});

test('uzantı yoksa eski davranış: değişim hemen', () => {
  const { m } = engine({ parallel: false });
  m._ensurePreset(cfgFor(A));
  const first = m.preset;
  m._ensurePreset(cfgFor(B));
  assert.notStrictEqual(m.preset, first);
  assert.strictEqual(m._pending == null, true);
});

test('bağlam kaybı arka plandaki işi ve uzantıyı unutturuyor', () => {
  /* İkisi de ölü bağlamdaydı; uzantı yeni bağlamda yeniden istenmeli. */
  const { m } = engine();
  m._ensurePreset(cfgFor(A));
  m._ensurePreset(cfgFor(B));
  assert.ok(m._pending);
  m._forgetGL();
  assert.strictEqual(m._pending, null);
  assert.strictEqual(m._parallel, null);
  assert.match(bare(read('src/visualizer/modes/milkdrop.js')),
    /this\._parallel = gl\.getExtension\('KHR_parallel_shader_compile'\) \|\| null;/);
});

test('atılan örnek arka plandaki işin programlarını siliyor', () => {
  const { m, f } = engine();
  m._ensurePreset(cfgFor(A));
  m._ensurePreset(cfgFor(B));
  const ids = [m._pending.job.warp.h.p.id, m._pending.job.comp.h.p.id];
  m.dispose();
  for (const id of ids) assert.ok(f.state.deleted.includes(id), id + ' silinmedi');
});

test('hazır mı sorusu beklemiyor; sonuç ancak hazır olunca alınıyor', () => {
  const MODE = bare(read('src/visualizer/modes/milkdrop.js'));
  assert.match(MODE, /this\.gl\.getProgramParameter\(h\.p, ext\.COMPLETION_STATUS_KHR\) === true/);
  const fn = /_ensurePreset\(cfg\) \{[\s\S]*?\n    \}/.exec(MODE)[0];
  const ready = fn.indexOf('if (!this._stagesReady(P.job)) return;');
  const swap = fn.indexOf('this._dropOld();');
  assert.ok(ready > 0 && swap > ready, 'değişim hazır olmadan başlamamalı');
  assert.match(fn, /this\._buildPresetShaders\(src, job\);/);
});
