'use strict';
/* Ekran kaynağı: platform kuralı, web katmanının reddi, medya dalı, panel ve çeviri. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SC = require('../src/shared/screen-capture.js');
const WG = require('../src/main/web-layer-guard.js');

test('destek: Windows, macOS ve Linux X11 olur', () => {
  assert.deepStrictEqual(SC.support({ platform: 'win32' }), { ok: true });
  assert.deepStrictEqual(SC.support({ platform: 'darwin' }), { ok: true });
  assert.deepStrictEqual(SC.support({ platform: 'linux', display: ':0', session: 'x11' }), { ok: true });
  assert.deepStrictEqual(SC.support({ platform: 'linux', session: 'x11' }), { ok: true }, 'oturum x11, DISPLAY şart değil');
  assert.deepStrictEqual(SC.support({ platform: 'linux', display: ':0', session: 'wayland', wayland: 'wayland-0' }), { ok: true }, 'DISPLAY varsa X11 ekranı var');
});

test('destek: DISPLAY\'siz Wayland ve bilinmeyen platform olmaz', () => {
  const way = SC.support({ platform: 'linux', display: '', session: 'wayland', wayland: 'wayland-0' });
  assert.strictEqual(way.ok, false);
  assert.strictEqual(way.reason, 'wayland');
  const bare = SC.support({ platform: 'linux', session: 'wayland' });
  assert.deepStrictEqual(bare, { ok: false, reason: 'wayland' });
  const unk = SC.support({ platform: 'freebsd' });
  assert.strictEqual(unk.ok, false);
  assert.strictEqual(unk.reason, 'platform');
  assert.strictEqual(SC.support({}).reason, 'platform');
});

test('faultText Wayland ve izin için boş olmayan Türkçe cümle', () => {
  for (const reason of ['wayland', 'permission']) {
    const text = SC.faultText(reason);
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 12, reason);
    assert.match(text, /[çğıöşüÇĞİÖŞÜ]/, reason);
    assert.match(text, /[.]$/, reason);
  }
  assert.notStrictEqual(SC.faultText('wayland'), SC.faultText('permission'));
  assert.match(SC.faultText('platform'), /[çğıöşüÇĞİÖŞÜ]/);
});

test('modül Electron istemez', () => {
  assert.doesNotMatch(read('src/shared/screen-capture.js'), /require\(['"]electron['"]\)/);
  assert.doesNotMatch(read('src/shared/screen-capture.js'), /desktopCapturer/);
});

test('web katmanı ekran paylaşımını hâlâ reddediyor', () => {
  const src = read('src/main/web-layer-guard.js');
  assert.ok(src.includes('setDisplayMediaRequestHandler((_req, cb) => { try { cb({}); } catch { /* reddedildi */ } });'));
  const ses = new EventEmitter();
  let handler = null;
  ses.setPermissionRequestHandler = () => {};
  ses.setPermissionCheckHandler = () => {};
  ses.setDevicePermissionHandler = () => {};
  ses.setDisplayMediaRequestHandler = (f) => { handler = f; };
  ses.setSpellCheckerEnabled = () => {};
  ses.getUserAgent = () => 'Mozilla/5.0';
  ses.setUserAgent = () => {};
  ses.webRequest = { onBeforeRequest() {} };
  WG.hardenSession(ses, () => ({}));
  let got = 'bekliyor';
  handler({}, (v) => { got = v; });
  assert.deepStrictEqual(got, {});
});

