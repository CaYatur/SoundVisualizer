'use strict';
/* MCP kapsamı (#695).

   MCP'nin araçları uygulamanın özellik listelerini elle tekrarlıyordu. Yeni
   bir mod, efekt, katman türü ya da ayar eklenip MCP'ye bağlanmasa hiçbir
   test düşmüyordu; ayrıca:
   - `stream`, `power`, `background` gibi yolların TAMAMI en düşük yazma
     iznine düşüyordu ("write" kipi yayın anahtarını ve ESC kilidini
     değiştirebiliyordu);
   - altı araç (analiz, ses tanısı/onarımı, yayın anahtarı, güncelleme)
     ana süreçte bağlanmadığı için hep "kullanılamıyor" dönüyordu;
   - tür araçları her dizgeyi kabul ediyordu.
   Bu dosyadaki testler, uygulamaya bir şey eklenip MCP'de karşılığı
   unutulursa düşer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mcp = require('../src/shared/mcp.js');
const catalog = require('../src/shared/mode-catalog.js');
const layers = require('../src/visualizer/layers.js');
const { MCP_I18N } = require('../src/shared/i18n.js');

function defaultConfig() {
  const saved = global.window;
  global.window = {};
  try {
    delete require.cache[require.resolve('../src/shared/defaults.js')];
    require('../src/shared/defaults.js');
    return global.window.SV.defaultConfig();
  } finally {
    if (saved === undefined) delete global.window; else global.window = saved;
  }
}

const RANK = { read: 1, apply: 2, write: 3, full: 4, everything: 5 };
function rank(group) {
  if (group === 'mcp' || group === 'never') return 99;
  if (group === 'everything') return 5;
  return RANK[mcp.GROUP_MODE[group]] || 5;
}

function ctx(mode, extra) {
  const cfg = Object.assign(defaultConfig(), {
    mcp: { enabled: true, mode: mode },
    scenes: [{ id: 's1', name: 'One', data: { background: { type: 'solid' } } }],
  });
  const ok = () => ({ ok: true });
  return Object.assign({
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => 1,
    revision: () => 1,
    live: () => ({}),
    nowPlaying: () => ({}),
    displays: () => [{ id: 1, label: 'Display 1', primary: true }],
    outputStatus: () => ({ open: false, ids: [] }),
    presets: { list: () => [], get: () => null, save: (p) => ({ ok: true, preset: p }), remove: ok },
    openOutput: ok, closeOutput: ok, setFloatingOpen: () => ({ open: false }), stopClips: ok,
    startExport: ok, cancelExport: ok, writeText: ok, writeBinary: ok,
    capturePreview: () => ({ error: 'none' }), recordStart: ok, recordStop: ok,
    timeline: ok, launchClip: ok,
    analysis: () => ({ ok: true, analysis: null }), diagnoseAudio: () => ({ ok: true }),
    repairAudio: ok, newStreamToken: () => 'tok', downloadUpdate: ok, installUpdate: ok,
  }, extra || {});
}

/* ---------------------------------------------------------------- izinler */

test('her üst düzey ayar anahtarının MCP izni açıkça yazılı', () => {
  const missing = Object.keys(defaultConfig()).filter((k) => !Object.prototype.hasOwnProperty.call(mcp.PATH_GROUPS, k));
  assert.deepStrictEqual(missing, [], 'mcp.js PATH_GROUPS içine ekleyin: yeni ayar hangi izinle yazılsın?');
  for (const [key, group] of Object.entries(mcp.PATH_GROUPS)) {
    assert.ok(group === 'mcp' || group === 'never' || mcp.GROUP_MODE[group], key + ' → bilinmeyen grup ' + group);
  }
});

test('üst yol, altındaki en sıkı izinden gevşek olamaz', () => {
  const cfg = defaultConfig();
  const bad = [];
  const walk = (obj, prefix, depth) => {
    for (const k of Object.keys(obj)) {
      const p = prefix ? prefix + '.' + k : k;
      const v = obj[k];
      const parts = p.split('.');
      for (let i = 1; i < parts.length; i++) {
        const up = parts.slice(0, i).join('.');
        if (rank(mcp.groupForPath(up)) < rank(mcp.groupForPath(p))) bad.push(up + ' < ' + p);
      }
      if (depth < 3 && v && typeof v === 'object' && !Array.isArray(v)) walk(v, p, depth + 1);
    }
  };
  walk(cfg, '', 0);
  assert.deepStrictEqual(bad, []);
});

