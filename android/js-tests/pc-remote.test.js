/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* UZAK AYAR DEPOSU (src/mobile/pc-remote.js + android-host.js hedefi; PC bağlantısı B3).
   Telefon PC'nin ayarına yalnız değiştirdiği üst anahtarları yollar; göç ya da varsayılan
   doldurma çalıştırmaz; sahne listesini ayrı işlemlerle değiştirir; sahne çağırmayı PC'ye
   bırakır; teması telefonda kalır; sürüm atlayınca baştan çeker; sürüklenen değer PC'nin araya
   giren yanıtıyla zıplamaz; bağlantı kopunca telefonun kendi ayarına döner. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const R = require('../../src/mobile/pc-remote.js');

const pcCfg = () => ({
  visualizer: { type: 'bars' }, layers: [{ id: 'l1', kind: 'visualizer', type: 'bars' }], master: 1,
  scenes: [{ id: 'a', name: 'Gece', data: { visualizer: { type: 'bars' } } }, { id: 'b', name: 'Tünel', data: { visualizer: { type: 'tunnel' } } }],
  ui: { theme: 'neon' }, power: { fpsCap: 0 }, timeline: { tracks: [] }, futureKey: { x: 1 },
});
const phone = () => ({ ui: { theme: 'cayadev' }, power: { fpsCap: 30 }, audio: { sensitivity: 1 } });

test('görünüm: PC ayarı, tema telefonun; motor telefonun güç ve ses ayarıyla çizer', () => {
  const v = R.view(pcCfg(), phone());
  assert.strictEqual(v.ui.theme, 'cayadev');
  assert.strictEqual(v.visualizer.type, 'bars');
  assert.strictEqual(v.power.fpsCap, 0, 'düzenleyici PC\'nin gücünü görür');
  const e = R.engine(v, phone());
  assert.strictEqual(e.power.fpsCap, 30);
  assert.deepStrictEqual(e.audio, { sensitivity: 1 });
  assert.deepStrictEqual(R.enginePatch({ power: {}, ui: {}, layers: [] }), { layers: [] });
});

test('fark: yalnız değişen anahtar; tanınmayan alan ve tema PC\'ye gitmez', () => {
  const cur = R.view(pcCfg(), phone());
  const next = JSON.parse(JSON.stringify(cur));
  next.visualizer.type = 'wave';
  next.ui.theme = 'gece';
  const d = R.diff(cur, next);
  assert.deepStrictEqual(Object.keys(d.patch), ['visualizer']);
  assert.deepStrictEqual(d.local, { ui: { theme: 'gece' } });
  assert.deepStrictEqual(d.ops, []);
  assert.strictEqual(d.apply, '');
  // Düzenleyici bir anahtarı silse de PC'deki alan silinmez (yalnız gelenler yazılır)
  const fewer = Object.assign({}, cur);
  delete fewer.futureKey;
  assert.deepStrictEqual(R.diff(cur, fewer).patch, {});
});

test('sahne çağırma PC\'ye scene.apply olur, sahne anahtarları yama olarak gitmez', () => {
  const cur = R.view(pcCfg(), phone());
  const next = Object.assign({}, cur, { visualizer: { type: 'tunnel' }, layers: [], _activeSceneId: 'b' });
  const d = R.diff(cur, next);
  assert.strictEqual(d.apply, 'b');
  assert.deepStrictEqual(d.patch, {});
  // Etkin sahneyi bırakmak (düzenleme sonrası) yama olarak gider
  const d2 = R.diff(Object.assign({}, cur, { _activeSceneId: 'b' }), Object.assign({}, cur, { _activeSceneId: null }));
  assert.deepStrictEqual(d2.patch, { _activeSceneId: null });
});

test('sahne listesi: ekle, sil, yeniden adlandır, veri, sıra ayrı işlemler', () => {
  const a = pcCfg().scenes;
  let b = JSON.parse(JSON.stringify(a));
  b[0].name = 'Gece 2';
  b[1].data = { visualizer: { type: 'wave' } };
  assert.deepStrictEqual(R.diffScenes(a, b).map((o) => o.op), ['scene.rename', 'scene.save']);
  b = [a[1], a[0]];
  assert.deepStrictEqual(R.diffScenes(a, b), [{ op: 'scene.reorder', args: { ids: ['b', 'a'] } }]);
  b = [a[0], { id: 'yeni', name: 'Telefondan', data: { master: 1 } }];
  assert.deepStrictEqual(R.diffScenes(a, b), [
    { op: 'scene.delete', args: { id: 'b' } },
    { op: 'scene.create', args: { name: 'Telefondan', data: { master: 1 } } },
  ]);
  const cur = R.view(pcCfg(), phone());
  const d = R.diff(cur, Object.assign({}, cur, { scenes: b }));
  assert.ok(!('scenes' in d.patch), 'sahne listesi yamaya girmez');
  assert.strictEqual(d.ops.length, 2);
});

