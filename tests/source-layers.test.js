'use strict';
/* Dış kaynak katmanları: Spout/Syphon girişi ve web sayfası.
 *
 * Üç katman sınanıyor:
 *   - saf kurallar (shared/source-layers.js): adres denetimi, yerel ağ
 *     sınıflandırması, ayar sınırları, hangi kaynağın açık olacağı;
 *   - web sayfasının bekçisi (main/web-layer-guard.js): uygulamanın kendi
 *     portları, yerel ağ, DNS rebinding, izinler, indirme, açılır pencere,
 *     gezinme;
 *   - ana süreç dağıtıcısı (main/layer-sources.js): sahte GPU ve sahte
 *     göndericiyle her dokunun ve tutamacın HER YOLDA bırakıldığı, yavaş bir
 *     pencerenin atlandığı, doku alınamayınca bit eşlem yoluna geçildiği,
 *     sahneden çıkan kaynağın geçiş süresi kadar beklediği, çöken sayfanın
 *     artan aralıkla yeniden açıldığı.
 *
 * Gerçek Electron ve gerçek göndericiyle uçtan uca ölçüm PR'da (spike ve
 * yalıtılmış uygulama koşusu); burada aynı sözleşme saniyenin altında. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SL = require('../src/shared/source-layers.js');
const WG = require('../src/main/web-layer-guard.js');
const LS = require('../src/main/layer-sources.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- saf kurallar

test('adres: yalnız http/https, şemasız ad https sayılır, kimlik bilgisi reddedilir', () => {
  assert.deepStrictEqual(SL.checkUrl('example.com/a').url, 'https://example.com/a');
  assert.strictEqual(SL.checkUrl('http://example.com/').ok, true);
  for (const [raw, reason] of [
    ['', 'EMPTY'], ['   ', 'EMPTY'], [null, 'EMPTY'],
    ['javascript:alert(1)', 'SCHEME'], ['file:///C:/Windows/win.ini', 'SCHEME'],
    ['sv-media://local/x', 'SCHEME'], ['data:text/html,x', 'SCHEME'], ['ftp://x.org/', 'SCHEME'],
    ['https://ad:parola@example.com/', 'CREDENTIALS'], ['https://ad@example.com/', 'CREDENTIALS'],
    ['https://' + 'a'.repeat(2100) + '.com/', 'TOO_LONG'],
  ]) {
    const r = SL.checkUrl(raw);
    assert.strictEqual(r.ok, false, String(raw).slice(0, 40));
    assert.strictEqual(r.reason, reason, String(raw).slice(0, 40));
  }
  assert.strictEqual(SL.checkUrl('http://127.0.0.1:8080/').local, true);
  assert.strictEqual(SL.checkUrl('https://example.com/').local, false);
});

test('yerel ağ sınıflandırması: her yazım biçimi yakalanıyor', () => {
  const cls = (u) => SL.hostClass(new URL(u).hostname);
  const table = {
    'http://127.0.0.1/': 'loopback', 'http://127.255.0.9/': 'loopback',
    'http://2130706433/': 'loopback', 'http://0x7f.1/': 'loopback', 'http://017700000001/': 'loopback',
    'http://localhost/': 'loopback', 'http://a.b.localhost/': 'loopback', 'http://LOCALHOST./': 'loopback',
    'http://[::1]/': 'loopback', 'http://[::ffff:127.0.0.1]/': 'loopback', 'http://[::ffff:7f00:1]/': 'loopback',
    'http://[::127.0.0.1]/': 'loopback', 'http://[64:ff9b::7f00:1]/': 'loopback',
    'http://0.0.0.0/': 'unspecified', 'http://[::]/': 'unspecified',
    'http://10.1.2.3/': 'private', 'http://172.16.0.1/': 'private', 'http://172.31.255.1/': 'private',
    'http://192.168.1.1/': 'private', 'http://100.64.0.1/': 'private', 'http://[fd12::1]/': 'private',
    'http://[::ffff:192.168.0.1]/': 'private', 'http://224.0.0.251/': 'private',
    'http://169.254.169.254/': 'linklocal', 'http://[fe80::1]/': 'linklocal',
    'http://router/': 'local-name', 'http://nas.local/': 'local-name', 'http://box.lan/': 'local-name',
    'http://printer.home.arpa/': 'local-name',
    'https://example.com/': 'public', 'http://172.32.0.1/': 'public', 'http://8.8.8.8/': 'public',
    'http://[2001:db8::1]/': 'public', 'http://100.128.0.1/': 'public',
  };
  for (const [u, want] of Object.entries(table)) assert.strictEqual(cls(u), want, u);
});

test('ayarlar sınırlanıyor ve varsayılanlar dolduruluyor', () => {
  const w = SL.normalizeWeb({ width: 99999, height: 1, fps: 500, zoom: 0, css: 'x'.repeat(30000), reloadMin: -5, fit: 'nope', url: '  https://a.b/  ' });
  assert.deepStrictEqual([w.width, w.height, w.fps, w.zoom, w.css.length, w.reloadMin, w.fit, w.url],
    [3840, 240, 60, 0.25, SL.LIMITS.css, 0, 'contain', 'https://a.b/']);
  assert.strictEqual(SL.normalizeWeb(null).transparent, true);
  assert.strictEqual(SL.normalizeWeb(null).audio, false, 'sayfanın sesi varsayılan kapalı');
  const i = SL.normalizeInput({ sender: '  X  ', fit: 'cover', hold: false });
  assert.deepStrictEqual([i.sender, i.fit, i.hold, i.alpha, i.mirror], ['X', 'cover', false, false, false]);
});

test('kaynak anahtarı: aynı gönderici paylaşılır, web sayfası katmana ait', () => {
  const a = { id: 'a', kind: 'input', settings: { input: { sender: 'TD' } } };
  const b = { id: 'b', kind: 'input', settings: { input: { sender: 'TD' } } };
  assert.strictEqual(SL.sourceKey(a), SL.sourceKey(b));
  assert.notStrictEqual(SL.sourceKey({ kind: 'input', settings: { input: { sender: 'TD', app: 'X' } } }), SL.sourceKey(a));
  assert.strictEqual(SL.sourceKey({ kind: 'input', settings: { input: {} } }), '', 'gönderici yoksa kaynak yok');
  assert.notStrictEqual(SL.sourceKey({ id: 'w1', kind: 'web' }), SL.sourceKey({ id: 'w2', kind: 'web' }));
  assert.strictEqual(SL.sourceKey({ kind: 'visualizer' }), '');
});

test('hangi kaynaklar açık: yığın, sessiz, solo, kapalı, sınır', () => {
  const L = (id, kind, extra) => Object.assign({ id, kind, settings: kind === 'input' ? { input: { sender: 'S' + id } } : { web: { url: 'https://x.org/' + id } } }, extra || {});
  assert.deepStrictEqual(SL.wanted({ layerStack: { enabled: false }, layers: [L('1', 'web')] }), [], 'yığın kapalıysa hiçbiri');
  const w = SL.wanted({ layers: [L('1', 'web'), L('2', 'input', { muted: true }), L('3', 'web', { enabled: false }), { id: 'v', kind: 'visualizer' }] });
  assert.deepStrictEqual(w.map((x) => [x.layerId, x.active]), [['1', true], ['2', false], ['3', false]]);
  const solo = SL.wanted({ layers: [L('1', 'web'), L('2', 'web', { solo: true })] });
  assert.deepStrictEqual(solo.map((x) => x.active), [false, true], 'solo varsa diğerleri duraklar ama açık kalır');
  const shared = SL.wanted({ layers: [Object.assign(L('1', 'input', { muted: true }), { settings: { input: { sender: 'T' } } }), Object.assign(L('2', 'input'), { settings: { input: { sender: 'T' } } })] });
  assert.strictEqual(shared.length, 1);
  assert.strictEqual(shared[0].active, true, 'paylaşılan göndericiyi açık katmanlardan biri istiyorsa açık');
  const many = SL.wanted({ layers: Array.from({ length: 10 }, (_, i) => L(String(i), 'web')) });
  assert.strictEqual(many.length, SL.LIMITS.maxWeb);
});

test('sığdırma hesabı', () => {
  assert.deepStrictEqual(SL.fitRect('contain', 1920, 1080, 1080, 1080), { dx: 420, dy: 0, dw: 1080, dh: 1080 });
  assert.deepStrictEqual(SL.fitRect('cover', 1920, 1080, 1080, 1080), { dx: 0, dy: -420, dw: 1920, dh: 1920 });
  assert.deepStrictEqual(SL.fitRect('stretch', 100, 50, 7, 9), { dx: 0, dy: 0, dw: 100, dh: 50 });
  assert.deepStrictEqual(SL.fitRect('contain', 100, 50, 0, 9), { dx: 0, dy: 0, dw: 0, dh: 0 });
});

test('kendi çıkışı gönderici listesinden ayrılıyor (Spout\'un _1 ekli adı dahil)', () => {
  const r = SL.splitSenders([{ name: 'CAYADEV Visualizer' }, { name: 'CAYADEV Visualizer_1' }, { name: 'CAYADEV Visualizer_x' }, { name: 'TD', appName: 'TouchDesigner' }, null, { name: '' }], ['CAYADEV Visualizer']);
  assert.deepStrictEqual(r.mine.map((x) => x.name), ['CAYADEV Visualizer', 'CAYADEV Visualizer_1']);
  assert.deepStrictEqual(r.others.map((x) => [x.name, x.app]), [['CAYADEV Visualizer_x', ''], ['TD', 'TouchDesigner']]);
});

// ------------------------------------------------------------------- bekçi

test('bekçi: uygulamanın portu, yerel ağ, yazılan yerel köken, rebinding', () => {
  const ctx = { allowedLocal: new Set(['http://127.0.0.1:3000']), appPorts: new Set([8722, 3000]) };
  assert.deepStrictEqual(WG.decide('https://example.com/a', ctx), { ok: true });
  assert.strictEqual(WG.decide('http://127.0.0.1:8722/', ctx).reason, 'APP_PORT');
  assert.strictEqual(WG.decide('ws://localhost:8722/ws', ctx).reason, 'APP_PORT');
  assert.strictEqual(WG.decide('http://127.0.0.1:3000/', ctx).reason, 'APP_PORT', 'uygulamanın portu kullanıcı yazsa da kapalı');
  const ctx2 = { allowedLocal: new Set(['http://127.0.0.1:4000']), appPorts: new Set([8722]) };
  assert.deepStrictEqual(WG.decide('http://127.0.0.1:4000/x', ctx2), { ok: true });
  assert.deepStrictEqual(WG.decide('ws://127.0.0.1:4000/x', ctx2), { ok: true }, 'aynı kökenin WebSocket\'i');
  assert.strictEqual(WG.decide('http://127.0.0.1:4001/', ctx2).reason, 'LOCAL', 'başka port başka köken');
  assert.strictEqual(WG.decide('http://192.168.1.1/', ctx2).reason, 'LOCAL');
  assert.strictEqual(WG.decide('http://[::ffff:c0a8:101]/', ctx2).reason, 'LOCAL');
  assert.strictEqual(WG.decide('file:///C:/x', ctx2).reason, 'SCHEME');
  assert.strictEqual(WG.decide('sv-media://local/x', ctx2).reason, 'SCHEME');
  assert.strictEqual(WG.decide('chrome://gpu', ctx2).reason, 'SCHEME');
  const resolved = new Map([['evil.example', ['127.0.0.1']]]);
  assert.strictEqual(WG.decide('https://evil.example/', Object.assign({ resolved }, ctx2)).reason, 'REBIND');
  assert.deepStrictEqual(WG.decide('https://good.example/', Object.assign({ resolved: new Map([['good.example', ['93.184.216.34']]]) }, ctx2)), { ok: true });
});

test('bekçi: sayfanın pencere ayarları sertleştirilmiş', () => {
  const p = WG.webPreferences();
  assert.strictEqual(p.partition, WG.PARTITION);
  for (const [k, v] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, plugins: false, devTools: false, disableDialogs: true, navigateOnDragDrop: false })) {
    assert.strictEqual(p[k], v, k);
  }
  assert.strictEqual(p.preload, undefined, 'önyükleme betiği yok');
  const withSes = WG.webPreferences({ session: {} });
  assert.strictEqual('partition' in withSes, false, 'oturum verilince bölüm adı düşer');
  assert.strictEqual(WG.cleanUserAgent('Mozilla/5.0 (X) AppleWebKit/537.36 Chrome/140.0 cayadev-visualizer/3.1.6 Electron/44.9.0 Safari/537.36'),
    'Mozilla/5.0 (X) AppleWebKit/537.36 Chrome/140.0 Safari/537.36');
  assert.strictEqual(WG.safeUrl('https://site.org/path?token=abc'), 'https://site.org', 'günlüğe yalnız köken');
});

function fakeSession() {
  const s = new EventEmitter();
  s.h = {};
  s.setPermissionRequestHandler = (f) => { s.h.req = f; };
  s.setPermissionCheckHandler = (f) => { s.h.check = f; };
  s.setDevicePermissionHandler = (f) => { s.h.device = f; };
  s.setDisplayMediaRequestHandler = (f) => { s.h.display = f; };
  s.setBluetoothPairingHandler = (f) => { s.h.bt = f; };
  s.setSpellCheckerEnabled = () => {};
  s.getUserAgent = () => 'Mozilla/5.0 Chrome/140 Electron/44.9.0';
  s.setUserAgent = (ua) => { s.ua = ua; };
  s.resolveHost = (h) => Promise.resolve({ endpoints: [{ address: h === 'rebind.test' ? '10.0.0.5' : '93.184.216.34' }] });
  s.webRequest = { onBeforeRequest: (_f, cb) => { s.h.before = cb; } };
  return s;
}

test('bekçi: oturum her izni, aygıtı, ekran paylaşımını ve indirmeyi reddediyor', async () => {
  const ses = fakeSession();
  const blocked = [];
  WG.hardenSession(ses, () => ({ allowedLocal: new Set(), appPorts: new Set([8722]) }), (b) => blocked.push(b.reason));
  for (const perm of ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'fullscreen', 'openExternal', 'pointerLock']) {
    let got = null;
    ses.h.req(null, perm, (v) => { got = v; });
    assert.strictEqual(got, false, perm);
  }
  assert.strictEqual(ses.h.check(), false);
  assert.strictEqual(ses.h.device(), false);
  let shared = null;
  ses.h.display({}, (v) => { shared = v; });
  assert.deepStrictEqual(shared, {}, 'ekran paylaşımı boş yanıtla reddedilir');
  for (const ev of ['select-hid-device', 'select-serial-port']) {
    let prevented = false;
    let picked = 'x';
    ses.emit(ev, { preventDefault: () => { prevented = true; } }, {}, (v) => { picked = v; });
    assert.strictEqual(prevented, true, ev);
    assert.strictEqual(picked, '', ev);
  }
  let cancelled = false;
  let prevented = false;
  ses.emit('will-download', { preventDefault: () => { prevented = true; } }, { cancel: () => { cancelled = true; }, getURL: () => 'https://x.org/f.exe' });
  assert.ok(prevented && cancelled, 'indirme iptal');
  assert.ok(!/Electron/.test(ses.ua));
  const ask = (url) => new Promise((r) => ses.h.before({ url, webContentsId: 1 }, r));
  assert.deepStrictEqual(await ask('http://127.0.0.1:8722/'), { cancel: true });
  assert.deepStrictEqual(await ask('http://192.168.0.1/'), { cancel: true });
  assert.deepStrictEqual(await ask('https://rebind.test/'), { cancel: true }, 'genel ad yerel adrese çözülüyor');
  assert.deepStrictEqual(await ask('https://example.org/'), {});
  assert.deepStrictEqual(blocked, ['DOWNLOAD', 'APP_PORT', 'LOCAL', 'REBIND']);
  WG.hardenSession(ses, () => ({}));
  assert.strictEqual(ses.listenerCount('will-download'), 1, 'iki kez sertleştirilmez');
});

function fakeContents() {
  const wc = new EventEmitter();
  wc.setWindowOpenHandler = (h) => { wc.open = h; };
  return wc;
}

test('bekçi: gezinme, iç çerçeve, açılır pencere, sayfadan çıkış engeli', () => {
  const ctx = () => ({ allowedLocal: new Set(), appPorts: new Set([8722]) });
  const blocked = [];
  const wc = WG.guardContents(fakeContents(), ctx, { onBlocked: (b) => blocked.push(b.reason) });
  const nav = (ev, url) => {
    let stopped = false;
    const e = { preventDefault: () => { stopped = true; }, url };
    wc.emit(ev, e, url);
    return stopped;
  };
  assert.strictEqual(nav('will-navigate', 'https://example.com/b'), false);
  assert.strictEqual(nav('will-navigate', 'file:///C:/Windows/win.ini'), true);
  assert.strictEqual(nav('will-navigate', 'sv-media://local/x'), true);
  assert.strictEqual(nav('will-redirect', 'http://127.0.0.1:8722/'), true);
  assert.strictEqual(nav('will-navigate', 'data:text/html,<script>1</script>'), true, 'üst çerçevede data: yok');
  assert.strictEqual(nav('will-frame-navigate', 'https://cdn.example/x'), false);
  assert.strictEqual(nav('will-frame-navigate', 'about:blank'), false);
  assert.strictEqual(nav('will-frame-navigate', 'http://10.0.0.1/admin'), true);
  assert.deepStrictEqual(wc.open({ url: 'https://example.com/' }), { action: 'deny' });
  let kept = true;
  wc.emit('will-prevent-unload', { preventDefault: () => { kept = false; } });
  assert.strictEqual(kept, false, 'beforeunload sayfayı tutamaz');
  assert.ok(blocked.includes('POPUP'));
  // Etkileşim penceresinde oturum açma pencereleri, aynı kurallarla
  const iw = WG.guardContents(fakeContents(), ctx, { allowPopups: true });
  const r = iw.open({ url: 'https://accounts.example/login' });
  assert.strictEqual(r.action, 'allow');
  assert.strictEqual(r.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  assert.strictEqual(r.overrideBrowserWindowOptions.webPreferences.partition, WG.PARTITION);
  assert.deepStrictEqual(iw.open({ url: 'http://192.168.1.1/' }), { action: 'deny' });
  assert.deepStrictEqual(iw.open({ url: 'file:///C:/x' }), { action: 'deny' });
});

test('bekçi: istemci sertifikası ve HTTP kimliği yalnız web katmanına verilmez; WebRTC yerel IP vermez', () => {
  const app = new EventEmitter();
  const web = { id: 1 };
  const own = { id: 2 };
  WG.guardApp(app, (wc) => wc === web);
  const ask = (ev, wc) => {
    let prevented = false;
    let called = null;
    app.emit(ev, { preventDefault: () => { prevented = true; } }, wc, 'https://x.org/', [{ subjectName: 'ben' }], (...a) => { called = a; });
    return { prevented, called };
  };
  assert.deepStrictEqual(ask('select-client-certificate', web), { prevented: true, called: [] }, 'sertifika verilmedi');
  assert.deepStrictEqual(ask('select-client-certificate', own), { prevented: false, called: null }, 'uygulama sayfası olağan akışta');
  assert.deepStrictEqual(ask('login', web), { prevented: true, called: [] });
  const wc = fakeContents();
  wc.setWebRTCIPHandlingPolicy = (p) => { wc.rtc = p; };
  WG.guardContents(wc, () => ({}), {});
  assert.strictEqual(wc.rtc, 'default_public_interface_only');
  assert.match(read('src/main/main.js'), /require\('\.\/web-layer-guard'\)\.guardApp\(app, /);
});

// --------------------------------------------------------------- dağıtıcı

/* Sahte GPU: içe alınan her doku sayılır; bırakılmayan kalırsa sızıntı. */
function fakeGpu(opts) {
  const o = opts || {};
  const g = { imported: 0, released: 0, sent: [], failImport: 0, pending: [] };
  g.importSharedTexture = (options) => {
    if (g.failImport > 0) { g.failImport--; throw new Error('import failed'); }
    g.imported++;
    let done = false;
    return {
      release() {
        if (done) throw new Error('çift bırakma');
        done = true;
        g.released++;
        if (options.allReferencesReleased) options.allReferencesReleased();
      },
    };
  };
  g.sendSharedTexture = (opt, meta) => {
    g.sent.push({ frame: opt.frame, meta });
    if (o.hold) return new Promise((res) => g.pending.push(res));
    return Promise.resolve();
  };
  return g;
}

