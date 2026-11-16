/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* AYAR DOSYALARI, Android (src/mobile/profile-store.js, PLAN 2.2).

   Biçim masaüstünün aynısı olmalı: bilgisayardan alınan dosya telefonda,
   telefonda yazılan bilgisayarda açılır. Her adım masaüstündeki karşılığıyla
   (settings-store.js, settings-guard.js, mcp.js) aynı girdide karşılaştırılıyor;
   biri değişirse bu test düşer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PS = require('../../src/mobile/profile-store.js');
const desktopStore = require('../../src/main/settings-store.js');
const { SettingsGuard } = require('../../src/main/settings-guard.js');
const mcp = require('../../src/shared/mcp.js');

const BOM = '﻿';

/* Masaüstü deposunu bellekteki dosyalarla kurar (create(dir, { fs })). */
function desktopWith(texts) {
  const files = new Map(Object.entries(texts || {}).map(([k, v]) => [path.join('/p', k), v]));
  const F = {
    readFileSync: (f) => { if (!files.has(f)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return Buffer.from(files.get(f), 'utf8'); },
    existsSync: (f) => files.has(f),
    writeFileSync: (f, t) => files.set(f, String(t)),
  };
  return desktopStore.create('/p', { fs: F });
}

function sample() {
  return {
    docVersion: 4,
    ui: { theme: 'cayadev', lang: 'tr' },
    audio: { sources: ['system'], gain: 1.2 },
    layers: [{ id: 'l1', kind: 'visualizer', settings: { mode: 'bars' } }],
    scenes: [{ id: 's1', name: 'Bir', data: { layers: [] } }, { id: 's2', name: 'İki', data: {} }],
    milkdropLibrary: { favorites: ['a', 'b'], ratings: { a: 4 } },
  };
}

test('dosya listesi masaüstündeki parçalarla aynı', () => {
  assert.deepStrictEqual(PS.PARTS, desktopStore.PARTS);
  assert.deepStrictEqual(PS.FILES, ['settings.json', 'scenes.json', 'library.json']);
});

test('Kotlin deposunun izin verdiği adlar sayfanın kullandıklarıyla aynı', () => {
  const kt = read('android/app/src/main/java/com/cayadev/visualizer/store/ProfileNames.kt');
  const list = /CONFIG_FILES = listOf\(([^)]*)\)/.exec(kt)[1].match(/"[^"]+"/g).map((s) => JSON.parse(s));
  assert.deepStrictEqual(list, PS.FILES);
  assert.ok(kt.includes('"' + PS.V3_BACKUP + '"'));
  assert.ok(kt.includes('"' + PS.BROKEN + '"'));
});

test('settings.json çözümü SettingsGuard.parse ile aynı (BOM, eski ses kaynağı)', () => {
  const cases = [
    JSON.stringify(sample()),
    BOM + JSON.stringify(sample()),
    JSON.stringify({ audio: { source: 'mic' } }),
    JSON.stringify({ audio: { source: 'mic', sources: ['system'] } }),
    'null',
  ];
  for (const t of cases) assert.deepStrictEqual(PS.parseSettings(t), SettingsGuard.parse(t));
  assert.throws(() => PS.parseSettings('{bozuk'));
});

test('parçaların eklenmesi masaüstündeki merge ile aynı', () => {
  const full = sample();
  const main = Object.assign({}, full);
  delete main.scenes;
  delete main.milkdropLibrary;
  const variants = [
    // Bölünmüş v4 düzeni
    { 'settings.json': JSON.stringify(main), 'scenes.json': JSON.stringify(full.scenes), 'library.json': JSON.stringify(full.milkdropLibrary) },
    // v3: sahneler settings.json'da, parça dosyası eski — settings.json'daki kazanır
    { 'settings.json': JSON.stringify(full), 'scenes.json': '[]' },
    // Boş liste parçayı ezmez
    { 'settings.json': JSON.stringify(Object.assign({}, main, { scenes: [] })), 'scenes.json': JSON.stringify(full.scenes) },
    // Bozuk parça yok sayılır, BOM'lu parça okunur
    { 'settings.json': JSON.stringify(main), 'scenes.json': '{bozuk', 'library.json': BOM + JSON.stringify(full.milkdropLibrary) },
    // Parça yok
    { 'settings.json': JSON.stringify(main) },
  ];
  for (const texts of variants) {
    const mine = PS.merge(PS.parseSettings(texts['settings.json']), texts);
    const theirs = desktopWith(texts).merge(SettingsGuard.parse(texts['settings.json']));
    assert.deepStrictEqual(mine, theirs);
  }
});

