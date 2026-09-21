'use strict';
/* SIRADAKİ PRESET ÖNCEDEN SEÇİLİYOR (#573).
 *
 * Yeni presetin shader'ları artık arka planda derleniyor ve değişim
 * programlar hazır olunca yapılıyor (tests/milkdrop-switch-async.test.js).
 * Otomatik geçişte bu, değişimin birkaç kare GEÇ gelmesi demek — ölçü
 * kipinde (#571) vuruşun üstünden kayması. Döngü bu yüzden sıradaki
 * seçimi vaktinden önce yapabiliyor (`upcoming`); motor onu önceden
 * derliyor ve vakti gelince döngü AYNI preseti veriyor.
 *
 * Buradaki asıl güvence: önceden seçmek sırayı ya da rastgele dağılımı
 * değiştirmiyor — tohumlu bir üreteçle iki yol aynı diziyi veriyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/shared/milkdrop-cycle.js');

const L4 = [
  { id: 'a', name: 'A', source: 'x' },
  { id: 'b', name: 'B', source: 'yy' },
  { id: 'c', name: 'C', source: 'zzz' },
  { id: 'd', name: 'D', source: 'wwww' },
];

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* Bir dizi geçiş: `early` verildiyse her presetin ömrünün sonuna bir
   saniye kala `upcoming` çağrılıyor, motorun yaptığı gibi. */
function sequence(md, early, seconds) {
  const cy = new C.Cycle(seeded(12345));
  const dt = 1 / 60;
  let cur = 'a';
  const picks = [];
  const peeks = [];
  for (let f = 1; f <= Math.round(seconds / dt); f++) {
    if (early && cy.remaining(md) < 1) {
      const u = cy.upcoming(md, L4, cur);
      if (u && peeks[peeks.length - 1] !== u.id) peeks.push(u.id);
    }
    const p = cy.step(dt, md, L4, cur);
    if (p) { picks.push(p.id); cur = p.id; }
  }
  return { picks, peeks };
}

test('önceden seçilen, vakti gelince AYNEN geliyor', () => {
  for (const order of ['sequential', 'random']) {
    const md = { autoNext: 3, autoOrder: order };
    const r = sequence(md, true, 40);
    assert.ok(r.picks.length >= 10, order + ': geçiş yok');
    assert.deepStrictEqual(r.peeks, r.picks, order + ': önceden seçilen ile gelen farklı');
  }
});

test('önceden seçmek sırayı ve rastgele dağılımı değiştirmiyor', () => {
  /* Rastgele pay da açık: üreteç o presetin ömrünün başında bir kez daha
     çekiliyor ve çekiliş SIRASI korunmalı. */
  for (const md of [
    { autoNext: 3, autoOrder: 'random' },
    { autoNext: 3, autoOrder: 'random', autoNextRand: 4 },
    { autoNext: 2, autoOrder: 'sequential' },
  ]) {
    const plain = sequence(md, false, 60).picks;
    const early = sequence(md, true, 60).picks;
    assert.deepStrictEqual(early, plain, JSON.stringify(md));
  }
});

test('sert geçiş de önceden seçileni kullanıyor', () => {
  /* Hazırlanmış bir preset varsa kesim onu gösteriyor: derleme zaten bitmiş
     oluyor ve kesim beklemeden geliyor. */
  const cy = new C.Cycle(seeded(7));
  const md = { autoNext: 30, autoOrder: 'random', hardCut: 'md2' };
  const u = cy.upcoming(md, L4, 'a');
  const loud = { bass: 20, mid: 20, treb: 20 };
  const p = cy.step(1 / 60, md, L4, 'a', loud);
  assert.ok(p, 'sert geçiş olmadı');
  assert.strictEqual(cy.cut, true);
  assert.strictEqual(p.id, u.id);
});

test('ekrandaki preset değişince ya da elle seçimde saklanan unutuluyor', () => {
  const cy = new C.Cycle(seeded(3));
  const md = { autoNext: 2, autoOrder: 'sequential' };
  assert.strictEqual(cy.upcoming(md, L4, 'a').id, 'b');
  // Ekrandaki preset başka yerden değişti: 'c' iken sıradaki 'b' değil
  assert.strictEqual(cy.upcoming(md, L4, 'c').id, 'd');
  cy.reset();
  assert.strictEqual(cy.next, null, 'elle seçimde (reset) unutulmadı');
});

test('listeden çıkan preset gelmiyor; kilitliyken seçim yapılmıyor', () => {
  const cy = new C.Cycle(seeded(5));
  const md = { autoNext: 1, autoOrder: 'sequential' };
  assert.strictEqual(cy.upcoming(md, L4, 'a').id, 'b');
  const without = L4.filter((x) => x.id !== 'b');
  let p = null;
  for (let i = 0; i < 120 && !p; i++) p = cy.step(1 / 60, md, without, 'a');
  assert.ok(p && p.id !== 'b', 'listeden çıkmış preset geldi');
  assert.strictEqual(new C.Cycle().upcoming({ autoNext: 2, locked: true }, L4, 'a'), null);
  assert.strictEqual(new C.Cycle().upcoming({ autoNext: 2 }, [L4[0]], 'a'), null, 'tek presette sıradaki yok');
});

// ------------------------------------------------------------------ motor

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const shaderPreset = (id, gain) => ({
  id, name: id.toUpperCase(), kind: 'milkdrop',
  source: ['[preset00]', 'fDecay=0.97', 'PSVERSION=2', 'PSVERSION_WARP=2', 'PSVERSION_COMP=2',
    'warp_1=`shader_body', 'warp_2=`{', 'warp_3=`    ret = tex2D(sampler_main, uv).xyz * ' + gain + ';', 'warp_4=`}',
    'comp_1=`shader_body', 'comp_2=`{', 'comp_3=`    ret = tex2D(sampler_main, uv).xyz;', 'comp_4=`}', ''].join('\n'),
});
const LIB = [shaderPreset('p1', '0.99'), shaderPreset('p2', '0.98'), shaderPreset('p3', '0.97')];