function fakeBridge() {
  const b = { closed: 0, receivers: [], frames: 0, online: true, names: ['TD', 'CAYADEV Visualizer'] };
  b.TextureReceiver = class {
    /* Ölçülen davranış (texture-bridge 0.15.0): yeni alıcı ilk alma
       çağrısına kadar bağlı değil; bağlı değilken hasNewFrame true, alma
       hata fırlatır ya da (gönderici açıksa) bağlanıp null döner. */
    constructor(name) { this.name = name; this.newFrame = false; this.stopped = false; this.connected = false; b.receivers.push(this); }
    hasNewFrame() { return this.connected ? this.newFrame : true; }
    isConnected() { return this.connected; }
    receiveSharedTexture() {
      if (!this.connected) {
        // Bağlantısı kopmuş (dead) alıcı gönderici dönse de bağlanamıyor
        if (!this.dead && b.online && b.names.indexOf(this.name) >= 0) { this.connected = true; return null; }
        throw new Error('Shared texture receiver is not connected');
      }
      this.newFrame = false;
      b.frames++;
      return { width: 640, height: 360, pixelFormat: 'bgra', ownerPid: 1, handle: Buffer.alloc(8) };
    }
    receiveFrame() { this.newFrame = false; return { width: 2, height: 1, data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) }; }
    stop() { this.stopped = true; }
  };
  b.closeNativeHandle = () => { b.closed++; };
  b.listSenders = () => b.names.map((name) => ({ name }));
  return b;
}