test('bütün nesneyi yazmak korunan alt alanın iznini ister', () => {
  const g = mcp.groupForPath;
  assert.strictEqual(rank(g('stream')), 5, 'stream: yayın anahtarı');
  assert.strictEqual(rank(g('stream.token')), 5);
  assert.strictEqual(rank(g('power')), 4, 'power: ESC kilidi ve koruma');
  assert.strictEqual(rank(g('background')), 4, 'background: şeffaflık');
  assert.strictEqual(rank(g('background.type')), 3);
  assert.strictEqual(rank(g('transition')), 4, 'transition: karartma');
  assert.strictEqual(rank(g('audio')), 4, 'audio: kaynaklar');
  assert.strictEqual(g('layers.0.postfx.1.enabled'), 'effectEdit');
  assert.strictEqual(g('mcp.mode'), 'mcp');
  assert.strictEqual(g('version'), 'never');
  assert.strictEqual(rank(g('yepyeniOzellik.x')), 5, 'bilinmeyen yol en sıkı izni ister');
});

test('write kipi sv_patch_config ile yayın anahtarını ve gücü değiştiremez', async () => {
  const c = ctx('write');
  const a = await mcp.callTool('sv_patch_config', { path: 'stream', value: { token: 'x', lan: true } }, c);
  assert.strictEqual(a.ok, false);
  const b = await mcp.callTool('sv_patch_config', { path: 'power', value: { protectNoEscape: true } }, c);
  assert.strictEqual(b.ok, false);
  const d = await mcp.callTool('sv_patch_config', { path: 'visualizer.sensitivity', value: 2 }, c);
  assert.strictEqual(d.ok, true, JSON.stringify(d));
});

/* --------------------------------------------------------- uygulama listeleri */

test('MCP efekt listesi görüntü motorunun efektleriyle aynı', () => {
  const window = {};
  const sandbox = vm.createContext({ window, console, Math, Float32Array, Uint8Array, performance: { now: () => 0 } });
  for (const f of ['src/visualizer/postfx.js', 'src/visualizer/postfx-extra.js']) {
    vm.runInContext(read(f), sandbox, { filename: f });
  }
  // vm bağlamının dizisi başka bir Array prototipinden: JSON ile bu bağlama al
  const engine = JSON.parse(JSON.stringify(window.SVPostFX.EFFECT_IDS));
  assert.deepStrictEqual(mcp.EFFECT_TYPES.slice().sort(), engine.sort(),
    'yeni efekt mcp.js EFFECT_TYPES içine eklenmeli');
});

test('sahne anahtarları her kopyada aynı', () => {
  const arr = (src, from) => {
    const at = src.indexOf(from);
    assert.ok(at >= 0, from);
    const open = src.indexOf('[', at);
    const close = src.indexOf(']', open);
    return src.slice(open + 1, close).match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  };
  const want = mcp.SCENE_KEYS.slice().sort();
  assert.deepStrictEqual(arr(read('src/admin/admin.js'), 'const SCENE_KEYS = [').sort(), want, 'admin.js');
  assert.deepStrictEqual(arr(read('src/main/main.js'), 'const SCENE_KEYS = [').sort(), want, 'main.js');
  assert.deepStrictEqual(arr(read('src/admin/control.js'), 'const SCENE_KEYS = [').sort(), want, 'control.js');
  // Şablonlar sahnenin alt kümesini siler (metin ve ortam korunur)
  const tpl = require('../src/shared/templates.js').SCENE_KEYS;
  assert.deepStrictEqual(tpl.filter((k) => want.indexOf(k) < 0), []);
});

test('MCP katman şablonu uygulamanın katman alanlarını kapsıyor', () => {
  const ours = mcp.LAYER_DEFAULTS;
  const theirs = layers.LAYER_DEFAULTS;
  const missing = Object.keys(theirs).filter((k) => !(k in ours));
  assert.deepStrictEqual(missing, [], 'mcp.js LAYER_DEFAULTS eksik alan');
  for (const k of ['transform', 'audio', 'mask']) {
    const sub = Object.keys(theirs[k] || {}).filter((s) => !(s in (ours[k] || {})));
    assert.deepStrictEqual(sub, [], 'LAYER_DEFAULTS.' + k);
  }
});

/* ------------------------------------------------------------ tür doğrulama */

