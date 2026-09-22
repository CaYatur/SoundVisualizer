'use strict';
/* BÜYÜK KÜTÜPHANE (#574, ölçek). Ölçüldü (10.347 MilkDrop preseti, 116 MB,
 * yalıtılmış kopya): `presets:list` 3,8 sn, tek bir kaydın turu ana süreci
 * ~2,4 sn kilitliyordu, panel 631 MB tutuyordu ve web istemcileri her
 * değişimde 116 MB alıyordu. Değişiklikten sonra: liste 0,3 sn, kayıt turu
 * 91 ms, panel 273 MB.
 *
 *   - Ana süreçteki depo dosyaları bir kez okuyor ve önbellekte tutuyor.
 *   - Kayıt ve silme bütün listeyi değil yalnız değişenleri yayınlıyor.
 *   - Sayfalar değişikliği aynı sırayla uyguluyor (son değişen önce,
 *     eşitlikte kimlik).
 *   - Web istemcilerine MilkDrop kaynakları gitmiyor; motor çizeceği
 *     presetin kaynağını kimliğiyle istiyor.
 *   - MilkDrop paneli ikinci bir kopya tutmuyor.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');
const vm = require('vm');
require('../src/shared/defaults.js');
require('../src/shared/presets.js');
const SVP = global.window.SVPresets;

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* Depo `electron`u istiyor; CI bağımlılık kurmuyor. Yalnız bu yükleme için
   sahte bir `app` veriliyor — klasörü test kendisi seçiyor (`setDir`). */
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
  return origLoad.apply(this, arguments);
};
const STORE = require('../src/main/presets-store.js');
Module._load = origLoad;

