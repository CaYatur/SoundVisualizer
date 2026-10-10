'use strict';
/* Dış gözden geçirme, dördüncü tur (10.10, 853becc üzerinde) — N1, N2 ve
   aynı açığın bölüm düzeyindeki eşleri (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const mcp = require('../src/shared/mcp.js');
const T = require('../src/shared/templates.js');

function ctx() {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  return {
    cfg,
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => 1,
    revision: () => 1,
  };
}
const call = (name, args, c) => Promise.resolve(mcp.callTool(name, args, c));
const refused = async (c, p, v) => {
  const before = JSON.stringify(c.cfg);
  const r = await call('sv_patch_config', { path: p, value: v }, c);
  assert.strictEqual(r.ok, false, p + ' = ' + JSON.stringify(v));
  assert.strictEqual(JSON.stringify(c.cfg), before, p + ' ayarı değiştirmedi');
  return r.error;
};
const accepted = async (c, p, v) => {
  const r = await call('sv_patch_config', { path: p, value: v }, c);
  assert.strictEqual(r.ok !== false, true, p + ': ' + r.error);
  return r;
};

/* N1: `layers.N.postfx` yoluyla bilinmeyen ve kimliksiz efekt yazılıyordu;
   genel `postfx` yolu da aynıydı. */
test('efekt listesi yazımı efekt araçlarının kurallarına uyar', async () => {
  const c = ctx();
  c.cfg.layerStack = { enabled: true };
  c.cfg.layers = [{ id: 'L0', name: 'K0', kind: 'visualizer', type: 'bars', enabled: true, opacity: 1, transform: { x: 0, y: 0, scale: 1, rotate: 0 }, settings: {}, postfx: [] }];
  for (const p of ['postfx', 'layers.0.postfx']) {
    assert.match(await refused(c, p, [{ type: 'zzz' }]), /Unknown effect type "zzz"/);
    await refused(c, p, ['bloom']);
    await refused(c, p, [{ type: 'bloom', params: 'x' }]);
    await refused(c, p, [{ type: 'bloom', enabled: 'evet' }]);
    await refused(c, p, { type: 'bloom' });
  }
  await refused(c, 'postfx.0', { type: 'zzz' });
  await accepted(c, 'postfx', [{ type: 'bloom' }]);
  assert.match(c.cfg.postfx[0].id, /^fx_/, 'kimlik verildi');
  assert.deepStrictEqual(c.cfg.postfx[0].params, {});
  await accepted(c, 'layers.0.postfx', [{ type: 'vignette', params: { amount: 0.3 } }]);
  assert.match(c.cfg.layers[0].postfx[0].id, /^fx_/);
  // Var olan efektin parametresi yazılabilir; kimlik korunur
  const id = c.cfg.postfx[0].id;
  await accepted(c, 'postfx.0.params.intensity', 1.2);
  assert.strictEqual(c.cfg.postfx[0].id, id);
  assert.strictEqual(c.cfg.postfx[0].params.intensity, 1.2);
});

/* Aynı açık bölüm düzeyinde: tür, renk, modülasyon ve Otomatik VJ ham yolla
   araçların denetimini atlıyordu (canlı ölçüldü, hepsi kabul ediliyordu). */