test('yazılan metin masaüstündeki serialize ile bayt bayt aynı', () => {
  const cfg = sample();
  const saver = PS.createSaver({ write: async () => {} });
  assert.deepStrictEqual(saver.serialize(cfg), desktopWith({}).serialize(cfg));
  // Parçası olmayan yapılandırma diskteki sahneleri silmesin: dosya listede yok
  const bare = { ui: {} };
  assert.deepStrictEqual(Object.keys(saver.serialize(bare)), Object.keys(desktopWith({}).serialize(bare)));
  assert.deepStrictEqual(Object.keys(saver.serialize(bare)), ['settings.json']);
});

test('artık postfx temizliği mcp.js ile aynı', () => {
  const mk = () => ({ layers: [{ id: 'a', settings: { postfx: [], x: 1 } }, { id: 'b', settings: { x: 2 } }, { settings: { postfx: 1 } }, null] });
  const a = mk();
  const b = mk();
  assert.deepStrictEqual(PS.dropStrayLayerPostfx(a), mcp.dropStrayLayerPostfx(b));
  assert.deepStrictEqual(a, b);
});

test('yükleme: ilk açılış, bozuk dosya, göç ve temizlik', () => {
  assert.deepStrictEqual(PS.load({ 'settings.json': null }), { cfg: null, broken: false });
  assert.deepStrictEqual(PS.load({ 'settings.json': '{bozuk' }), { cfg: null, broken: true });
  assert.deepStrictEqual(PS.load({ 'settings.json': '[1,2]' }), { cfg: null, broken: true });
  const texts = { 'settings.json': JSON.stringify({ audio: { source: 'mic' }, layers: [{ id: 'z', settings: { postfx: 1 } }] }), 'scenes.json': '[{"id":"s"}]' };
  let seen = null;
  const r = PS.load(texts, (cfg) => { seen = cfg; cfg.docVersion = 4; return true; });
  assert.strictEqual(r.migrated, true);
  assert.deepStrictEqual(r.cleaned, ['z']);
  assert.strictEqual(seen, r.cfg);
  // Göç parçalar eklendikten SONRA çalışıyor (masaüstündeki sıra): sahneler de çevrilir
  assert.deepStrictEqual(r.cfg.scenes, [{ id: 's' }]);
  assert.deepStrictEqual(r.cfg.audio.sources, ['mic']);
});