test('katalogdaki her mod MCP ile seçilebilir, olmayan reddedilir', async () => {
  for (const id of catalog.ids('visualizer')) {
    const r = await mcp.callTool('sv_set_visualizer_type', { type: id }, ctx('apply'));
    assert.strictEqual(r.ok, true, 'görselleştirici ' + id + ': ' + JSON.stringify(r));
  }
  for (const id of catalog.ids('background')) {
    const r = await mcp.callTool('sv_set_background_type', { type: id }, ctx('apply'));
    assert.strictEqual(r.ok, true, 'arkaplan ' + id + ': ' + JSON.stringify(r));
  }
  assert.strictEqual((await mcp.callTool('sv_set_visualizer_type', { type: 'yok-boyle-bir-mod' }, ctx('apply'))).ok, false);
  assert.strictEqual((await mcp.callTool('sv_set_background_type', { type: 'bars' }, ctx('apply'))).ok, false);
  const list = await mcp.callTool('sv_list_modes', {}, ctx('read'));
  assert.strictEqual(list.visualizers.length, catalog.ids('visualizer').length);
  assert.strictEqual(list.backgrounds.length, catalog.ids('background').length);
  assert.deepStrictEqual(list.layerKinds, layers.KINDS);
});

test('her katman türü MCP ile eklenebilir ve geçerli bir türle başlar', async () => {
  for (const kind of layers.KINDS) {
    const c = ctx('write');
    const r = await mcp.callTool('sv_add_layer', { kind }, c);
    assert.strictEqual(r.ok, true, kind + ': ' + JSON.stringify(r));
    const added = c.getConfig().layers[c.getConfig().layers.length - 1];
    assert.strictEqual(added.kind, kind);
    if (kind === 'visualizer' || kind === 'background') {
      const ids = catalog.layerPairs(kind).map((p) => p[0]);
      assert.ok(ids.indexOf(added.type) >= 0, kind + ' katmanı geçersiz türle başladı: ' + added.type);
    }
    if (kind === 'nowplaying') assert.strictEqual(added.type, 'nowplaying');
  }
  for (const [args, why] of [
    [{ kind: 'hologram' }, 'bilinmeyen tür'],
    [{ kind: 'background', type: 'bars' }, 'arkaplana görselleştirici kimliği'],
    [{ kind: 'visualizer', type: 'yok' }, 'bilinmeyen mod'],
    [{ kind: 'visualizer', layer: { blend: 'plasma' } }, 'bilinmeyen karışım'],
  ]) {
    assert.strictEqual((await mcp.callTool('sv_add_layer', args, ctx('write'))).ok, false, why);
  }
});

/* ------------------------------------------------------------- araç kataloğu */

test('her MCP aracının Türkçe ve İngilizce açıklaması var, fazlası yok', () => {
  const names = mcp.tools().map((t) => t.name);
  const noText = names.filter((n) => {
    const row = MCP_I18N['mcp.tool.' + n];
    return !row || !row.tr || !row.en;
  });
  assert.deepStrictEqual(noText, [], 'i18n.js MCP_I18N içinde mcp.tool.<ad> eksik');
  const stale = Object.keys(MCP_I18N).filter((k) => k.indexOf('mcp.tool.') === 0 && names.indexOf(k.slice(9)) < 0);
  assert.deepStrictEqual(stale, [], 'artık olmayan aracın metni');
});

test('araçların kullandığı her ctx üyesi ana süreçte bağlı', () => {
  const used = new Set((read('src/shared/mcp.js').match(/ctx\.([a-zA-Z]+)/g) || []).map((s) => s.slice(4)));
  const server = read('src/main/mcp-server.js');
  const at = server.indexOf('function ctx()');
  const body = server.slice(at, server.indexOf('\n  }\n', at));
  const main = read('src/main/main.js');
  const mAt = main.indexOf('mcpHandle = mcpServer.create({');
  const mBody = main.slice(mAt, main.indexOf('\n  });\n', mAt));
  const missing = [];
  for (const name of used) {
    if (!new RegExp('\\b' + name + ':').test(body)) { missing.push('mcp-server ctx(): ' + name); continue; }
    const viaDeps = new RegExp(name + ':\\s*deps\\.' + name).test(body);
    if (viaDeps && !new RegExp('\\n    ' + name + ':').test(mBody)) missing.push('main.js mcpServer.create: ' + name);
  }
  assert.deepStrictEqual(missing, []);
});

test('her araç boş argümanla çağrılınca atmıyor, yanıtı biçimli', async () => {
  for (const t of mcp.tools()) {
    let r;
    try {
      r = await mcp.callTool(t.name, {}, ctx('everything'));
    } catch (e) {
      assert.fail(t.name + ' attı: ' + e.message);
    }
    assert.ok(r && typeof r === 'object', t.name + ' nesne dönmeli');
    if (r.ok === false) assert.ok(typeof r.error === 'string' && r.error.length > 0, t.name + ' hata metni boş');
  }
});
