'use strict';
/* OBS yayın katmanında medya.
 *
 * Katman videosu klasik cfg.media.file olmadığı için sunucu 404 dönüyordu.
 * Kamera kimliği masaüstüne aittir; OBS onu exact deviceId ile açamaz.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

global.window = global.window || {};
const S = require('../src/main/stream-server.js');
const mediaUrl = require('../src/shared/media-url.js');
require('../src/visualizer/modes/media.js');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('yayın sunucusu katmanın videosunu verir, yabancı yolu vermez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ovm-'));
  const file = path.join(dir, 'klip.mp4');
  const secret = path.join(dir, 'gizli.mp4');
  fs.writeFileSync(file, Buffer.from('katman-video'));
  fs.writeFileSync(secret, Buffer.from('olmaz'));
  const cfg = {
    media: { file: null },
    layers: [{ kind: 'media', settings: { media: { source: 'file', file: mediaUrl.toMediaUrl(file) } } }],
  };
  let port = 0;
  for (let i = 0; i < 20; i++) {
    const cand = 21000 + Math.floor(Math.random() * 20000);
    const st = await S.start({ enabled: true, port: cand, requireToken: false }, { getConfig: () => cfg });
    if (st.running) { port = cand; break; }
  }
  assert.ok(port, 'port');
  try {
    const url = mediaUrl.toMediaUrl(file);
    const ok = await get(port, '/media-file?v=' + encodeURIComponent(url));
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.toString('utf8'), 'katman-video');
    const denied = await get(port, '/media-file?v=' + encodeURIComponent(mediaUrl.toMediaUrl(secret)));
    assert.strictEqual(denied.status, 403);
    const src = window.SVOverlayMediaSrc(url, true, 'ovl');
    assert.ok(src.startsWith('/media-file?'), src);
    assert.ok(src.includes('v='), src);
    assert.strictEqual(window.SVOverlayMediaSrc('/media-file?token=ovl', true, 'ovl'), '/media-file?token=ovl');
  } finally {
    await S.stop();
  }
});

/* Ham WebSocket: Node 20'de yerleşik istemci yok. Yalnız metin çerçeveleri. */
function wsConnect(port, query) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws?' + query,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const msgs = [];
      const waiters = [];
      let buf = head && head.length ? head : Buffer.alloc(0);
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) msgs.push(JSON.parse(payload.toString('utf8')));
          while (waiters.length) waiters.shift()();
        }
      };
      socket.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
      pump();
      const next = (type, ms) => new Promise((resolve) => {
        const deadline = Date.now() + (ms || 1500);
        const look = () => {
          const i = msgs.findIndex((m) => m.type === type);
          if (i >= 0) { resolve(msgs.splice(i, 1)[0]); return; }
          const left = deadline - Date.now();
          if (left <= 0) { resolve(null); return; }
          const timer = setTimeout(look, left);
          waiters.push(() => { clearTimeout(timer); look(); });
        };
        look();
      });
      resolve({ socket, next });
    });
    req.on('response', (res) => reject(new Error('yükseltme yok: ' + res.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

test('OBS kamerayı tarayıcıdan açmaz, uygulamanın karesini alır', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'media.js'), 'utf8');
  assert.ok(!src.includes('_openWebCamera'), 'yayın sayfası hâlâ kendi kamerasını açıyor');
  assert.ok(!src.includes('SVWebCameraConstraints'));
  assert.strictEqual((src.match(/\.getUserMedia\(/g) || []).length, 1, 'getUserMedia yalnız masaüstünde kalmalı');
  assert.ok(src.includes('claimCamRelay'));

  /* Bağlı yayın katmanı yokken kimse kare kodlamamalı (#695) */
  assert.strictEqual(S.claimCam('pencere-a', 'cam-1'), false);

  let port = 0;
  for (let i = 0; i < 20; i++) {
    const cand = 21000 + Math.floor(Math.random() * 20000);
    const st = await S.start({
      enabled: true, port: cand, requireToken: false,
    }, { getConfig: () => ({}), getPresets: () => [], onClientsChanged: () => {} });
    if (st.running) { port = cand; break; }
  }
  assert.ok(port, 'port');
  const overlay = await wsConnect(port, 'kind=overlay');
  const remote = await wsConnect(port, 'kind=remote');
  try {
    await overlay.next('hello');
    await remote.next('hello');
    assert.strictEqual(S.claimCam('pencere-a', 'cam-1'), true);
    assert.strictEqual(S.claimCam('pencere-b', 'cam-1'), false);
    assert.strictEqual(S.touchCam('pencere-b', 'cam-1'), false);
    assert.strictEqual(S.touchCam('pencere-a', 'cam-1'), true);
    S.releaseCam('pencere-a', 'cam-1');
    assert.strictEqual(S.claimCam('pencere-b', 'cam-1'), true);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    assert.strictEqual(S.broadcastCam('cam-1', jpeg), true);
    const frame = await overlay.next('cam-frame');
    assert.ok(frame);
    assert.strictEqual(frame.key, 'cam-1');
    assert.strictEqual(Buffer.from(frame.data, 'base64').equals(jpeg), true);
    assert.strictEqual(await remote.next('cam-frame', 200), null);
    S.broadcastCamStatus('cam-1', 'Bu kamera başka bir uygulama tarafından kullanılıyor.', false);
    const status = await overlay.next('cam-status');
    assert.strictEqual(status.ready, false);
    assert.match(status.error, /başka bir uygulama/);
  } finally {
    try { overlay.socket.destroy(); } catch { /* */ }
    try { remote.socket.destroy(); } catch { /* */ }
    await S.stop();
  }
});