/* Sahte saat: zamanlayıcılar elle ilerletiliyor. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (f, ms) => { const id = ++seq; timers.set(id, { f, at: t + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].f();
      }
      t = end;
    },
  };
}

test('kayıt birleştiriliyor: 300 ms sessizlik ya da en geç 2 sn', async () => {
  const c = fakeClock();
  const writes = [];
  const saver = PS.createSaver({ write: async (files) => { writes.push(files); }, now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const base = sample();
  // Kaydırıcı 55 ms'de bir: 300 ms sessizlik hiç olmuyor, 2 sn'de bir yazılır
  for (let i = 0; i < 60; i++) {
    saver.save(Object.assign({}, base, { audio: { sources: ['system'], gain: i } }));
    c.advance(55);
  }
  await saver.flush();
  assert.ok(writes.length >= 1 && writes.length <= 2, 'yazım sayısı: ' + writes.length);
  assert.strictEqual(JSON.parse(writes[writes.length - 1]['settings.json']).audio.gain, 59);
  // Sürükleme bitince 300 ms sonra son değer yazılır
  writes.length = 0;
  saver.save(Object.assign({}, base, { audio: { sources: ['system'], gain: 99 } }));
  c.advance(299);
  assert.strictEqual(writes.length, 0);
  c.advance(1);
  await saver.flush();
  assert.strictEqual(writes.length, 1);
});

test('değişmeyen parça kanaldan yeniden geçmiyor', async () => {
  const writes = [];
  const cfg = sample();
  const texts = desktopWith({}).serialize(cfg);
  // Okunan dosyalar tohum: aynı içerik hiç yazılmaz
  const saver = PS.createSaver({ write: async (f) => { writes.push(Object.keys(f).sort()); }, seed: texts });
  saver.save(cfg);
  await saver.flush();
  assert.deepStrictEqual(writes, []);
  // Yalnız ayar değişti: sahneler (aynı nesne) ve kütüphane gitmez
  saver.save(Object.assign({}, cfg, { ui: { theme: 'gece' } }));
  await saver.flush();
  assert.deepStrictEqual(writes, [['settings.json']]);
  // Sahne listesi değişti: yalnız o parça
  saver.save(Object.assign({}, cfg, { ui: { theme: 'gece' }, scenes: cfg.scenes.concat([{ id: 's3' }]) }));
  await saver.flush();
  assert.deepStrictEqual(writes[1], ['scenes.json']);
});

test('başarısız yazım unutuluyor ve bir sonraki kayıtta yeniden deneniyor', async () => {
  let fail = true;
  const writes = [];
  const saver = PS.createSaver({ write: async (f) => { if (fail) throw new Error('disk'); writes.push(Object.keys(f).sort()); } });
  const cfg = sample();
  saver.save(cfg);
  await saver.flush();
  assert.strictEqual(saver.stats.errors, 1);
  fail = false;
  saver.save(cfg);
  await saver.flush();
  assert.deepStrictEqual(writes, [['library.json', 'scenes.json', 'settings.json']]);
});

/* ---- Sunucuyla birlikte: sahte uygulama kanalı ---- */
function hostWithNative(disk) {
  const sent = [];
  const listeners = { visibilitychange: [], pagehide: [] };
  const native = {
    postMessage(m) {
      sent.push(m);
      const msg = JSON.parse(m);
      if (msg.t !== 'req') return;
      let v = null;
      if (msg.op === 'storeRead') { v = {}; for (const n of msg.a.names) v[n] = disk.has(n) ? disk.get(n) : null; }
      else if (msg.op === 'storeWrite') { for (const [n, t] of Object.entries(msg.a.files)) disk.set(n, t); v = { written: Object.keys(msg.a.files).length }; }
      else if (msg.op === 'storeCopy') { const c = disk.has(msg.a.from) && (msg.a.overwrite || !disk.has(msg.a.to)); if (c) disk.set(msg.a.to, disk.get(msg.a.from)); v = { copied: c }; }
      Promise.resolve().then(() => native.onmessage({ data: JSON.stringify({ t: 'res', id: msg.id, ok: true, v }) }));
    },
  };
  const document = { visibilityState: 'visible', addEventListener: (n, f) => listeners[n] && listeners[n].push(f) };
  const window = { __SV_ANDROID: { debug: true, page: 'test' }, SVNative: native, SVProfileStore: PS, addEventListener: (n, f) => listeners[n] && listeners[n].push(f) };
  const ctx = { window, document, console, performance: { now: () => 0 }, setTimeout, clearTimeout, setInterval: () => 0, Promise, JSON, Map, Object, Uint8Array, Array, Error };
  vm.createContext(ctx);
  vm.runInContext(read('src/mobile/android-host.js'), ctx, { filename: 'android-host.js' });
  return { window, document, listeners, sent, native };
}

test('sunucu: ilk açılışta yapılandırma yok, kayıt dosyaları masaüstü düzeninde yazar', async () => {
  const disk = new Map();
  const h = hostWithNative(disk);
  assert.strictEqual(await h.window.api.requestConfig(), null);
  const cfg = sample();
  let got = null;
  h.window.api.onConfig((c) => { got = c; });
  h.window.SVAndroid.config.set(cfg);
  assert.strictEqual(got, cfg, 'motor yapılandırmayı hemen alıyor');
  await h.window.SVAndroid.config.flush();
  const expected = desktopWith({}).serialize(cfg);
  for (const n of PS.FILES) assert.strictEqual(disk.get(n), expected[n], n);
});