test('medya katmanı ekranı web kamerası getUserMedia yolundan önce ayırır', () => {
  const src = read('src/visualizer/modes/media.js');
  const branch = src.indexOf("if (cfg.source === 'screen')");
  const cam = src.indexOf('getUserMedia(constraints)');
  assert.ok(branch > 0 && cam > branch, 'ekran dalı web kamerası getUserMedia çağrısından önce');
  assert.strictEqual((src.match(/\.getUserMedia\(/g) || []).length, 1);
  assert.match(src, /chromeMediaSource:\s*'desktop'/);
  assert.match(src, /chromeMediaSourceId:\s*want/);
  assert.match(src, /screenSources/);
  assert.match(src, /this\.error = screenFaultText\(/);
});

test('api yokken ekran kaynağı hata yazar ve fırlatmaz', () => {
  const { Media, calls } = loadMedia(null);
  const m = new Media();
  assert.doesNotThrow(() => m.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0' }));
  assert.strictEqual(m.error, SC.faultText('platform'));
  assert.strictEqual(m.ready, false);
  assert.strictEqual(calls.length, 0);
});

test('seçilen ekran masaüstü kısıtıyla açılır, kamera kısıtıyla değil', async () => {
  const calls = [];
  const { Media } = loadMedia({
    screenSources: () => Promise.resolve({ ok: true, sources: [{ id: 'screen:0:0', name: 'Birinci' }, { id: 'window:4:0', name: 'Not' }] }),
  }, calls);
  const m = new Media();
  m.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0' });
  await flush();
  await flush();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].audio, false);
  assert.strictEqual(calls[0].video.mandatory.chromeMediaSource, 'desktop');
  assert.strictEqual(calls[0].video.mandatory.chromeMediaSourceId, 'screen:0:0');
  assert.notStrictEqual(calls[0].video, true);
  assert.strictEqual(m.ready, true);
  assert.strictEqual(m.error, null);
});

test('destek yok ve izin hatası Türkçe sebebe döner, fırlatmaz', async () => {
  const way = loadMedia({
    screenSources: () => Promise.resolve({ ok: false, reason: 'wayland' }),
  });
  const a = new way.Media();
  a.apply({ enabled: true, source: 'screen', screenId: 'screen:0:0' });
  await flush();
  assert.strictEqual(a.error, SC.faultText('wayland'));
  assert.strictEqual(way.calls.length, 0);

  const denied = loadMedia({
    screenSources: () => Promise.reject(new Error('denied')),
  });
  const b = new denied.Media();
  assert.doesNotThrow(() => b.apply({ enabled: true, source: 'screen', screenId: 'screen:1:0' }));
  await flush();
  await flush();
  assert.strictEqual(b.error, SC.faultText('permission'));
  assert.strictEqual(b.ready, false);
});

test('web kamerası ekran dalına düşmez', async () => {
  const { Media, calls } = loadMedia(null);
  const m = new Media();
  m.apply({ enabled: true, source: 'webcam', deviceId: 'cam-1' });
  await flush();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(JSON.stringify(calls[0]), JSON.stringify({ audio: false, video: { deviceId: { exact: 'cam-1' } } }));
});

test('panel ekran seçeneğini sunar ve seçilen kimliği saklar', () => {
  const src = read('src/admin/scene-panels.js');
  assert.match(src, /\['webcam', 'Web Kamerası'\],\s*\['file', 'Video Dosyası'\],\s*\['screen',\s*'Ekran'\]/);
  assert.match(src, /m\.screenId = v/);
  assert.match(src, /m\.deviceId = v \|\| 'screen:'/);
  assert.match(src, /screenSources/);
  assert.match(src, /screenFault/);
});

test('çeviri yeni cümleleri içeriyor', () => {
  const i18n = read('src/shared/i18n.js');
  for (const s of [
    SC.faultText('wayland'),
    SC.faultText('permission'),
    SC.faultText('platform'),
    'Ekran Kaynağı',
    'Ekranları Yenile',
    'Bir ekran veya pencere seçin.',
    'Seçilen ekran veya pencere bu katmana çizilir. Görüntü çıkışa, önizlemeye ve bağlı bir yayın sayfasına (OBS) gider. Düşük yenileme hızı yakalama yükünü azaltır. Wayland oturumunda bir X11 ekranı gerekir.',
  ]) {
    assert.ok(i18n.includes("'" + s + "':"), 'çevirisi yok: ' + s);
  }
});

test('güvenilen önyüklemeler aynı yöntemi açar, web ve dışa aktarıcı açmaz', () => {
  const line = "screenSources: () => ipcRenderer.invoke('media:screen-sources')";
  assert.ok(read('src/main/preload-admin.js').includes(line));
  assert.ok(read('src/main/preload-visualizer.js').includes(line));
  assert.doesNotMatch(read('src/web/web-shim.js'), /screenSources|media:screen-sources/);
  assert.doesNotMatch(read('src/main/preload-exporter.js'), /media:screen-sources/);
  assert.doesNotMatch(read('src/main/preload-thumbs.js'), /media:screen-sources/);
});

test('ana süreç desteği sorar, yakalama hatasını izin olarak döndürür', () => {
  const src = read('src/main/main.js');
  assert.match(src, /ipcMain\.handle\('media:screen-sources'/);
  assert.match(src, /screenCapture\.support\(\{/);
  assert.match(src, /desktopCapturer\.getSources\(\{[^}]*types:\s*\['screen',\s*'window'\][^}]*thumbnailSize:\s*\{\s*width:\s*0,\s*height:\s*0\s*\}/s);
  assert.match(src, /return \{ ok: false, reason: 'permission' \}/);
  assert.match(src, /return \{ ok: false, reason: sup\.reason/);
});

function flush() {
  return new Promise((r) => setImmediate(r));
}

function loadMedia(api, callsOut) {
  const calls = callsOut || [];
  const el = () => ({
    muted: false,
    playsInline: false,
    autoplay: false,
    crossOrigin: '',
    loop: false,
    src: '',
    srcObject: null,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    onerror: null,
    onloadeddata: null,
    removeAttribute() {},
    load() {},
    pause() {},
    play() { return Promise.resolve(); },
    getContext() { return {}; },
  });
  const ctx = {
    document: { createElement: el },
    location: { protocol: 'file:', search: '' },
    navigator: {
      mediaDevices: {
        getUserMedia(c) {
          calls.push(c);
          return Promise.resolve({ getTracks() { return [{ stop() {} }]; } });
        },
      },
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, Promise,
    fetch: () => Promise.resolve({ status: 200, body: { cancel() {} } }),
  };
  ctx.window = ctx;
  if (api) ctx.api = api;
  vm.createContext(ctx);
  vm.runInContext(read('src/visualizer/modes/media.js'), ctx);
  return { Media: ctx.SVMedia, calls, ctx };
}