function engine() {
  const state = { ready: false, deleted: [] };
  let n = 0;
  const ext = { COMPLETION_STATUS_KHR: 'COMPLETION_STATUS_KHR' };
  const gl = new Proxy({}, {
    get(_, k) {
      const name = String(k);
      if (name === 'getExtension') return (e) => (e === 'KHR_parallel_shader_compile' ? ext : null);
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      if (/^create/.test(name)) return () => ({ id: name + (++n) });
      if (name === 'getProgramParameter') return (p, w) => (w === 'COMPLETION_STATUS_KHR' ? state.ready : true);
      if (name === 'getShaderParameter') return () => true;
      if (name === 'getUniformLocation') return (_p, u) => u;
      if (name === 'deleteProgram') return (p) => { if (p) state.deleted.push(p.id); };
      return () => undefined;
    },
  });
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.SVPresets = { byKind: (k) => LIB.filter((p) => p.kind === k) };
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/shared/milkdrop-hlsl.js',
    'src/shared/milkdrop-shader.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  m.gl = gl;
  m._parallel = ext;
  return { m, state, win: ctx.window };
}

const cfgOf = (extra) => ({
  milkdrop: Object.assign({ presetId: 'p1', source: LIB[0].source, blendTime: 0, autoNext: 3, autoOrder: 'sequential' }, extra || {}),
  milkdropControl: {},
  milkdropLibrary: {},
});

// Motorun karesi gibi: önce döngü, sonra preset
function tick(m, cfg, dt) {
  m._autoCycle(cfg, dt, {});
  m._ensurePreset(cfg);
}

test('motor: değişime bir saniye kala sıradaki arka planda derleniyor', () => {
  const { m } = engine();
  const cfg = cfgOf();
  m._ensurePreset(cfg);
  let t = 0;
  while (t < 1.9) { tick(m, cfg, 1 / 60); t += 1 / 60; }
  assert.strictEqual(m._pending, null, 'bir saniyeden önce başladı');
  while (t < 2.2) { tick(m, cfg, 1 / 60); t += 1 / 60; }
  assert.ok(m._pending && m._pending.early, 'sıradaki önceden derlenmiyor');
  assert.strictEqual(m._pending.id, 'p2');
  assert.strictEqual(m.livePreset().next, 'p2', 'izleyenlere söylenmiyor');
  // Ekrandaki preset değişmedi ve önceden derleme her karede atılmıyor
  const job = m._pending.job;
  tick(m, cfg, 1 / 60);
  assert.strictEqual(m._pending.job, job, 'önceden derlenen iş atıldı');
});

test('motor: vakti gelince önceden derlenen HEMEN geliyor, yeniden derlenmeden', () => {
  const { m, state } = engine();
  const cfg = cfgOf();
  m._ensurePreset(cfg);
  let t = 0;
  while (t < 2.5) { tick(m, cfg, 1 / 60); t += 1 / 60; }
  const job = m._pending.job;
  const progs = [job.warp.h.p.id, job.comp.h.p.id];
  state.ready = true;                    // derleme değişimden önce bitti
  let swappedAt = null;
  while (t < 3.2 && swappedAt === null) {
    tick(m, cfg, 1 / 60); t += 1 / 60;
    if (m.autoPick && m.presetKey.startsWith('p2|')) swappedAt = t;
  }
  assert.ok(swappedAt !== null, 'değişim olmadı');
  assert.ok(swappedAt < 3 + 2 / 60, 'değişim vaktinde değil: ' + swappedAt.toFixed(3));
  assert.strictEqual(m.warpPreset.prog.id, progs[0], 'önceden derlenen program kullanılmadı');
  assert.strictEqual(m.compPreset.prog.id, progs[1]);
  for (const id of progs) assert.ok(!state.deleted.includes(id), id + ' silindi');
});

test('motor: yalnız sert geçiş açıkken sıradaki hep hazır ve derleme dönüp durmuyor', () => {
  /* Kalan süre sıfır sayılıyor, yani önceden derleme her kare çağrılıyor.
     Aynı sıradaki için iş yeniden başlatılmamalı. */
  const { m } = engine();
  const cfg = cfgOf({ autoNext: 0, hardCut: 'md2' });
  m._ensurePreset(cfg);
  tick(m, cfg, 1 / 60);
  const job = m._pending && m._pending.job;
  assert.ok(job, 'sert geçiş için sıradaki hazırlanmıyor');
  for (let i = 0; i < 30; i++) tick(m, cfg, 1 / 60);
  assert.strictEqual(m._pending.job, job, 'iş her karede yeniden başladı');
});

test('izleyen, liderin sıradakini önceden derliyor', () => {
  const { m, win } = engine();
  const cfg = cfgOf({ autoNext: 0 });
  m._ensurePreset(cfg);
  win.SVMdFollow = { at: performance.now(), base: m._manualKey, id: null, next: 'p3' };
  m._autoCycle(cfg, 1 / 60, {});
  assert.ok(m._pending && m._pending.early && m._pending.id === 'p3', 'izleyen hazırlamıyor');
  const main = bare(read('src/main/main.js'));
  assert.match(main, /next: typeof mp\.next === 'string' \? mp\.next : null/);
  assert.match(main, /follow\.seed, follow\.next\]\.join\('\|'\)/, 'değişen sıradaki yeniden dağıtılmalı');
});