test('sunucu: kayıtlı ayar okunuyor; arka plana geçince bekleyen kayıt yazılıyor', async () => {
  const cfg = sample();
  const disk = new Map(Object.entries(desktopWith({}).serialize(cfg)));
  const h = hostWithNative(disk);
  const loaded = await h.window.api.requestConfig();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded)), cfg);
  h.window.SVAndroid.config.patch({ ui: { theme: 'gece' } });
  assert.strictEqual(JSON.parse(disk.get('settings.json')).ui.theme, 'cayadev', 'henüz yazılmadı (birleştiriliyor)');
  h.document.visibilityState = 'hidden';
  h.listeners.visibilitychange.forEach((f) => f());
  await h.window.SVAndroid.config.flush();
  assert.strictEqual(JSON.parse(disk.get('settings.json')).ui.theme, 'gece');
  // Uygulamanın "flush" olayı da aynı yoldan (Activity.onPause)
  h.window.SVAndroid.config.patch({ ui: { theme: 'sabah' } });
  h.native.onmessage({ data: JSON.stringify({ t: 'evt', ev: 'flush', v: null }) });
  await h.window.SVAndroid.config.flush();
  assert.strictEqual(JSON.parse(disk.get('settings.json')).ui.theme, 'sabah');
});

test('sunucu: bozuk settings.json üstüne yazılmadan önce kenara alınıyor', async () => {
  const disk = new Map([['settings.json', '{yarım']]);
  const h = hostWithNative(disk);
  assert.strictEqual(await h.window.api.requestConfig(), null);
  assert.strictEqual(disk.get('settings.broken.json'), '{yarım');
  h.window.SVAndroid.config.set({ ui: {} });
  await h.window.SVAndroid.config.flush();
  assert.strictEqual(disk.get('settings.broken.json'), '{yarım');
  assert.deepStrictEqual(JSON.parse(disk.get('settings.json')), { ui: {} });
});

test('sunucu: okuma hata verirse varsayılanlar kullanıcının dosyasının üstüne yazılmıyor', async () => {
  const disk = new Map([['settings.json', JSON.stringify(sample())]]);
  const h = hostWithNative(disk);
  const post = h.native.postMessage;
  h.native.postMessage = (m) => {
    const msg = JSON.parse(m);
    if (msg.op === 'storeRead') return Promise.resolve().then(() => h.native.onmessage({ data: JSON.stringify({ t: 'res', id: msg.id, ok: false, err: 'store-read' }) }));
    return post(m);
  };
  assert.strictEqual(await h.window.api.requestConfig(), null);
  h.window.SVAndroid.config.set({ ui: {} });
  await h.window.SVAndroid.config.flush();
  assert.deepStrictEqual(JSON.parse(disk.get('settings.json')), sample());
  assert.ok(h.window.__svHost.profileState().readError);
});

test('sunucu: masaüstüne özgü çıkışlar motora kapalı gidiyor, dosyada olduğu gibi kalıyor', async () => {
  const cfg = Object.assign(sample(), {
    lighting: { enabled: true, paletteSource: 'milkdrop' },
    wled: { enabled: true, mode: 'matrix' },
    oscOut: { enabled: true },
    artnet: { enabled: false },
  });
  const disk = new Map(Object.entries(desktopWith({}).serialize(cfg)));
  const h = hostWithNative(disk);
  const seen = await h.window.api.requestConfig();
  assert.strictEqual(seen.lighting.enabled, false);
  assert.strictEqual(seen.lighting.paletteSource, 'milkdrop', 'öbür ayarlar korunuyor');
  assert.strictEqual(seen.wled.enabled, false);
  assert.strictEqual(seen.oscOut.enabled, false);
  assert.strictEqual(seen.artnet.enabled, false);
  // Motorun gördüğü yamada da kapalı; dosyada açık kalıyor
  let patch = null;
  h.window.api.onConfigPatch((p) => { patch = p; });
  h.window.SVAndroid.config.patch({ lighting: { enabled: true, mode: 'x' }, ui: { theme: 'gece' } });
  assert.strictEqual(patch.lighting.enabled, false);
  await h.window.SVAndroid.config.flush();
  const onDisk = JSON.parse(disk.get('settings.json'));
  assert.strictEqual(onDisk.lighting.enabled, true);
  assert.strictEqual(onDisk.wled.enabled, true);
  assert.strictEqual(h.window.SVAndroid.config.get().lighting.enabled, true, 'düzenleyici kullanıcının değerini görüyor');
});
