'use strict';
/* Yayın sunucusu: video aralıkları ve kumanda sayfasının çerçevelenmesi.

   Aralık: sunucunun eski ayrıştırıcısı "bytes=-500" için dosyanın başını
   veriyordu, boyu aşan bitişte yanlış Content-Length yollayıp istemciyi
   bekletiyordu, ters aralıkta eşzamanlı hata atıp hiç yanıt vermiyordu.
   Artık uygulamanın kendi protokolüyle aynı kural (media-file.js parseRange).

   Çerçeve: Token Koruması kapalıyken kumanda sayfası jetonsuz açıldığından
   başka bir site onu görünmez çerçevede açıp tıklatabilirdi. Yalnız o durumda
   çerçeve yasak; koruma açıkken jetonlu gömme (pano) çalışıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

global.window = global.window || {};
const S = require('../src/main/stream-server.js');
const { parseRange } = require('../src/main/media-file.js');
const mediaUrl = require('../src/shared/media-url.js');

test('parseRange: tek aralığın bütün biçimleri', () => {
  assert.deepStrictEqual(parseRange('bytes=0-99', 1000), { status: 206, start: 0, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=500-', 1000), { status: 206, start: 500, end: 999 });
  // Sondan: son 500 bayt (eski sunucu kopyası 0–500 veriyordu)
  assert.deepStrictEqual(parseRange('bytes=-500', 1000), { status: 206, start: 500, end: 999 });
  assert.deepStrictEqual(parseRange('bytes=-5000', 1000), { status: 206, start: 0, end: 999 });
  // Bitiş dosyayı aşıyor: kırpılır
  assert.deepStrictEqual(parseRange('bytes=900-99999999999', 1000), { status: 206, start: 900, end: 999 });
  assert.deepStrictEqual(parseRange('Bytes = 10 - 19', 1000), { status: 206, start: 10, end: 19 });
});

test('parseRange: karşılanamayan aralık 416, anlaşılmayan aralık yok sayılır', () => {
  assert.deepStrictEqual(parseRange('bytes=100-5', 1000), { status: 416 });
  assert.deepStrictEqual(parseRange('bytes=1000-', 1000), { status: 416 });
  assert.deepStrictEqual(parseRange('bytes=5000-6000', 1000), { status: 416 });
  assert.deepStrictEqual(parseRange('bytes=-0', 1000), { status: 416 });
  assert.deepStrictEqual(parseRange('bytes=0-', 0), { status: 416 });
  for (const junk of [undefined, null, '', 'saçmalık', 'bytes=', 'bytes=-', 'bytes=0-1,5-6', 'items=0-5', 'bytes=a-b']) {
    assert.strictEqual(parseRange(junk, 1000), null, String(junk));
  }
});

function request(port, p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('yanıt gelmedi: ' + p)));
    req.on('error', reject);
  });
}

async function startOn(cfg, extra) {
  for (let i = 0; i < 20; i++) {
    const cand = 21000 + Math.floor(Math.random() * 20000);
    const st = await S.start(Object.assign({ enabled: true, port: cand }, extra), { getConfig: () => cfg });
    if (st.running) return cand;
  }
  return 0;
}

test('yayın sunucusu video aralıklarını doğru verir, ters aralıkta yanıtsız kalmaz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-range-'));
  const file = path.join(dir, 'klip.mp4');
  const data = Buffer.alloc(1000);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  fs.writeFileSync(file, data);
  const url = mediaUrl.toMediaUrl(file);
  const cfg = { media: { file: null }, layers: [{ kind: 'media', settings: { media: { source: 'file', file: url } } }] };
  const port = await startOn(cfg, { requireToken: false });
  assert.ok(port, 'port');
  const p = '/media-file?v=' + encodeURIComponent(url);
  try {
    const tail = await request(port, p, { Range: 'bytes=-100' });
    assert.strictEqual(tail.status, 206);
    assert.strictEqual(tail.headers['content-range'], 'bytes 900-999/1000');
    assert.deepStrictEqual(tail.body, data.subarray(900));

    const over = await request(port, p, { Range: 'bytes=990-5000' });
    assert.strictEqual(over.status, 206);
    assert.strictEqual(over.headers['content-length'], '10');
    assert.deepStrictEqual(over.body, data.subarray(990));

    const inverted = await request(port, p, { Range: 'bytes=500-10' });
    assert.strictEqual(inverted.status, 416);
    assert.strictEqual(inverted.headers['content-range'], 'bytes */1000');

    const junk = await request(port, p, { Range: 'bytes=0-1,5-6' });
    assert.strictEqual(junk.status, 200);
    assert.strictEqual(junk.body.length, 1000);
  } finally {
    await S.stop();
  }
});

test('kumanda sayfası yalnız Token Koruması kapalıyken çerçevelenemez; yayın sayfası hep çerçevelenebilir', async () => {
  const cfg = { stream: { remote: true } };
  let port = await startOn(cfg, { requireToken: false });
  assert.ok(port, 'port');
  try {
    const remote = await request(port, '/remote');
    assert.strictEqual(remote.status, 200);
    assert.strictEqual(remote.headers['x-frame-options'], 'DENY');
    assert.strictEqual(remote.headers['content-security-policy'], "frame-ancestors 'none'");
    const overlay = await request(port, '/');
    assert.strictEqual(overlay.status, 200);
    assert.strictEqual(overlay.headers['x-frame-options'], undefined);
    assert.strictEqual(overlay.headers['content-security-policy'], undefined);
  } finally {
    await S.stop();
  }

  port = await startOn(cfg, { requireToken: true, token: 'a'.repeat(32), remoteToken: 'b'.repeat(32) });
  assert.ok(port, 'port');
  try {
    const st = S.status();
    const tok = st && st.urls && st.urls.remote ? new URL(st.urls.remote).searchParams.get('token') : '';
    assert.ok(tok, 'jetonlu kumanda adresi');
    const remote = await request(port, '/remote?token=' + encodeURIComponent(tok));
    assert.strictEqual(remote.status, 200);
    assert.strictEqual(remote.headers['x-frame-options'], undefined, 'jetonlu gömme (pano) çalışmalı');
    const denied = await request(port, '/remote');
    assert.strictEqual(denied.status, 401);

    /* Ana ekrana eklenen kumanda bildirimdeki start_url (/remote) ile jetonsuz
       açılır; ilk ziyarette yazılan çerez onu taşımalı. Eskiden 401. */
    const cookie = String((remote.headers['set-cookie'] || [])[0] || '');
    assert.match(cookie, /^sv_remote_token=[^;]+; Path=\/; Max-Age=\d+; SameSite=Strict$/);
    const launched = await request(port, '/remote', { Cookie: cookie.split(';')[0] });
    assert.strictEqual(launched.status, 200, 'çerezle açılan kumanda');
    // Yanlış çerez ya da öbür sayfanın çerezi geçmez
    assert.strictEqual((await request(port, '/remote', { Cookie: 'sv_remote_token=' + 'c'.repeat(32) })).status, 401);
    assert.strictEqual((await request(port, '/remote', { Cookie: 'sv_token=' + 'a'.repeat(32) })).status, 401);
    // Yayın sayfası da kendi çereziyle açılır, kumandanınkiyle açılmaz
    assert.strictEqual((await request(port, '/', { Cookie: 'sv_token=' + 'a'.repeat(32) })).status, 200);
    assert.strictEqual((await request(port, '/', { Cookie: cookie.split(';')[0] })).status, 401);
  } finally {
    await S.stop();
  }
});
