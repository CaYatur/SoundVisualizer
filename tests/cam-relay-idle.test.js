'use strict';
/* Kamera katmanı, bağlı bir yayın katmanı yokken JPEG kodlamaz (#695).

   Masaüstü penceresi kamera karesini her 80 ms'de bir JPEG'e çevirip ana
   sürece yolluyordu; OBS bağlı değilse ana süreç kareyi atıyordu. Canlı
   ölçümde 5 saniyede 62 kare (~920 KB) ve çekirdeğin yaklaşık %5'i boşa
   gidiyordu. Artık sahiplik yalnız bağlı bir katman varken verilir, pompa da
   sahipliği kaybedince durur. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMedia(api, timers) {
  const el = () => ({ muted: false, removeAttribute() {}, load() {}, getContext: () => ({}) });
  const ctx = {
    document: { createElement: el },
    location: { protocol: 'file:', search: '' },
    navigator: {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    URLSearchParams,
    Promise,
  };
  ctx.window = ctx;
  ctx.window.api = api;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'media.js'), 'utf8'), ctx);
  return ctx.SVMedia;
}

const flush = () => new Promise((r) => setImmediate(r));

test('yayın katmanı ayrılınca kamera pompası durur ve sahipliği bırakır', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let overlay = true;
  const released = [];
  const api = {
    claimCamRelay: () => Promise.resolve(overlay),
    releaseCamRelay: (k) => released.push(k),
    sendCamFrame: () => {},
  };
  const MediaLayer = loadMedia(api, { setTimeout, clearTimeout, setInterval, clearInterval });
  const m = new MediaLayer();
  m.key = 'k';
  m._deviceId = 'cam-1';
  m._startRelayPump('k');
  await flush();
  assert.ok(m._pump, 'katman bağlıyken pompa çalışmalı');

  overlay = false;
  t.mock.timers.tick(2000);
  await flush();
  assert.strictEqual(m._pump, null, 'katman yokken pompa durmalı');
  assert.deepStrictEqual(released, ['cam-1']);

  // Durduğu turda sonraki deneme hâlâ 2 sn sonraya kurulmuştu
  overlay = true;
  t.mock.timers.tick(2000);
  await flush();
  assert.ok(m._pump, 'katman geri gelince pompa yeniden başlamalı');
  m._stopRelay();
});

test('ana süreç bağlı yayın katmanı yokken sahiplik vermez', () => {
  const S = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'stream-server.js'), 'utf8');
  const at = S.indexOf('function claimCam(owner, key)');
  assert.ok(at > 0);
  const fn = S.slice(at, S.indexOf('\nfunction ', at + 10));
  assert.match(fn, /c\.kind === 'overlay'/);
  assert.match(fn, /if \(!overlay\) return false;/);
});