let wcSeq = 0;
function fakeConsumer() {
  const wc = new EventEmitter();
  wc.id = ++wcSeq;
  wc.mainFrame = { id: wc.id };
  wc.destroyed = false;
  wc.isDestroyed = () => wc.destroyed;
  wc.sentMsgs = [];
  wc.send = (ch, m) => wc.sentMsgs.push([ch, m]);
  return wc;
}

const flush = () => new Promise((r) => setImmediate(r));
const inputCfg = (extra) => ({ layers: [Object.assign({ id: 'L', kind: 'input', settings: { input: { sender: 'TD' } } }, extra || {})] });

function hub(gpu, bridge, extra) {
  return LS.create(Object.assign({
    electron: { BrowserWindow: function () { throw new Error('web penceresi beklenmiyordu'); }, session: { fromPartition: () => fakeSession() } },
    sharedTexture: gpu,
    loadBridge: () => bridge,
    platform: 'win32',
    ownSenderNames: () => ['CAYADEV Visualizer'],
  }, extra || {}));
}

test('dağıtıcı: kare her pencereye gider, doku hepsi bitince bir kez bırakılır', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const gpu = fakeGpu();
  const br = fakeBridge();
  const h = hub(gpu, br);
  const a = fakeConsumer();
  const b = fakeConsumer();
  h.addConsumer(a, { gpu: true });
  h.addConsumer(b, { gpu: true });
  h.sync(inputCfg());
  const rx = br.receivers[0];
  assert.strictEqual(rx.name, 'TD');
  rx.newFrame = true;
  t.mock.timers.tick(20);
  await flush();
  assert.strictEqual(gpu.imported, 1);
  assert.deepStrictEqual(gpu.sent.map((s) => s.frame.id), [a.id, b.id]);
  assert.strictEqual(gpu.sent[0].meta.key, SL.sourceKey(inputCfg().layers[0]));
  assert.strictEqual(gpu.sent[0].meta.opaque, true, 'saydamlık varsayılan atılır');
  assert.strictEqual(gpu.released, 1);
  /* Electron içe alırken tutamacın kopyasını alıyor; aslı bizde kalıyor.
     Kapatılmazsa kare başına bir tutamaç sızıyordu (20 dk: 3412 -> 85 893). */
  assert.strictEqual(br.closed, 1, 'içe alınan tutamaç da kapatıldı');
  assert.strictEqual(h.status()[gpu.sent[0].meta.key].state, 'live');
  h.shutdown();
  assert.strictEqual(rx.stopped, true);
});

