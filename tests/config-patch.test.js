'use strict';
/* Ayar gönderiminde yama (#695).

   Gerçek bir ayar ~640 KB (sahneler ~330 KB, MilkDrop etiketleri ~290 KB).
   Kaydırıcı sürüklenirken bütün yapılandırma saniyede ~18 kez panelden ana
   sürece, oradan her pencereye ve yayına kopyalanıyordu; ana sürecin yanıtı
   0,3 ms'den 14–19 ms'ye çıkıyor, Spout penceresi kare kaçırıyordu.
   Şimdi sürüklemede yalnız değişen üst düzey anahtarlar gidiyor, sürükleme
   bitince bütün yapılandırma bir kez daha. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ADMIN = read('src/admin/admin.js');
const MAIN = read('src/main/main.js');

function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('end ' + name);
}

/* Panelin gönderim fonksiyonları sahte api ve zamanlayıcıyla. */
function panel(cfg) {
  const sent = [];
  const timers = [];
  const api = {
    updateConfig: (c) => sent.push({ full: true, keys: Object.keys(c) }),
    patchConfig: (p) => sent.push({ full: false, keys: Object.keys(p), patch: JSON.parse(JSON.stringify(p)) }),
  };
  const src = ['lightSig', 'sendFullConfig', 'sendConfigPatch'].map((n) => sliceFn(ADMIN, n)).join('\n');
  const env = { cfg, blacked: false };
  const fns = new Function('window', 'env', 'setTimeout', 'clearTimeout', `
    const HEAVY_KEYS = { scenes: 1, milkdropLibrary: 1, userPresets: 1 };
    const FULL_AFTER_MS = 700;
    let sentSig = null; let fullTimer = null;
    const isBlackedOut = () => env.blacked;
    let cfg = env.cfg;
    ${src}
    return { sendFullConfig, sendConfigPatch, setCfg: (c) => { cfg = c; }, pendingFull: () => !!fullTimer };
  `)({ api }, env,
    (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    (t) => { if (t) t.live = false; });
  const fire = () => { const t = timers.filter((x) => x.live).pop(); if (t) { t.live = false; t.fn(); } };
  return Object.assign(fns, { sent, timers, env, fire });
}

const base = () => ({
  background: { gradient: { speed: 1 } }, visualizer: { type: 'bars' }, layers: [],
  scenes: [{ id: 's', name: 'Big' }], milkdropLibrary: { tags: { a: ['x'] } }, userPresets: [],
});

test('ilk gönderim tam; sonra yalnız değişen hafif anahtar yama olarak gider', () => {
  const cfg = base();
  const p = panel(cfg);
  p.sendConfigPatch(); // henüz imza yok: tam
  assert.deepStrictEqual(p.sent.map((s) => s.full), [true]);
  cfg.background.gradient.speed = 1.5;
  p.sendConfigPatch();
  assert.strictEqual(p.sent[1].full, false);
  assert.deepStrictEqual(p.sent[1].keys, ['background']);
  assert.strictEqual(p.sent[1].patch.background.gradient.speed, 1.5);
  // Değişiklik yoksa yama yok
  p.sendConfigPatch();
  assert.strictEqual(p.sent.length, 2);
});

test('ağır anahtarlar yamaya girmez; sürükleme bitince tam yapılandırma gider', () => {
  const cfg = base();
  const p = panel(cfg);
  p.sendFullConfig();
  cfg.scenes.push({ id: 't' });
  cfg.layers.push({ id: 'L' });
  p.sendConfigPatch();
  assert.deepStrictEqual(p.sent[1].keys, ['layers']);
  assert.ok(p.pendingFull(), 'sondaki tam gönderim kurulmalı');
  const at = p.timers.filter((t) => t.live).pop();
  assert.strictEqual(at.ms, 700);
  p.fire();
  assert.strictEqual(p.sent[2].full, true, 'kaçan ağır değişiklik tam gönderimde yetişir');
  assert.ok(p.sent[2].keys.includes('scenes'));
});

test('push(true) bekleyen sondaki tam gönderimi iptal edip hemen tam yollar', () => {
  const cfg = base();
  const p = panel(cfg);
  p.sendFullConfig();
  cfg.visualizer.type = 'wave';
  p.sendConfigPatch();
  assert.ok(p.pendingFull());
  p.sendFullConfig();
  assert.ok(!p.pendingFull(), 'tam gönderim zamanlayıcıyı kapatmalı');
  assert.strictEqual(p.timers.filter((t) => t.live).length, 0);
});

test('anahtar kaybolursa ya da karartmadaysa tam gönderilir', () => {
  const cfg = base();
  const p = panel(cfg);
  p.sendFullConfig();
  delete cfg.visualizer;
  p.sendConfigPatch();
  assert.strictEqual(p.sent[1].full, true);
  p.env.blacked = true;
  cfg.background.gradient.speed = 2;
  p.sendConfigPatch();
  assert.strictEqual(p.sent[2].full, true);
});

test('ana süreç yamayı tam yapılandırma olmadan uygulamaz, tehlikeli anahtarı atlar', () => {
  const at = MAIN.indexOf("ipcMain.on('patch-config'");
  assert.ok(at > 0);
  const h = MAIN.slice(at, MAIN.indexOf('\n});', at));
  assert.match(h, /if \(!currentConfig \|\| !patch \|\| typeof patch !== 'object' \|\| Array\.isArray\(patch\)\) return;/);
  assert.match(h, /k === '__proto__' \|\| k === 'constructor' \|\| k === 'prototype'/);
  assert.match(h, /const next = Object\.assign\(\{\}, currentConfig\);/);
  assert.match(h, /applyIncomingConfig\(next, \{ patchKeys: keys \}\)/);
});

test('pencerelere sahne listesi ve renk şablonları gitmez', () => {
  const fn = new Function(sliceFn(MAIN, 'rendererConfig') + "\nconst RENDERER_OMIT = ['scenes', 'userPresets'];\nreturn rendererConfig;")();
  const cfg = base();
  const out = fn(cfg);
  assert.ok(!('scenes' in out) && !('userPresets' in out));
  assert.ok('milkdropLibrary' in out, 'etiket süzgeci görselleştiricide çalışıyor');
  assert.ok('scenes' in cfg, 'asıl yapılandırma değişmemeli');
  assert.match(MAIN, /ipcMain\.handle\('request-config', \(\) => rendererConfig\(currentConfig\)\)/);
  assert.match(sliceFn(MAIN, 'sendToVisualizers'), /if \(channel === 'config'\) payload = rendererConfig\(payload\);/);
});

test('görselleştirici ve web sayfası yamayı ilk tam yapılandırmanın üstüne koyar', () => {
  const V = read('src/visualizer/visualizer.js');
  assert.match(V, /window\.api\.onConfig\(\(c\) => \{ rawCfg = c; applyConfig\(c\); \}\);/);
  assert.match(V, /if \(!rawCfg \|\| !p \|\| typeof p !== 'object'\) return;\s*rawCfg = Object\.assign\(\{\}, rawCfg, p\);/);
  assert.match(read('src/main/preload-visualizer.js'), /onConfigPatch: \(cb\) => ipcRenderer\.on\('config-patch'/);
  const W = read('src/web/web-shim.js');
  assert.match(W, /else if \(lastRawConfig && msg\.patch && typeof msg\.patch === 'object'\) raw = Object\.assign\(\{\}, lastRawConfig, msg\.patch\);/);
  assert.match(read('src/main/stream-server.js'), /obj\.type === 'config-patch'\) obj = Object\.assign\(\{\}, obj, \{ patch: publicConfig\(obj\.patch\) \}\)/);
});

test('Spout penceresi ayarları değişmedikçe her gönderimde yeniden kurulmaz', () => {
  const fn = sliceFn(MAIN, 'syncTextureShare');
  assert.match(fn, /if \(key === textureShareKey && live && !live\.isDestroyed\(\) && textureShare\.status\(\)\.running\)/);
});

test('MCP preset yoklaması yedek: 3 sn, pencere gizliyken yok', () => {
  assert.match(ADMIN, /const MCP_PRESET_POLL_MS = 3000;/);
  assert.match(ADMIN, /cfg\.mcp\.enabled && !document\.hidden\) catchPresets\(\);\s*\}, MCP_PRESET_POLL_MS\);/);
  // Ana süreç her MCP isteğinden sonra ve izleyiciyle farkı yayınlıyor
  assert.match(MAIN, /syncPresets: \(\) => \{\s*const delta = presetsStore\.syncDisk\(\);/);
  assert.match(MAIN, /presetsStore\.watch\(/);
});