test('bölüm yazımı o bölümün aracının denetiminden geçer', async () => {
  const c = ctx();
  await refused(c, 'visualizer.type', 'zzz');
  await refused(c, 'background.type', 'zzz');
  await refused(c, 'visualizer', Object.assign({}, c.cfg.visualizer, { type: 'zzz' }));
  await refused(c, 'background.gradient.colors', ['red', 'blue']);
  await refused(c, 'background.gradient.colors', ['#ffffff']);
  await refused(c, 'background.gradient.colors.0', 'red');
  await refused(c, 'modulation.routes', [{ source: 'yok', target: 'visualizer.glow', min: 0, max: 1 }]);
  await refused(c, 'modulation.routes', [{ source: 'bass', target: 'visualizer.yokBoyle', min: 0, max: 1 }]);
  await refused(c, 'autovj.source', 'zzz');
  await refused(c, 'autovj.enabled', 'evet');
  // Geçerliler; renk biçimi düzeltilir, aralık panelin aralığına çekilir
  await accepted(c, 'visualizer.type', 'wave');
  await accepted(c, 'background.gradient.colors', ['#FFF', '#102030']);
  assert.deepStrictEqual(c.cfg.background.gradient.colors, ['#ffffff', '#102030']);
  await accepted(c, 'modulation.routes', [{ source: 'bass', target: 'visualizer.glow', min: 0, max: 1 }]);
  assert.match(c.cfg.modulation.routes[0].id, /^mod_/);
  await accepted(c, 'autovj.interval', -3);
  assert.strictEqual(c.cfg.autovj.interval, 1);
  await accepted(c, 'autovj.bpmLock', 900);
  assert.strictEqual(c.cfg.autovj.bpmLock, 200);
  // Bozuk eski bir rota, başka bir rotanın yazımını durdurmaz
  c.cfg.modulation.routes.push({ id: 'eski', enabled: true, source: 'bass', target: 'silinmis.alan', min: 0, max: 1, mode: 'set', curve: 'linear', amount: 1 });
  await accepted(c, 'modulation.routes.0.max', 0.8);
  assert.strictEqual(c.cfg.modulation.routes[0].max, 0.8);
});

/* Uygulamanın kendi yazdığı değerler yeni denetimden aynen geçer: her
   hazır şablonun efektleri, rotaları, türleri ve katmanları boş bir ayara
   yazılınca (karşılaştıracak eski değer yokken) değişmeden kabul edilir. */
test('şablonların bölümleri ve katman efektleri yeni denetimden geçer', async () => {
  const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
  let fx = 0;
  for (const t of T.TEMPLATES) {
    const applied = T.apply(SV.defaultConfig(), t, env);
    const c = ctx();
    c.cfg.postfx = [];
    const r = await call('sv_patch_config', { path: 'postfx', value: applied.postfx }, c);
    assert.strictEqual(r.ok !== false, true, t.id + ' postfx: ' + r.error);
    assert.deepStrictEqual(c.cfg.postfx, applied.postfx, t.id + ' postfx değişmedi');
    fx += applied.postfx.length;
    for (const top of ['visualizer', 'background', 'autovj']) {
      const c2 = ctx();
      const r2 = await call('sv_patch_config', { path: top, value: JSON.parse(JSON.stringify(applied[top])) }, c2);
      assert.strictEqual(r2.ok !== false, true, t.id + ' ' + top + ': ' + r2.error);
    }
    if (Array.isArray(applied.layers) && applied.layers.length) {
      const c3 = ctx();
      c3.cfg.layers = [];
      const r3 = await call('sv_patch_config', { path: 'layers', value: JSON.parse(JSON.stringify(applied.layers)) }, c3);
      assert.strictEqual(r3.ok !== false, true, t.id + ' layers: ' + r3.error);
      assert.deepStrictEqual(c3.cfg.layers, applied.layers, t.id + ' katmanlar değişmedi');
    }
  }
  assert.ok(fx > 50, 'şablon efekti ' + fx);
});

/* N2: OSC alt sınırı her yerde 1024'tü; Windows'ta 1024 altı da çalışıyor.
   Yayın sunucusu ana süreçte 1024'e çektiği için orada sınır aynı kalır. */
test('OSC port alt sınırı platforma göre', () => {
  const src = read('src/admin/control.js');
  assert.match(src, /const oscMin = window\.SV_PLATFORM && window\.SV_PLATFORM\.isWindows \? 1 : 1024;/);
  assert.match(src, /min: String\(oscMin\)/);
  assert.match(src, /P\(\)\.portValue\(e\.target, cfg\.control\.osc\.port, oscMin\)/);
  assert.match(read('src/main/osc-server.js'), /Math\.max\(1, Math\.min\(65535/);
  assert.match(read('src/main/stream-server.js'), /Math\.max\(1024, Math\.min\(65535/);
  assert.match(read('src/admin/stream.js'), /P\(\)\.portValue\(e\.target, s\.port, 1024\)/);
});