test('dağıtıcı: pencere yoksa kare alınmaz; içe alınamayan tutamaç kapatılır; üçüncüde bit eşleme geçilir', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const gpu = fakeGpu();
  const br = fakeBridge();
  const h = hub(gpu, br);
  h.sync(inputCfg());
  const rx = br.receivers[0];
  rx.newFrame = true;
  t.mock.timers.tick(20);
  assert.strictEqual(br.frames, 0, 'tüketici yokken kare beklesin');
  const c = fakeConsumer();
  h.addConsumer(c, { gpu: true });
  gpu.failImport = 3;
  for (let i = 0; i < 3; i++) { rx.newFrame = true; t.mock.timers.tick(10); }
  assert.strictEqual(br.closed, 3, 'her başarısız içe alımda tutamaç kapandı');
  assert.strictEqual(gpu.imported, 0);
  rx.newFrame = true;
  t.mock.timers.tick(40);
  const bm = c.sentMsgs.filter((m) => m[0] === 'sources:bitmap');
  assert.strictEqual(bm.length, 1, 'bit eşlem yolu');
  assert.strictEqual(bm[0][1].format, 'bgra', 'Windows\'ta ölçülen bayt sırası');
  assert.strictEqual(h.status()[SL.sourceKey(inputCfg().layers[0])].path, 'cpu');
  h.shutdown();
});

