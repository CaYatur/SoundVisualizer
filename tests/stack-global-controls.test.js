'use strict';
/* GENEL KONTROLLER KATMAN YIĞININDA.

   Yığın açıkken ekranı katmanların kendi ayarları çiziyor; yığın ilk
   açıldığında sentezlenen katmanlar klasik bölümün tam kopyasını taşıyor.
   MIDI/OSC eylemleri ve kaydırıcıları, telefon kumandası, modülasyon, zaman
   çizelgesi, MCP'nin arkaplan aracı ve Studio yalnız genel alana yazıyordu:
   yığında ekranda hiçbir şey değişmiyordu. Yalıtılmış kopyada ölçüldü
   (klasik kipte bar 160→30, yığında 160 kaldı). Testler davranıştan:
   her biri düzeltme geri alınınca kırılıyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('../src/shared/defaults.js');
require('../src/shared/mode-catalog.js');
const L = require('../src/visualizer/layers.js');
const MOD = require('../src/shared/modulation.js');
const TL = require('../src/shared/timeline.js');
window.SVLayers = L;
window.SVModulation = MOD;

const SV = window.SV;
const ROOT = path.join(__dirname, '..');

// Klasik varsayılan sahne, sonra yığın panelin anahtarıyla açılmış hali
function stackScene() {
  const cfg = SV.defaultConfig();
  cfg.lighting.enabled = false;
  L.setStackEnabled(cfg, true);
  return cfg;
}
const visIndex = (cfg) => cfg.layers.findIndex((l) => l.kind === 'visualizer' && l.type !== 'text');
const bgIndex = (cfg) => cfg.layers.findIndex((l) => l.kind === 'background');
const drawn = (cfg, kind) => {
  const l = L.resolve(cfg).find((x) => x.kind === kind && x.type !== 'text' && x.type !== 'nowplaying');
  return l ? L.layerConfig(cfg, l) : null;
};

// --- yol yönlendirmesi --------------------------------------------------------

test('effectivePath: yığında genel yol ilk canlı katmanın kopyasına gider', () => {
  const cfg = stackScene();
  const vi = visIndex(cfg);
  const bi = bgIndex(cfg);
  assert.ok(vi >= 0 && bi >= 0, 'sentez arkaplan ve görselleştirici katmanı kurdu');
  assert.strictEqual(L.effectivePath(cfg, 'visualizer.barCount'), 'layers.' + vi + '.settings.visualizer.barCount');
  assert.strictEqual(L.effectivePath(cfg, 'background.gradient.speed'), 'layers.' + bi + '.settings.background.gradient.speed');
  // tür adopt* ile değişir; bölüm dışı yollar ve katman yolları olduğu gibi
  assert.strictEqual(L.effectivePath(cfg, 'visualizer.type'), 'visualizer.type');
  assert.strictEqual(L.effectivePath(cfg, 'audio.sensitivity'), 'audio.sensitivity');
  assert.strictEqual(L.effectivePath(cfg, 'layers.0.opacity'), 'layers.0.opacity');
});

test('effectivePath: yığın kapalıyken ya da katman değeri taşımıyorken yol aynen', () => {
  const classic = SV.defaultConfig();
  assert.strictEqual(L.effectivePath(classic, 'visualizer.barCount'), 'visualizer.barCount');
  const cfg = stackScene();
  delete cfg.layers[visIndex(cfg)].settings.visualizer.barCount;
  assert.strictEqual(L.effectivePath(cfg, 'visualizer.barCount'), 'visualizer.barCount', 'genel değer zaten akıyor');
});

test('effectivePath: metin katmanı ve kapalı katman atlanır, ilk CANLI görselleştirici seçilir', () => {
  const cfg = stackScene();
  const vi = visIndex(cfg);
  const second = JSON.parse(JSON.stringify(cfg.layers[vi]));
  second.id = 'ly_vis2';
  cfg.layers.splice(vi + 1, 0, second);
  cfg.layers.unshift(L.makeTextLayer ? L.makeTextLayer({ name: 'Metin', content: 'x' }) : { kind: 'visualizer', type: 'text', settings: { text: {} } });
  const at = visIndex(cfg);
  cfg.layers[at].enabled = false;
  assert.strictEqual(L.effectivePath(cfg, 'visualizer.barCount'), 'layers.' + (at + 1) + '.settings.visualizer.barCount');
});

test('currentType: yığında ekrandaki katmanın türü, klasik alan değil', () => {
  const cfg = stackScene();
  assert.strictEqual(cfg.visualizer.type, 'none', 'klasik alan yığında bilerek boş');
  assert.strictEqual(L.currentType(cfg, 'visualizer'), 'bars');
  assert.strictEqual(L.currentType(cfg, 'background'), cfg.layers[bgIndex(cfg)].type);
  assert.strictEqual(L.currentType(SV.defaultConfig(), 'visualizer'), 'bars');
});

// --- arkaplan türü -------------------------------------------------------------

test('adoptBackground: yığında ilk arkaplan katmanı, kapalıyken yalnız klasik alan', () => {
  const cfg = stackScene();
  L.adoptBackground(cfg, { type: 'ink' });
  assert.strictEqual(drawn(cfg, 'background').background.type, 'ink');
  const classic = SV.defaultConfig();
  classic.layers = JSON.parse(JSON.stringify(cfg.layers));
  classic.layerStack = { enabled: false };
  const before = JSON.stringify(classic.layers);
  L.adoptBackground(classic, { type: 'aurora' });
  assert.strictEqual(classic.background.type, 'aurora');
  assert.strictEqual(JSON.stringify(classic.layers), before, 'kapalı yığının listesi değişmez');
  assert.strictEqual(L.stackOn(classic), false, 'yığın açılmaz');
});

test('adoptBackground: arkaplan katmanı yoksa en alta eklenir', () => {
  const cfg = stackScene();
  cfg.layers = cfg.layers.filter((l) => l.kind !== 'background');
  L.adoptBackground(cfg, { type: 'custom', presetId: 'bg_1' });
  assert.strictEqual(cfg.layers[0].kind, 'background');
  assert.strictEqual(cfg.layers[0].type, 'custom');
  assert.strictEqual(cfg.layers[0].presetId, 'bg_1');
});

// --- yığın aç/kapa gidiş-dönüşü ---------------------------------------------------

test('görselleştiricisiz sahne yığın açılıp kapanınca görselleştiricisiz kalır', () => {
  const cfg = SV.defaultConfig();
  cfg.visualizer.type = 'none';
  const before = L.resolve(cfg).map((l) => l.kind + ':' + l.type);
  L.setStackEnabled(cfg, true);
  L.setStackEnabled(cfg, false);
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.kind + ':' + l.type), before);
  assert.strictEqual(cfg.visualizer.type, 'none');
});

test('açık yığını yeniden açmak klasik yedeği silmez', () => {
  const cfg = SV.defaultConfig();
  cfg.visualizer.type = 'blocks';
  L.setStackEnabled(cfg, true);
  L.setStackEnabled(cfg, true);
  L.setStackEnabled(cfg, false);
  assert.strictEqual(cfg.visualizer.type, 'blocks');
});

// --- modülasyon ve zaman çizelgesi ---------------------------------------------

test('modülasyon yığında katmanın değerini sürer, kayıtlı ayara dokunmaz', () => {
  const cfg = stackScene();
  cfg.modulation = { enabled: true, routes: [{ id: 'r1', source: 'macro1', target: 'visualizer.barCount', mode: 'set', min: 20, max: 20, amount: 1 }] };
  const m = new MOD.Modulator();
  const out = m.apply(cfg, 1 / 60);
  assert.strictEqual(drawn(out, 'visualizer').visualizer.barCount, 20, 'ekrana giden değer');
  assert.notStrictEqual(drawn(cfg, 'visualizer').visualizer.barCount, 20, 'kayıtlı ayar aynı');
});

test('modülasyon add kipi katmanın kendi değerinden hesaplar', () => {
  const cfg = stackScene();
  const vi = visIndex(cfg);
  cfg.layers[vi].settings.visualizer.barCount = 40;
  cfg.visualizer.barCount = 160;
  cfg.modulation = { enabled: true, routes: [{ id: 'r1', source: 'macro1', target: 'visualizer.barCount', mode: 'add', min: 0, max: 10, amount: 1, clamp: false }] };
  const m = new MOD.Modulator();
  m.values.macro1 = 1;
  const out = m.apply(cfg, 1 / 60);
  const v = drawn(out, 'visualizer').visualizer.barCount;
  assert.strictEqual(v, 50, 'katmanın 40\'ı + 10 (genel 160 değil, katmanın kopyası da değil)');
});

test('zaman çizelgesi otomasyonu yığında katmanın değerini sürer', () => {
  const cfg = stackScene();
  const tl = { tracks: [{ id: 't1', kind: 'automation', target: 'background.gradient.speed', min: 0, max: 2, keys: [{ t: 0, v: 0.85 }, { t: 10, v: 0.85 }] }] };
  const auto = TL.applyAutomation(cfg, tl, 5);
  if (!auto.applied) {
    // Parça biçimi değiştiyse test sessizce geçmesin
    assert.fail('otomasyon uygulanmadı: ' + JSON.stringify(auto.missing));
  }
  assert.ok(Math.abs(drawn(auto.cfg, 'background').background.gradient.speed - 1.7) < 1e-9);
});

// --- MIDI/OSC eylemleri ve Klip Destesi -------------------------------------------

function freshControl(cfg, panel) {
  const key = require.resolve('../src/admin/control.js');
  delete require.cache[key];
  window.SVPanel = Object.assign({
    cfg: () => cfg, push() {}, rerender() {}, apply() {},
    set: (p, v) => { const k = p.split('.'); let o = cfg; for (let i = 0; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = v; },
    get: () => undefined,
  }, panel || {});
  require('../src/admin/control.js');
  return window.SVControl;
}

test('Sonraki/Önceki Görselleştirici yığında ekrandaki katmanı değiştirir', () => {
  const cfg = stackScene();
  const C = freshControl(cfg);
  const ids = window.SVModeCatalog.cycleIds('visualizer');
  const at = ids.indexOf('bars');
  C.runAction('nextVisualizer', cfg);
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.type, ids[(at + 1) % ids.length], 'barsın SONRAKİSİ');
  C.runAction('prevVisualizer', cfg);
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.type, 'bars');
});

test('Sonraki Arkaplan yığında ekrandaki katmanı değiştirir', () => {
  const cfg = stackScene();
  const C = freshControl(cfg);
  const ids = window.SVModeCatalog.cycleIds('background');
  const cur = drawn(cfg, 'background').background.type;
  C.runAction('nextBackground', cfg);
  assert.strictEqual(drawn(cfg, 'background').background.type, ids[(ids.indexOf(cur) + 1) % ids.length]);
});

test('klasik kipte eylemler eskisi gibi klasik alanı değiştirir', () => {
  const cfg = SV.defaultConfig();
  const C = freshControl(cfg);
  C.runAction('nextVisualizer', cfg);
  assert.notStrictEqual(cfg.visualizer.type, 'bars');
  assert.strictEqual(L.stackOn(cfg), false);
});

test('OSC kaydırıcısı yığında ekrandaki katmanın değerini değiştirir', async () => {
  const cfg = stackScene();
  cfg.control.osc.enabled = true;
  cfg.control.osc.mappings = [{ id: 'm1', source: 'osc', address: '/bar', target: 'visualizer.barCount' }];
  let onOsc = null;
  global.document = global.document || { getElementById: () => null, querySelectorAll: () => [] };
  window.api = { onOscMessage: (cb) => { onOsc = cb; }, onOscStatus() {}, oscStatus: () => Promise.resolve({}) };
  const C = freshControl(cfg);
  await C.init();
  assert.ok(onOsc, 'OSC dinleyicisi kuruldu');
  onOsc({ address: '/bar', args: [0] });
  const t = C.allTargets().find((x) => x.path === 'visualizer.barCount');
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.barCount, t.min, 'ekrana giden değer');
  assert.strictEqual(cfg.visualizer.barCount, t.min, 'genel alan da (değer göstergesi onu okuyor)');
});

test('Sonraki Sahne panelin sahne uygulamasını kullanır', () => {
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'a', data: {} }, { id: 'b', data: {} }];
  const applied = [];
  const C = freshControl(cfg, { applyScene: (id) => applied.push(id) });
  assert.strictEqual(C.runAction('nextScene', cfg), true, 'çağıran yeniden göndermesin');
  assert.strictEqual(applied.length, 1);
});

test('Sonraki Sahne (panel yokken) Şeffaf Arkaplanı korur', () => {
  const cfg = SV.defaultConfig();
  cfg.background.transparent = true;
  const sceneBg = Object.assign(JSON.parse(JSON.stringify(cfg.background)), { type: 'aurora', transparent: false });
  cfg.scenes = [{ id: 'a', data: { background: sceneBg } }, { id: 'b', data: { background: sceneBg } }];
  const C = freshControl(cfg, { applyScene: undefined });
  C.runAction('nextScene', cfg);
  assert.strictEqual(cfg.background.type, 'aurora');
  assert.strictEqual(cfg.background.transparent, true);
});

// --- telefon kumandası (ana süreç) ----------------------------------------------

function remoteSetter() {
  const M = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  const a = M.indexOf('let layersHelpers;');
  const b = M.indexOf('function setConfigPath(obj, p, value) {');
  const c = M.indexOf('\n}', b) + 2;
  assert.ok(a > 0 && b > a, 'setRemotePath bulunamadı');
  const ctx = { require: (p) => require(path.join(ROOT, 'src/main', p)) };
  vm.createContext(ctx);
  vm.runInContext(M.slice(a, c) + '\nthis.f = setRemotePath;', ctx);
  return ctx.f;
}

test('kumanda yığında mod ve arkaplan düğmesiyle ekrandaki katmanı değiştirir', () => {
  const set = remoteSetter();
  const cfg = stackScene();
  set(cfg, 'visualizer.type', 'blocks');
  set(cfg, 'background.type', 'ink');
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.type, 'blocks');
  assert.strictEqual(drawn(cfg, 'background').background.type, 'ink');
});

test('kumanda kaydırıcısı yığında katmanın değerine de yazar, klasikte yalnız genel alana', () => {
  const set = remoteSetter();
  const cfg = stackScene();
  set(cfg, 'visualizer.barCount', 30);
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.barCount, 30);
  const classic = SV.defaultConfig();
  set(classic, 'visualizer.type', 'blocks');
  assert.strictEqual(classic.visualizer.type, 'blocks');
  assert.strictEqual(L.stackOn(classic), false);
});

test('kumanda sayfası katman yardımcısını yükler ve ekrandaki türü işaretler', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/web/remote.html'), 'utf8');
  assert.ok(html.indexOf('/app/visualizer/layers.js') > 0 && html.indexOf('/app/visualizer/layers.js') < html.indexOf('/app/web/remote.js'));
  const js = fs.readFileSync(path.join(ROOT, 'src/web/remote.js'), 'utf8');
  assert.match(js, /markActive\(\$\('visModes'\), shownType\(c, 'visualizer'\)\)/);
  assert.match(js, /markActive\(\$\('bgModes'\), shownType\(c, 'background'\)\)/);
});

// --- MCP --------------------------------------------------------------------------

test('MCP arkaplan türü yığında ekrandaki katmanı değiştirir', async () => {
  const Module = require('module');
  const os = require('os');
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
    return orig.apply(this, arguments);
  };
  try {
    const mcp = require('../src/shared/mcp');
    const cfg = stackScene();
    cfg.mcp = { enabled: true, mode: 'write' };
    const ctx = {
      locale: () => 'en',
      getConfig: () => cfg,
      setConfig: (next) => { Object.keys(cfg).forEach((k) => delete cfg[k]); Object.assign(cfg, next); },
    };
    const r = await mcp.callTool('sv_set_background_type', { type: 'ink' }, ctx);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(drawn(cfg, 'background').background.type, 'ink');
  } finally {
    Module._load = orig;
  }
});

// --- ikinci tur: gözden geçirmede bulunanlar -------------------------------------

test('yığın açık ve liste boşken "Katmanlara Geç" listeyi yine sentezler', () => {
  const cfg = SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = [];
  L.setStackEnabled(cfg, true);
  assert.ok(cfg.layers.length > 0, 'düğme işlevsiz kalmamalı');
});

test('setEffective yığında katmanın kopyasına yazar, klasikte dokunmaz', () => {
  const cfg = stackScene();
  cfg.visualizer.color = '#123456';
  assert.strictEqual(L.setEffective(cfg, 'visualizer.color', '#123456'), true);
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.color, '#123456');
  const classic = SV.defaultConfig();
  assert.strictEqual(L.setEffective(classic, 'visualizer.color', '#123456'), false);
});

test('Auto VJ paleti yığında görselleştirici katmanının rengini de değiştirir', () => {
  require('../src/shared/autovj.js');
  const cfg = stackScene();
  cfg.autovj = { enabled: true, source: 'palettes' };
  const key = require.resolve('../src/admin/autovj.js');
  delete require.cache[key];
  window.SVPanel = { cfg: () => cfg, push() {}, rerender() {}, apply() {} };
  require('../src/admin/autovj.js');
  const r = window.SVAutoVJ.applySwitch();
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.kind, 'palettes');
  assert.strictEqual(drawn(cfg, 'visualizer').visualizer.color, cfg.visualizer.color);
});

test('dinamik tema görselleştirici rengini katmana da yazar', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/admin/admin.js'), 'utf8');
  const a = src.indexOf('function applyResolvedTheme(res, isManual)');
  const body = src.slice(a, src.indexOf('res.nextCycleIdx', a));
  assert.match(body, /setEffective\(cfg, 'visualizer\.color', cfg\.visualizer\.color\)/);
  assert.match(body, /setEffective\(cfg, 'visualizer\.color2', cfg\.visualizer\.color2\)/);
});

// --- Studio -------------------------------------------------------------------------

function freshStudio(cfg) {
  const key = require.resolve('../src/admin/studio.js');
  delete require.cache[key];
  window.SVPanel = { cfg: () => cfg, push() {}, rerender() {}, toast() {} };
  require('../src/admin/studio.js');
  return window.SVStudio;
}

test('Studio "Şu Anki Görünüm" yığında ekrandaki katmanı yakalar, "none" değil', () => {
  const cfg = stackScene();
  cfg.layers[visIndex(cfg)].type = 'blocks';
  cfg.layers[visIndex(cfg)].settings.visualizer.barCount = 42;
  const S = freshStudio(cfg);
  const look = S.currentLook(cfg, 'visualizer');
  assert.strictEqual(look.visualizer.type, 'blocks');
  assert.strictEqual(look.visualizer.barCount, 42);
  assert.strictEqual(S.currentLook(SV.defaultConfig(), 'visualizer').visualizer.type, 'bars', 'klasikte genel alan');
});

test('Studio arkaplan preseti ve varyasyonu yığında ekrandaki katmana uygulanır', () => {
  const cfg = stackScene();
  const S = freshStudio(cfg);
  S.applyPresetToCfg(cfg, { id: 'bg_x', kind: 'background', engine: 'shader' });
  assert.strictEqual(drawn(cfg, 'background').background.type, 'custom');
  assert.strictEqual(drawn(cfg, 'background').custom.backgroundId, 'bg_x');
  const bg = Object.assign(JSON.parse(JSON.stringify(cfg.background)), { type: 'aurora' });
  bg.gradient.speed = 1.3;
  S.applyPresetToCfg(cfg, { id: 'v1', kind: 'background', engine: 'variation', base: 'aurora', overrides: { background: bg } });
  assert.strictEqual(drawn(cfg, 'background').background.type, 'aurora');
  assert.strictEqual(drawn(cfg, 'background').background.gradient.speed, 1.3);
});