test('PC olayı: sürüm sırası, atlama baştan çekme, sürüklenen anahtar korunur', () => {
  const st = { cfg: pcCfg(), rev: 4, writing: { master: 1000 } };
  assert.deepStrictEqual(R.applyEvent(st, { rev: 6, patch: {} }, 1100), { refetch: true });
  assert.deepStrictEqual(R.applyEvent(st, { rev: 4, patch: {} }, 1100), { stale: true });
  const r = R.applyEvent(st, { rev: 5, patch: { master: 0.2, visualizer: { type: 'wave' } } }, 1100, 600);
  assert.strictEqual(r.rev, 5);
  assert.strictEqual(r.cfg.master, 1, 'sürüklenen değer zıplamadı');
  assert.strictEqual(r.cfg.visualizer.type, 'wave');
  assert.deepStrictEqual(Object.keys(r.patch), ['visualizer']);
  assert.deepStrictEqual(r.deferred, { master: 0.2 }, 'PC\'nin değeri atılmadı, bekletildi');
  const later = R.applyEvent(st, { rev: 5, patch: { master: 0.2 } }, 2000, 600);
  assert.strictEqual(later.cfg.master, 0.2, 'bırakınca PC\'ninki geçerli');
  // Bekletilen değer yazım durunca uygulanır
  const st2 = { cfg: r.cfg, rev: 5, writing: { master: 1000 }, deferred: r.deferred };
  assert.deepStrictEqual(R.settle(st2, 1200, 600).patch, {}, 'yazım sürüyor');
  const done = R.settle(st2, 1700, 600);
  assert.strictEqual(done.cfg.master, 0.2);
  assert.deepStrictEqual(done.deferred, {});
});