test('dağıtıcı: önceki kareyi almamış pencere atlanır (geri baskı)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const gpu = fakeGpu({ hold: true });
  const br = fakeBridge();
  const h = hub(gpu, br);
  const c = fakeConsumer();
  h.addConsumer(c, { gpu: true });
  h.sync(inputCfg());
  const rx = br.receivers[0];
  rx.newFrame = true;
  t.mock.timers.tick(10);
  rx.newFrame = true;
  t.mock.timers.tick(10);
  assert.strictEqual(gpu.sent.length, 1, 'ikinci kare yolda olanı beklemedi, atlandı');
  assert.strictEqual(br.frames, 1, 'atlanan kare göndericiden alınmadı bile');
  gpu.pending.shift()();
  await flush();
  await flush();
  assert.strictEqual(gpu.released, 1);
  rx.newFrame = true;
  t.mock.timers.tick(10);
  assert.strictEqual(gpu.sent.length, 2);
  gpu.pending.shift()();
  await flush();
  h.shutdown();
});

test('dağıtıcı: sessiz katman kare üretmez; sahneden çıkan kaynak geçiş süresi bekler', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const gpu = fakeGpu();
  const br = fakeBridge();
  const h = hub(gpu, br);
  const c = fakeConsumer();
  h.addConsumer(c, { gpu: true });
  h.sync(inputCfg({ muted: true }));
  const rx = br.receivers[0];
  rx.newFrame = true;
  t.mock.timers.tick(20);
  assert.strictEqual(gpu.imported, 0);
  h.sync({ layers: [] });
  t.mock.timers.tick(LS.GRACE_MS - 10);
  assert.strictEqual(rx.stopped, false, 'geçiş sürerken açık');
  h.sync(inputCfg());
  t.mock.timers.tick(LS.GRACE_MS + 10);
  assert.strictEqual(rx.stopped, false, 'geri gelen katman kaynağı korudu');
  h.sync({ layers: [] });
  t.mock.timers.tick(LS.GRACE_MS + 10);
  assert.strictEqual(rx.stopped, true);
  assert.ok(c.sentMsgs.some((m) => m[0] === 'sources:drop'), 'pencerelerdeki tuval atıldı');
  h.shutdown();
});