const made = [];
test.after(() => { STORE.setDir(null); for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmpStore() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-store-'));
  made.push(d);
  STORE.setDir(d);
  return d;
}
const md = (id, t, extra) => Object.assign({ id, kind: 'milkdrop', name: 'Y - ' + id, source: '[preset00]\nzoom=1.0' + id.length + '\n', updatedAt: t }, extra || {});
const write = (d, p) => fs.writeFileSync(path.join(d, p.id + '.json'), JSON.stringify(p));

// ------------------------------------------------------------------- sıra

test('sıra: son değişen önce, eşitlikte kimlik — depo ve sayfalar aynı', () => {
  const rnd = crypto.randomBytes(400);
  const list = [];
  for (let i = 0; i < 200; i++) list.push({ id: 'p' + rnd[i].toString(16) + i, updatedAt: rnd[200 + i] % 5 });
  const a = list.slice().sort(STORE.compare).map((p) => p.id);
  const b = list.slice().sort(SVP.compare).map((p) => p.id);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual([{ id: 'b', updatedAt: 1 }, { id: 'a', updatedAt: 1 }, { id: 'c', updatedAt: 2 }].sort(SVP.compare).map((p) => p.id), ['c', 'a', 'b']);
});

// ------------------------------------------------------------------ depo

test('depo: dosyalar bir kez okunuyor; kayıt ve silme önbelleği güncelliyor', () => {
  const d = tmpStore();
  write(d, md('md_a', 3));
  write(d, md('md_b', 2));
  assert.deepStrictEqual(STORE.list().map((p) => p.id), ['md_a', 'md_b']);
  // İkinci liste ve bir kayıttan sonraki liste HİÇ preset dosyası okumuyor
  const origRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (f) { if (String(f).endsWith('.json')) reads++; return origRead.apply(this, arguments); };
  try {
    STORE.list();
    const r = STORE.save(md('md_c', 0));
    assert.ok(r.ok);
    assert.strictEqual(STORE.list()[0].id, 'md_c', 'yeni kayıt en önde');
    assert.ok(STORE.remove('md_a').ok);
    assert.deepStrictEqual(STORE.list().map((p) => p.id), ['md_c', 'md_b']);
  } finally {
    fs.readFileSync = origRead;
  }
  assert.strictEqual(reads, 0, 'önbellek her listede dosyaları yeniden okumamalı');
  assert.strictEqual(STORE.get('md_b').name, 'Y - md_b');
  assert.strictEqual(STORE.get('../md_b'), STORE.get('md_b'), 'kimlik güvenli ada indirgeniyor');
  assert.strictEqual(STORE.get('yok'), null);
});

test('depo: klasöre elle eklenen ya da silinen dosya yine görünüyor', () => {
  const d = tmpStore();
  write(d, md('md_a', 2));
  assert.strictEqual(STORE.list().length, 1);
  write(d, md('md_elle', 5));
  fs.writeFileSync(path.join(d, 'bozuk.json'), '{ yarım');
  assert.deepStrictEqual(STORE.list().map((p) => p.id), ['md_elle', 'md_a'], 'bozuk dosya atlanıyor');
  fs.unlinkSync(path.join(d, 'md_a.json'));
  assert.deepStrictEqual(STORE.list().map((p) => p.id), ['md_elle']);
});

test('depo: arka planda okuma; bu arada yapılan kayıt kaybolmuyor', async () => {
  const d = tmpStore();
  for (let i = 0; i < 150; i++) write(d, md('md_w' + i, i));
  const w = STORE.warm();
  const r = STORE.save(md('md_arada', 0));
  assert.ok(r.ok);
  await w;
  const ids = STORE.list().map((p) => p.id);
  assert.strictEqual(ids.length, 151);
  assert.ok(ids.includes('md_arada'));
  assert.strictEqual(ids[0], 'md_arada');
});

test('depo: toplu kayıt parça parça, paketin sırasıyla, ilerlemeyle', async () => {
  tmpStore();
  /* Kimlikler bilerek AZALAN sırada: sıra kimlikten değil paketten gelmeli
     (eşitlikte kimlik sırası paketi tersine çevirirdi). */
  const items = [];
  for (let i = 0; i < 123; i++) items.push({ id: 'md_t' + String(999 - i).padStart(3, '0'), kind: 'milkdrop', name: 'P' + i, source: 'x' });
  items.splice(10, 0, { id: '...', kind: 'milkdrop', name: 'kötü' }, null, { id: 'md_big', source: 'x'.repeat(600 * 1024) });
  const prog = [];
  const saved = await STORE.saveManyAsync(items, (done, total) => prog.push([done, total]));
  assert.strictEqual(saved.length, 123, 'geçersizler atlanıyor');
  assert.deepStrictEqual(prog.map((p) => p[1]), prog.map(() => 126));
  assert.deepStrictEqual(prog[prog.length - 1], [126, 126]);
  assert.ok(prog.length >= 3, 'parça parça');
  // Listede paketin kendi sırası: ilki önde
  const order = STORE.list().map((p) => p.id);
  assert.deepStrictEqual(order.slice(0, 3), ['md_t999', 'md_t998', 'md_t997']);
  assert.strictEqual(order[order.length - 1], 'md_t877');
});

// ------------------------------------------------------- değişiklik yayını

test('sayfa: değişiklik ekliyor, değiştiriyor, siliyor; iki kez uygulamak aynı', () => {
  SVP.setUser([md('a', 3), md('b', 2), md('c', 1)]);
  assert.ok(SVP.ready());
  const d = { upsert: [md('b', 9, { name: 'yeni b' }), md('e', 0)], remove: ['c'] };
  SVP.applyDelta(d);
  const ids = () => SVP.user().map((p) => p.id);
  assert.deepStrictEqual(ids(), ['b', 'a', 'e']);
  assert.strictEqual(SVP.get('b').name, 'yeni b');
  SVP.applyDelta(d);
  assert.deepStrictEqual(ids(), ['b', 'a', 'e'], 'kaydeden sayfa sonucu kendisi de uyguluyor');
  SVP.applyDelta({ upsert: [null, { name: 'kimliksiz' }], remove: ['yok'] });
  assert.deepStrictEqual(ids(), ['b', 'a', 'e']);
  SVP.setUser([]);
});

// ---------------------------------------------------------- ana süreç

const MAIN = bare(read('src/main/main.js'));

test('ana süreç: kayıt ve silme yalnız değişeni yayınlıyor; bütün liste yayını yok', () => {
  assert.doesNotMatch(MAIN, /notifyAll\('presets',/, 'bütün liste yayını kalmamalı');
  assert.doesNotMatch(MAIN, /broadcastPresets\(/);
  assert.match(MAIN, /ipcMain\.handle\('presets:save', \(e, preset\) => \{\s*const r = presetsStore\.save\(preset\);\s*if \(r\.ok\) broadcastPresetDelta\(\[r\.preset\], \[\]\);/);
  assert.match(MAIN, /ipcMain\.handle\('presets:delete', \(e, id\) => \{\s*const r = presetsStore\.remove\(id\);\s*if \(r\.ok\) broadcastPresetDelta\(\[\], \[String\(id\)\]\);/);
  const many = /ipcMain\.handle\('presets:save-many', async \(e, list\) => \{[\s\S]*?\n\}\);/.exec(MAIN);
  assert.ok(many, 'toplu kayıt eşzamansız olmalı');
  assert.match(many[0], /presetsStore\.saveManyAsync\(list, /);
  assert.match(many[0], /sender\.send\('presets-progress', \{ done, total \}\)/);
  assert.match(many[0], /if \(saved\.length\) broadcastPresetDelta\(saved, \[\]\);/);
  const fn = /function broadcastPresetDelta\(upsert, remove\) \{[\s\S]*?\n\}/.exec(MAIN)[0];
  assert.match(fn, /notifyAll\('presets-delta', delta\);/);
  assert.match(fn, /streamServer\.broadcast\(\{ type: 'presets-delta', delta \}\);/);
});

test('ana süreç: depo açılışta arka planda okunuyor; liste isteği onu bekliyor', () => {
  assert.match(MAIN, /ipcMain\.handle\('presets:list', async \(\) => \{\s*await presetsStore\.warm\(\);\s*return presetsStore\.list\(\);/);
  assert.match(MAIN, /syncNowPlaying\(\);\s*presetsStore\.warm\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(MAIN, /mdPresetSource: \(id\) => \{\s*const p = presetsStore\.get\(id\);\s*return p && p\.kind === 'milkdrop' && typeof p\.source === 'string' \? p\.source : null;/);
});

test('köprüler: pencere ve panel değişikliği ve ilerlemeyi dinliyor', () => {
  assert.match(read('src/main/preload-visualizer.js'), /onPresetsDelta: \(cb\) => ipcRenderer\.on\('presets-delta', \(e, d\) => cb\(d\)\),/);
  const A = read('src/main/preload-admin.js');
  assert.match(A, /onPresetsDelta: \(cb\) => ipcRenderer\.on\('presets-delta', \(e, d\) => cb\(d\)\),/);
  assert.match(A, /onPresetsProgress: \(cb\) => ipcRenderer\.on\('presets-progress', \(e, p\) => cb\(p\)\),/);
  assert.match(bare(read('src/admin/admin.js')), /window\.api\.onPresetsDelta\(\(d\) => \{\s*window\.SVPresets\.applyDelta\(d\);\s*render\(\);/);
});

// ------------------------------------------------------------ görselleştirici

test('görselleştirici: sahne yalnız bir Studio preseti değişince yeniden kuruluyor', () => {
  const V = read('src/visualizer/visualizer.js');
  const m = /window\.api\.onPresetsDelta\((\(d\) => \{[\s\S]*?\n {6}\})\);/.exec(V);
  assert.ok(m, 'değişiklik dinleyicisi bulunamadı');
  const run = (list, delta) => {
    const calls = [];
    SVP.setUser(list);
    const h = new Function('window', 'stack', 'applyScene', 'return ' + m[1])(
      { SVPresets: SVP }, { dispose: () => calls.push('dispose') }, () => calls.push('apply'));
    h(delta);
    return calls;
  };
  const studio = { id: 's1', kind: 'visualizer', engine: 'shader', name: 'S', shader: 'x', updatedAt: 1 };
  assert.deepStrictEqual(run([md('m1', 1)], { upsert: [md('m2', 2)], remove: [] }), [], 'MilkDrop eklendi: motor sürüyor');
  assert.deepStrictEqual(run([md('m1', 1)], { upsert: [], remove: ['m1'] }), [], 'MilkDrop silindi: motor sürüyor');
  assert.deepStrictEqual(run([md('m1', 1)], { upsert: [studio], remove: [] }), ['dispose', 'apply']);
  assert.deepStrictEqual(run([studio], { upsert: [], remove: ['s1'] }), ['dispose', 'apply'], 'silinen Studio presetinin türü önce okunuyor');
  assert.strictEqual(SVP.get('s1'), null);
  SVP.setUser([]);
});

// ----------------------------------------------------------------- panel

test('MilkDrop paneli ikinci kopya istemiyor: ortak listeden', async () => {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = global.window.SV.defaultConfig();
  let asked = 0;
  const node = () => {
    const n = { kids: [], appendChild(c) { n.kids.push(c); return c; }, setAttribute() {}, removeAttribute() {}, addEventListener() {} };
    Object.defineProperty(n, 'textContent', { get: () => '', set: () => { n.kids = []; } });
    return n;
  };
  window.api = { listPresets: () => { asked++; return Promise.resolve([]); } };
  window.SVPanel = { cfg: () => cfg, apply() {}, rerender() {}, el: node, row: node };
  window.SVScenePanels = { miniSlider: node };
  global.document = { querySelector: () => null, getElementById: () => null, activeElement: null };
  SVP.setUser([md('m1', 2), md('m2', 1), { id: 's1', kind: 'visualizer', name: 'S', updatedAt: 3 }]);
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  M.act('Next');
  assert.strictEqual(cfg.milkdrop.presetId, 'm1', 'listeyi ortak listeden aldı');
  SVP.applyDelta({ upsert: [md('m0', 9)], remove: ['m2'] });
  M.panel();
  M.act('Next');
  assert.strictEqual(cfg.milkdrop.presetId, 'm0', 'değişiklik panelin listesine yansıdı');
  assert.strictEqual(asked, 0, 'panel listeyi ana süreçten istememeli');
  SVP.setUser([]);
});

// ------------------------------------------------------------ yayın sunucusu

const S = require('../src/main/stream-server.js');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function wsConnect(port, query) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws?' + query,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const msgs = [];
      const waiters = [];
      let buf = head;
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) msgs.push(JSON.parse(payload.toString('utf8')));
          while (waiters.length) waiters.shift()();
        }
      };
      socket.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
      pump();
      const next = async (type) => {
        for (;;) {
          const i = msgs.findIndex((m) => m.type === type);
          if (i >= 0) return msgs.splice(i, 1)[0];
          await new Promise((r) => waiters.push(r));
        }
      };
      resolve({ socket, next });
    });
    req.on('response', (res) => reject(new Error('yükseltme yok: ' + res.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

test('yayın sunucusu: MilkDrop kaynakları listede gitmiyor, kimlikle isteniyor', { timeout: 15000 }, async () => {
  const LIB = [
    md('md_bir', 2),
    { id: 'st_bir', kind: 'visualizer', engine: 'shader', name: 'Studio', shader: 'void main(){}', updatedAt: 1 },
  ];
  const hooks = {
    getConfig: () => ({ milkdrop: {}, stream: {} }),
    getPresets: () => LIB,
    mdPresetSource: (id) => { const p = LIB.find((x) => x.id === id); return p && p.kind === 'milkdrop' ? p.source : null; },
  };
  let port = 0;
  for (let i = 0; i < 20 && !port; i++) {
    const cand = 20000 + Math.floor(Math.random() * 30000);
    const st = await S.start({ enabled: true, port: cand, requireToken: true, token: 'ovl', remoteToken: 'rmt' }, hooks);
    if (st.running) port = cand;
  }
  assert.ok(port, 'boş port bulunamadı');
  try {
    const c = await wsConnect(port, 'token=ovl');
    const first = await c.next('presets');
    const m = first.presets.find((p) => p.id === 'md_bir');
    assert.strictEqual(m.source, undefined, 'bağlanınca MilkDrop kaynağı gitmiyor');
    assert.strictEqual(m.lazy, true);
    assert.strictEqual(m.name, 'Y - md_bir');
    assert.strictEqual(first.presets.find((p) => p.id === 'st_bir').shader, 'void main(){}', 'Studio preseti olduğu gibi');
    // Değişiklik yayını da soyuluyor; depodaki nesneye dokunulmuyor
    const up = md('md_iki', 5);
    S.broadcast({ type: 'presets-delta', delta: { upsert: [up], remove: ['md_eski'] } });
    const d = await c.next('presets-delta');
    assert.deepStrictEqual([d.delta.upsert[0].id, d.delta.upsert[0].source, d.delta.upsert[0].lazy, d.delta.remove], ['md_iki', undefined, true, ['md_eski']]);
    assert.ok(typeof up.source === 'string' && up.source, 'yayın asıl nesneyi değiştirmemeli');
    c.socket.destroy();
    // Kaynak kimlikle, jetonun arkasında
    assert.strictEqual((await get(port, '/milkdrop/preset?id=md_bir')).status, 401);
    const ok = await get(port, '/milkdrop/preset?id=md_bir&token=ovl');
    assert.strictEqual(ok.status, 200);
    assert.match(ok.type, /^application\/json/);
    assert.deepStrictEqual(JSON.parse(ok.body.toString('utf8')), { id: 'md_bir', source: LIB[0].source });
    assert.strictEqual((await get(port, '/milkdrop/preset?id=st_bir&token=ovl')).status, 404, 'yalnız MilkDrop presetleri');
    assert.strictEqual((await get(port, '/milkdrop/preset?id=yok&token=rmt')).status, 404);
  } finally {
    await S.stop();
  }
});

test('yayın sunucusu: soyma yalnız MilkDrop kaynağına', () => {
  const out = S.publicPresets([md('a', 1), { id: 'b', kind: 'milkdrop', name: 'kaynaksız' }, null, { id: 'c', kind: 'background', source: 'x' }]);
  assert.deepStrictEqual(out.map((p) => p && [p.id, p.source, p.lazy]), [['a', undefined, true], ['b', undefined, undefined], null, ['c', 'x', undefined]]);
});

// ------------------------------------------------------------ web köprüsü

function shim() {
  const sockets = [];
  class FakeWS {
    constructor() { this.readyState = 1; sockets.push(this); }
    send() {}
    close() {}
  }
  const fetched = [];
  const win = {
    location: { search: '?token=t k', pathname: '/', protocol: 'http:', host: 'localhost:1' },
    URLSearchParams,
    WebSocket: FakeWS,
    document: { documentElement: { setAttribute() {} } },
    setTimeout: () => 0,
    Date,
    fetch: (url) => { fetched.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'x', source: 'KAYNAK' }) }); },
  };
  win.window = win;
  vm.runInContext(read('src/web/web-shim.js'), vm.createContext(win), { filename: 'web-shim.js' });
  const msg = (o) => sockets[0].onmessage({ data: JSON.stringify(o) });
  return { win, msg, fetched };
}

test('web köprüsü: değişiklik görselleştiriciye, güncel liste kumandaya', async () => {
  const { win, msg, fetched } = shim();
  const deltas = [];
  const lists = [];
  win.api.onPresetsDelta((d) => deltas.push(d));
  win.SVRemote.onPresets((l) => lists.push(Array.from(l, (p) => p.id)));
  msg({ type: 'presets', presets: [{ id: 'a', lazy: true }, { id: 'b' }] });
  msg({ type: 'presets-delta', delta: { upsert: [{ id: 'c' }, { id: 'a', name: 'yeni' }], remove: ['b'] } });
  assert.strictEqual(deltas.length, 1);
  assert.deepStrictEqual(lists, [['a', 'b'], ['c', 'a']]);
  const src = await win.api.milkdropPresetSource('md 1');
  assert.strictEqual(src, 'KAYNAK');
  assert.strictEqual(fetched[0], '/milkdrop/preset?id=md%201&token=t%20k');
});

// ------------------------------------------------------------------ motor

function engine(api, list) {
  const canvas = () => ({ width: 320, height: 240, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  ctx.window.api = api;
  vm.createContext(ctx);
  for (const f of ['src/shared/presets.js', 'src/shared/milkdrop.js', 'src/shared/milkdrop-cycle.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  ctx.window.SVPresets.setUser(list);
  return { m: new ctx.window.SVModes.milkdrop(canvas()), win: ctx.window };
}

test('motor: kaynağı yolda olan seçim gelene kadar ekrandaki preset sürüyor', async () => {
  let resolve = null;
  let asked = 0;
  const api = { milkdropPresetSource: () => { asked++; return new Promise((r) => { resolve = r; }); } };
  const e = engine(api, [{ id: 'm2', kind: 'milkdrop', name: 'İki', lazy: true, updatedAt: 1 }]);
  const cfg = { milkdrop: { presetId: 'm1', source: '[preset00]\nzoom=1.01\n', blendTime: 0 }, milkdropControl: {}, milkdropLibrary: {} };
  e.m._ensurePreset(cfg);
  const before = e.m.presetKey;
  e.m.autoPick = { id: 'm2', name: 'İki', source: '', lazy: true, cut: false, blend: null, seed: 3 };
  e.m._ensurePreset(cfg);
  e.m._ensurePreset(cfg);
  assert.strictEqual(e.m.presetKey, before, 'kaynak gelmeden değişmiyor');
  assert.strictEqual(asked, 1, 'kaynak bir kez isteniyor');
  resolve('[preset00]\nzoom=0.99\n');
  await new Promise((r) => setImmediate(r));
  e.m._ensurePreset(cfg);
  assert.strictEqual(e.m.presetKey, 'm2|' + '[preset00]\nzoom=0.99\n'.length);
  assert.strictEqual(e.win.SVPresets.get('m2').source, '[preset00]\nzoom=0.99\n', 'kaynak listeye yazıldı');
  assert.strictEqual(e.m._lazySource('m2'), '[preset00]\nzoom=0.99\n');
  assert.strictEqual(asked, 1, 'bir daha istenmiyor');
});

test('motor: kaynak alınamazsa seçim bırakılıyor, varsayılana düşülmüyor', async () => {
  const api = { milkdropPresetSource: () => Promise.resolve(null) };
  const e = engine(api, [{ id: 'm2', kind: 'milkdrop', name: 'İki', lazy: true, updatedAt: 1 }]);
  const cfg = { milkdrop: { presetId: 'm1', source: '[preset00]\nzoom=1.01\n', blendTime: 0 }, milkdropControl: {}, milkdropLibrary: {} };
  e.m._ensurePreset(cfg);
  const before = e.m.presetKey;
  e.m.autoPick = { id: 'm2', name: 'İki', source: '', lazy: true, cut: false, blend: null, seed: 3 };
  e.m._ensurePreset(cfg);
  await new Promise((r) => setImmediate(r));
  e.m._ensurePreset(cfg);
  assert.strictEqual(e.m.autoPick, null);
  assert.strictEqual(e.m.presetKey, before);
});

test('motor: izleyen ve lider seçimi kaynaksız presette "yolda" işaretliyor', () => {
  const M = read('src/visualizer/modes/milkdrop.js');
  assert.match(M, /id: f\.id, name: f\.name \|\| '', source: f\.source \|\| '', lazy: !!f\.lazy && !f\.source, cut: !!F\.cut,/);
  assert.match(M, /id: p\.id, name: p\.name \|\| '', source: p\.source \|\| '', lazy: !!p\.lazy && !p\.source, cut: this\.cycle\.cut,/);
  // Önceden derleme de önce kaynağı istiyor
  assert.match(bare(M), /_prefetch\(p\) \{\s*if \(p\.lazy && !p\.source\) \{\s*const s = this\._lazySource\(p\.id\);\s*if \(s === null\) return;/);
});

test('pencere, panel ve dışa aktarım kaynakları tam alıyor: soyma yalnız web', () => {
  // Dışa aktarım işinde liste depodan olduğu gibi
  assert.match(MAIN, /presets: presetsStore\.list\(\),/);
  // Soyma yalnız yayın sunucusunda
  assert.doesNotMatch(MAIN, /publicPresets/);
});