/* ---- Sunucuyla: sahte uygulama ve sahte PC ---- */
function host(pcState) {
  const asks = [];
  const timers = [];
  const native = {
    postMessage(m) {
      const msg = JSON.parse(m);
      if (msg.t !== 'req') return;
      let v = null;
      if (msg.op === 'storeRead') v = { 'settings.json': JSON.stringify(phone()), 'scenes.json': null, 'library.json': null };
      else if (msg.op === 'storeWrite') v = { written: 1 };
      else if (msg.op === 'linkStatus') v = { state: 'connected', pc: { id: 'p1', name: 'Stüdyo-PC' }, level: 'full', saved: [] };
      else if (msg.op === 'linkRequest') {
        asks.push([msg.a.op, msg.a.args]);
        if (msg.a.op === 'config.get') v = { ok: true, result: { rev: pcState.rev, config: pcState.cfg } };
        else if (msg.a.op === 'state.get') v = { ok: true, result: { standby: false } };
        else if (msg.a.op === 'live.get') v = { ok: true, result: { show: { active: 'a' }, meter: { level: 0.5 } } };
        else v = { ok: true, result: {} };
      }
      Promise.resolve().then(() => native.onmessage({ data: JSON.stringify({ t: 'res', id: msg.id, ok: true, v }) }));
    },
  };
  const store = new Map();
  const window = {
    __SV_ANDROID: { debug: true, page: 'test' }, SVNative: native, SVProfileStore: require('../../src/mobile/profile-store.js'), SVPcRemote: R,
    addEventListener() {},
  };
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const ctx = {
    window, localStorage, document: { visibilityState: 'visible', addEventListener() {} }, console, performance: { now: () => 0 },
    setTimeout: (f, ms) => { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Promise, JSON, Map, Object, Uint8Array, Array, Error, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(read('src/mobile/android-host.js'), ctx, { filename: 'android-host.js' });
  const evt = (name, v) => native.onmessage({ data: JSON.stringify({ t: 'evt', ev: name, v }) });
  const tick = () => new Promise((r) => setImmediate(r));
  return { window, asks, evt, tick, runTimers: () => { const t = timers.splice(0); t.forEach((f) => f()); }, store };
}

test('sunucu: PC hedefine geçiş aynayı yükler, yazım PC\'ye gider, telefonun ayarı değişmez, kopunca döner', async () => {
  const pcState = { cfg: pcCfg(), rev: 3 };
  const h = host(pcState);
  const A = h.window.SVAndroid;
  await h.window.api.requestConfig();
  const engine = [];
  h.window.api.onConfig((c) => engine.push(['config', c]));
  h.window.api.onConfigPatch((p) => engine.push(['patch', p]));
  A.target.get();
  h.evt('linkState', { state: 'connected', pc: { id: 'p1', name: 'Stüdyo-PC' } });
  await h.tick();
  const info = await A.target.set('pc');
  assert.strictEqual(info.target, 'pc');
  assert.strictEqual(info.name, 'Stüdyo-PC');
  assert.strictEqual(A.config.get().visualizer.type, 'bars');
  assert.strictEqual(A.config.get().ui.theme, 'cayadev', 'tema telefonun');
  const last = engine.filter((e) => e[0] === 'config').pop()[1];
  assert.strictEqual(last.power.fpsCap, 30, 'motor telefonun gücüyle');
  assert.deepStrictEqual(A.pc.live(), { active: 'a' });

  // Kesin yazım: yalnız değişen anahtar, config.patch final
  h.asks.length = 0;
  const next = JSON.parse(JSON.stringify(A.config.get()));
  next.visualizer.type = 'wave';
  A.config.set(next);
  await h.tick(); await h.tick();
  assert.deepStrictEqual(h.asks, [['config.patch', { patch: { visualizer: { type: 'wave' } }, final: true }]]);
  assert.strictEqual(A.config.local().visualizer, undefined, 'telefonun kendi ayarına yazılmadı');

  // Sürükleme: ara yamalar final:false, sonra bir kesin yazım
  h.asks.length = 0;
  A.config.patch({ master: 0.4 });
  A.config.patch({ master: 0.3 });
  h.runTimers(); // ara gönderim ve kesin yazım zamanlayıcıları
  await h.tick(); await h.tick();
  assert.deepStrictEqual(h.asks.map((a) => [a[0], a[1].final, a[1].patch.master]), [['config.patch', false, 0.3], ['config.patch', true, 0.3]]);

  // Sahne çağırma
  h.asks.length = 0;
  const cur = A.config.get();
  A.config.set(Object.assign({}, cur, { visualizer: { type: 'tunnel' }, _activeSceneId: 'b' }));
  await h.tick(); await h.tick();
  assert.deepStrictEqual(h.asks, [['scene.apply', { id: 'b' }]]);

  // PC olayı aynayı günceller; sürüm atlayınca baştan çeker
  h.evt('linkEvent', { ev: 'config', rev: 4, patch: { timeline: { tracks: [1] } } });
  assert.deepStrictEqual(A.config.get().timeline, { tracks: [1] });
  h.asks.length = 0;
  h.evt('linkEvent', { ev: 'config', rev: 9, patch: {} });
  await h.tick();
  assert.strictEqual(h.asks[0][0], 'config.get');

  // Bağlantı koptu: telefonun kendi ayarı
  h.evt('linkState', { state: 'reconnecting', pc: { id: 'p1', name: 'Stüdyo-PC' } });
  assert.strictEqual(A.target.get().target, 'phone');
  assert.strictEqual(A.config.get().visualizer, undefined);
  assert.strictEqual(A.target.get().wanted, true, 'seçim hatırlanıyor');
  assert.strictEqual(h.store.get('sv-link-target'), 'pc');
});

test('PC olayı: bekletilen eski değer, sonradan doğrudan kabul edilen yeni değeri ezmez', () => {
  const st = { cfg: { master: 1 }, rev: 1, writing: { master: 1000 }, deferred: {} };
  const a = R.applyEvent(st, { rev: 2, patch: { master: 0.6 } }, 1300, 600);
  assert.deepStrictEqual(a.deferred, { master: 0.6 });
  Object.assign(st, { cfg: a.cfg, rev: 2, deferred: a.deferred });
  const b = R.applyEvent(st, { rev: 3, patch: { master: 0.35 } }, 1700, 600);
  assert.strictEqual(b.cfg.master, 0.35);
  assert.deepStrictEqual(b.superseded, ['master']);
  for (const k of b.superseded) delete st.deferred[k];
  Object.assign(st, { cfg: b.cfg, rev: 3 });
  assert.strictEqual(R.settle(st, 2000, 600).cfg.master, 0.35, 'süre dolunca eski 0,6 geri gelmedi');
});