test('dağıtıcı: kapanan ya da yenilenen pencereye kare gitmez', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const gpu = fakeGpu();
  const br = fakeBridge();
  const h = hub(gpu, br);
  const c = fakeConsumer();
  h.addConsumer(c, { gpu: true });
  h.sync(inputCfg());
  c.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  const rx = br.receivers[0];
  rx.newFrame = true;
  t.mock.timers.tick(20);
  assert.strictEqual(gpu.sent.length, 0, 'yeniden yüklenen sayfa alıcısını kurana dek');
  h.addConsumer(c, { gpu: true }); // önyükleme yeniden "merhaba" der
  rx.newFrame = true;
  t.mock.timers.tick(20);
  await flush();
  assert.strictEqual(gpu.sent.length, 1);
  c.destroyed = true;
  c.emit('destroyed');
  rx.newFrame = true;
  t.mock.timers.tick(20);
  assert.strictEqual(gpu.sent.length, 1);
  h.shutdown();
});

test('dağıtıcı: Linux\'ta giriş katmanı yok, gönderici listesi kendi çıkışını ayırıyor', () => {
  const h = hub(fakeGpu(), null, { platform: 'linux' });
  assert.strictEqual(h.available().input, false);
  h.sync(inputCfg());
  const st = h.status()[SL.sourceKey(inputCfg().layers[0])];
  assert.strictEqual(st.state, 'error');
  assert.strictEqual(st.error, 'UNSUPPORTED_PLATFORM');
  h.shutdown();
  const h2 = hub(fakeGpu(), fakeBridge());
  assert.deepStrictEqual(h2.listSenders().others.map((x) => x.name), ['TD']);
  assert.deepStrictEqual(h2.listSenders().mine.map((x) => x.name), ['CAYADEV Visualizer']);
});

test('dağıtıcı: gönderici sonradan açılınca bağlanır; kapanıp açılınca alıcı yenilenir; _1 ekli ad bulunur', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  /* Sahte saat tek bir büyük adımda zamanlayıcıları aynı Date ile
     çalıştırıyor; gerçek akış gibi küçük adımlarla ilerlet. */
  const run = (ms) => { for (let x = 0; x < ms; x += 10) t.mock.timers.tick(10); };
  const gpu = fakeGpu();
  const br = fakeBridge();
  br.names = [];
  const h = hub(gpu, br);
  h.addConsumer(fakeConsumer(), { gpu: true });
  h.sync(inputCfg());
  run(3000);
  assert.strictEqual(br.receivers.length, 0, 'gönderici listede yokken alıcı kurulmaz');
  const key = SL.sourceKey(inputCfg().layers[0]);
  assert.strictEqual(h.status()[key].state, 'waiting');
  br.names = ['TD'];
  run(300);
  assert.strictEqual(br.receivers.length, 1);
  const rx = br.receivers[0];
  assert.strictEqual(rx.connected, true, 'ilk alma çağrısı bağlantıyı kurdu');
  rx.newFrame = true;
  run(20);
  assert.strictEqual(h.status()[key].state, 'live');
  assert.strictEqual(gpu.imported, 1);
  // Gönderici kapanıp yeniden açılır: eski alıcı bağlanamaz, 2 sn sonra yenisi
  rx.connected = false;
  rx.dead = true;
  br.online = false;
  run(20);
  assert.strictEqual(h.status()[key].state, 'waiting');
  br.online = true;
  run(2600);
  assert.strictEqual(br.receivers.length, 2);
  assert.strictEqual(rx.stopped, true, 'eski alıcı bırakıldı');
  assert.strictEqual(br.receivers[1].connected, true);
  // Çökmüş göndericinin kaydı asılı kaldı: yeni kopya `TD_1` adıyla geldi
  br.receivers[1].connected = false;
  br.receivers[1].dead = true;
  br.names = ['TD_1', 'Başka'];
  run(300);
  const last = br.receivers[br.receivers.length - 1];
  assert.strictEqual(last.name, 'TD_1');
  assert.strictEqual(h.status()[key].actual, 'TD_1');
  // İki ekli aday varsa tahmin edilmez
  last.connected = false;
  last.dead = true;
  br.names = ['TD_1', 'TD_2'];
  const before = br.receivers.length;
  run(3000);
  assert.strictEqual(br.receivers.length, before);
  h.shutdown();
});

/* Sahte görünmez pencere: paint olayını test sürer. */
function fakeWindowClass(log) {
  return class FakeWin extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.destroyed = false;
      const wc = new EventEmitter();
      wc.id = 1000 + log.windows.length;
      wc.painting = false;
      wc.muted = null;
      wc.loaded = [];
      wc.setWindowOpenHandler = () => {};
      wc.setAudioMuted = (m) => { wc.muted = m; };
      wc.setBackgroundThrottling = () => {};
      wc.setFrameRate = (f) => { wc.fps = f; };
      wc.loadURL = (u) => { wc.loaded.push(u); return Promise.resolve(); };
      wc.startPainting = () => { wc.painting = true; };
      wc.stopPainting = () => { wc.painting = false; };
      wc.invalidate = () => {};
      wc.insertCSS = (css) => { wc.css = css; return Promise.resolve('k'); };
      wc.removeInsertedCSS = () => Promise.resolve();
      wc.getURL = () => wc.loaded[wc.loaded.length - 1] || '';
      wc.reload = () => { wc.reloaded = (wc.reloaded || 0) + 1; };
      wc.reloadIgnoringCache = wc.reload;
      wc.setZoomFactor = (z) => { wc.zoom = z; };
      this.webContents = wc;
      log.windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    setContentSize(w, h) { this.size = [w, h]; }
    focus() {}
  };
}

function webHub(gpu, log, extra) {
  return LS.create(Object.assign({
    electron: { BrowserWindow: fakeWindowClass(log), session: { fromPartition: () => fakeSession() } },
    sharedTexture: gpu,
    loadBridge: () => null,
    platform: 'win32',
    appPorts: () => [8722],
  }, extra || {}));
}
const webCfg = (url, extra) => ({ layers: [{ id: 'W', kind: 'web', settings: { web: Object.assign({ url }, extra || {}) } }] });

test('web: sayfa korumalı pencerede açılır; dokusu her yolda bırakılır', async () => {
  const gpu = fakeGpu();
  const log = { windows: [] };
  const h = webHub(gpu, log);
  h.sync(webCfg('https://example.org/overlay', { fps: 15 }));
  const win = log.windows[0];
  const wp = win.opts.webPreferences;
  assert.strictEqual(win.opts.show, false);
  assert.strictEqual(wp.sandbox, true);
  assert.strictEqual(wp.preload, undefined);
  assert.strictEqual(wp.devTools, false);
  assert.deepStrictEqual(wp.offscreen, { useSharedTexture: true });
  assert.strictEqual(win.webContents.muted, true, 'ses varsayılan kapalı');
  assert.strictEqual(win.webContents.fps, 15);
  assert.deepStrictEqual(win.webContents.loaded, ['https://example.org/overlay']);
  const tex = () => {
    const t = { released: 0, textureInfo: { codedSize: { width: 1920, height: 1080 } }, release() { t.released++; } };
    return t;
  };
  // Tüketici yok: doku hemen bırakılır, içe alınmaz
  const t1 = tex();
  win.webContents.emit('paint', { texture: t1 });
  assert.strictEqual(t1.released, 1);
  assert.strictEqual(gpu.imported, 0);
  // Tüketici var: içe alınır, gönderilir, son başvuru bırakılınca paint dokusu da
  const c = fakeConsumer();
  h.addConsumer(c, { gpu: true });
  const t2 = tex();
  win.webContents.emit('paint', { texture: t2 });
  await flush();
  await flush();
  assert.strictEqual(gpu.imported, 1);
  assert.strictEqual(gpu.released, 1);
  assert.strictEqual(t2.released, 1);
  assert.strictEqual(gpu.sent[0].meta.opaque, false, 'saydam sayfa saydam gider');
  // İçe alma patlarsa doku yine bırakılır
  gpu.failImport = 1;
  const t3 = tex();
  win.webContents.emit('paint', { texture: t3 });
  assert.strictEqual(t3.released, 1);
  // Katman sessiz: boyama durur, doku yine bırakılır
  const muted = webCfg('https://example.org/overlay', { fps: 15 });
  muted.layers[0].muted = true;
  h.sync(muted);
  assert.strictEqual(win.webContents.painting, false);
  const t4 = tex();
  win.webContents.emit('paint', { texture: t4 });
  assert.strictEqual(t4.released, 1);
  h.shutdown();
  assert.strictEqual(win.destroyed, true);
});

test('web: geçersiz ya da yasak adres pencere açmaz, nedenini söyler', () => {
  const log = { windows: [] };
  const h = webHub(fakeGpu(), log);
  h.sync(webCfg('file:///C:/Windows/win.ini'));
  assert.strictEqual(log.windows.length, 0);
  assert.strictEqual(h.status()['web:W'].error, 'SCHEME');
  h.sync(webCfg('http://127.0.0.1:8722/'));
  assert.strictEqual(log.windows.length, 0);
  assert.strictEqual(h.status()['web:W'].error, 'APP_PORT');
  h.sync(webCfg('http://127.0.0.1:5000/'));
  assert.strictEqual(log.windows.length, 1, 'yazılan yerel adres açılır');
  h.shutdown();
});

test('web: ayar değişince sayfa yeniden kurulmaz; saydamlık ve adres değişince kurulur', () => {
  const log = { windows: [] };
  const h = webHub(fakeGpu(), log);
  h.sync(webCfg('https://a.org/'));
  h.sync(webCfg('https://a.org/', { fps: 60, zoom: 1.5, audio: true, width: 1280, height: 720 }));
  assert.strictEqual(log.windows.length, 1);
  const wc = log.windows[0].webContents;
  assert.deepStrictEqual([wc.fps, wc.zoom, wc.muted, log.windows[0].size], [60, 1.5, false, [1280, 720]]);
  h.sync(webCfg('https://a.org/', { transparent: false, fps: 60, zoom: 1.5, audio: true, width: 1280, height: 720 }));
  assert.strictEqual(log.windows.length, 2, 'saydamlık pencerenin doğuşunda');
  assert.strictEqual(log.windows[0].destroyed, true);
  h.sync(webCfg('https://b.org/', { transparent: false }));
  assert.strictEqual(log.windows.length, 3);
  h.shutdown();
});

test('web: çöken sayfa artan aralıkla yeniden açılır, sonunda vazgeçer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const log = { windows: [] };
  const h = webHub(fakeGpu(), log);
  h.sync(webCfg('https://a.org/'));
  let waits = 0;
  const backoff = [1000, 2000, 4000, 8000, 16000, 30000];
  for (let i = 0; i < 6; i++) {
    const w = log.windows[log.windows.length - 1];
    w.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.strictEqual(h.status()['web:W'].state, 'crashed');
    const before = log.windows.length;
    t.mock.timers.tick(backoff[i] - 1);
    assert.strictEqual(log.windows.length, before, 'bekleme bitmeden açılmaz (' + i + ')');
    t.mock.timers.tick(1);
    assert.strictEqual(log.windows.length, before + 1);
    waits++;
  }
  log.windows[log.windows.length - 1].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.strictEqual(h.status()['web:W'].state, 'failed');
  assert.strictEqual(waits, 6);
  h.reloadWeb('W');
  assert.strictEqual(log.windows.length, 8, 'elle yeniden yükleme sayacı sıfırlar');
  h.shutdown();
});

test('web: sayfa kendi penceresini kapatamaz; pencere yine giderse yeniden kurulur', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const log = { windows: [] };
  const h = webHub(fakeGpu(), log);
  h.sync(webCfg('https://a.org/'));
  const w = log.windows[0];
  let prevented = false;
  w.emit('close', { preventDefault: () => { prevented = true; } });
  assert.strictEqual(prevented, true, 'window.close() reddedildi');
  w.emit('closed');
  assert.strictEqual(h.status()['web:W'].state, 'crashed', 'donmuş kare "yüklendi" görünmez');
  t.mock.timers.tick(1000);
  assert.strictEqual(log.windows.length, 2);
  h.shutdown();
  assert.strictEqual(log.windows[1].destroyed, true);
  assert.strictEqual(log.windows.length, 2, 'kendi kapatmamız yeniden kurdurmaz');
});

test('web: Linux\'ta bit eşlem yolu, BGRA bayt sırasıyla', () => {
  const log = { windows: [] };
  const h = webHub(fakeGpu(), log, { platform: 'linux' });
  h.sync(webCfg('https://a.org/', { transparent: false }));
  const win = log.windows[0];
  assert.strictEqual(win.opts.webPreferences.offscreen, true);
  const c = fakeConsumer();
  h.addConsumer(c, { gpu: false });
  win.webContents.emit('paint', {}, {}, { getSize: () => ({ width: 2, height: 1 }), toBitmap: () => Buffer.alloc(8) });
  const bm = c.sentMsgs.find((m) => m[0] === 'sources:bitmap');
  assert.ok(bm);
  assert.strictEqual(bm[1].format, 'bgra');
  assert.strictEqual(bm[1].opaque, true);
  h.shutdown();
});

// ------------------------------------------------------- kaynağa bakan denetim

test('önyükleme bloğu üç dosyada aynı, yalnız electron require ediliyor', () => {
  const block = (f) => {
    const s = read('src/main/' + f).replace(/\r\n/g, '\n');
    const a = s.indexOf('/* ==== DIŞ KAYNAK KARELERİ');
    const b = s.indexOf('/* ==== DIŞ KAYNAK KARELERİ SONU ==== */');
    assert.ok(a > 0 && b > a, f);
    return { body: s.slice(a, b), src: s };
  };
  const v = block('preload-visualizer.js');
  for (const f of ['preload-admin.js', 'preload-exporter.js']) {
    const o = block(f);
    assert.strictEqual(o.body, v.body, f + ' bloğu ayrıştı');
    assert.strictEqual((o.src.match(/require\(/g) || []).length, 1, f);
  }
  assert.match(v.body, /vf\.close\(\)/);
  assert.match(v.body, /imp\.release\(\)/);
  assert.match(v.body, /sources:hello/);
});

test('katman motoru, panel, sayfalar ve ana süreç yeni türleri tanıyor', () => {
  const layers = read('src/visualizer/layers.js');
  assert.match(layers, /const KINDS = \[[^\]]*'input', 'web'\]/);
  for (const page of ['src/visualizer/index.html', 'src/admin/index.html', 'src/exporter/index.html', 'src/web/overlay.html']) {
    const s = read(page);
    assert.ok(s.indexOf('shared/source-layers.js') > 0 && s.indexOf('modes/source.js') > 0, page);
  }
  const panels = read('src/admin/scene-panels.js');
  assert.match(panels, /\['web', 'Web Sayfası'\]/);
  assert.match(panels, /'Spout Girişi'/);
  const main = read('src/main/main.js');
  assert.match(main, /syncTextureShare\(\);\n    syncLayerSources\(\);/);
  assert.match(main, /syncTextureShare\(\)\.catch\(\(\) => \{\}\);\n  syncLayerSources\(\);/);
  assert.match(main, /if \(layerSources\) layerSources\.shutdown\(\);/);
});

/* Gerçek yerel modül. CI'da macOS'ta Syphon, Windows'ta Spout yükleniyor mu
   ve alıcı kurulup durdurulabiliyor mu. Linux'ta modül yok. */
test('yerel modül: alıcı bu platformda kurulabiliyor', { skip: process.platform === 'linux' }, () => {
  let b;
  try {
    b = require('@napolab/texture-bridge');
  } catch (e) {
    assert.fail('texture-bridge yüklenemedi: ' + e.message);
  }
  assert.ok(Array.isArray(b.listSenders()));
  const rx = new b.TextureReceiver('sv-test-yok-' + process.pid, null, null);
  /* Göndericisi olmayan alıcı: bağlı değil; kare istemek hata fırlatıyor
     (dağıtıcı bu yüzden önce isConnected'a bakıyor). */
  assert.strictEqual(rx.isConnected(), false);
  assert.throws(() => rx.receiveSharedTexture(), /not connected/);
  rx.stop();
  rx.stop();
  assert.strictEqual(rx.hasNewFrame(), false, 'durduktan sonra güvenli');
  assert.strictEqual(typeof b.closeNativeHandle, 'function');
});
