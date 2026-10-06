'use strict';
/* Yayın sunucusu başka sitelerin bağlantısını reddeder (#695).

   Tarayıcı WebSocket bağlantısı CORS'a tabi değil. Token Koruması
   kapalıyken (varsayılan) kullanıcının açtığı herhangi bir site sunucuya
   kumanda olarak bağlanıp pencere açıp kapatabiliyor, sahne değiştirebiliyor,
   ayarı ve söz kitaplığını okuyabiliyordu. Canlıda yabancı bir Origin ile
   101 ve "hello" alınarak doğrulandı. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const S = require('../src/main/stream-server.js');

test('Host yalnız IP, localhost, makine adı ya da yerel ağ adı olabilir', () => {
  for (const h of ['127.0.0.1:8722', '192.168.1.20:8722', '[::1]:8722', 'localhost:8722', 'LOCALHOST:8722',
    'masaustu:8722', 'yazici.local:8722', os.hostname() + ':8722', '']) {
    assert.ok(S.hostAllowed(h), h);
  }
  for (const h of ['evil.example:8722', 'evil.example', '127.0.0.1.nip.io:8722', 'a.b.c:1']) {
    assert.ok(!S.hostAllowed(h), h);
  }
});

test('Origin, istek yapılan adresle aynı olmalı', () => {
  assert.ok(S.originAllowed(undefined, '127.0.0.1:8722'), 'Origin yoksa tarayıcı dışı istemci');
  assert.ok(S.originAllowed('http://127.0.0.1:8722', '127.0.0.1:8722'));
  assert.ok(S.originAllowed('http://LOCALHOST:8722', 'localhost:8722'));
  assert.ok(S.originAllowed('http://[::1]:8722', '[::1]:8722'));
  assert.ok(!S.originAllowed('https://evil.example', '127.0.0.1:8722'));
  assert.ok(!S.originAllowed('http://127.0.0.1:5577', '127.0.0.1:8722'), 'aynı makinede başka bağlantı noktası');
  assert.ok(!S.originAllowed('null', '127.0.0.1:8722'));
  assert.ok(!S.originAllowed('file://', '127.0.0.1:8722'));
});

function upgrade(port, query, headers) {
  return new Promise((resolve) => {
    const h = Object.assign({
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
    }, headers || {});
    const req = http.request({ host: '127.0.0.1', port, path: '/ws?' + query, headers: h });
    req.setTimeout(3000, () => { req.destroy(); resolve({ status: -1 }); });
    req.on('upgrade', (res, socket, head) => {
      // İlk çerçeve 101 yanıtıyla aynı pakette gelebilir
      const first = (d) => {
        socket.destroy();
        const len = d[1] & 127;
        const off = len === 126 ? 4 : len === 127 ? 10 : 2;
        let type = '';
        try { type = JSON.parse(d.slice(off, off + (len < 126 ? len : d.readUInt16BE(2))).toString('utf8')).type; } catch { type = '?'; }
        resolve({ status: 101, type });
      };
      if (head && head.length >= 4) first(head);
      else socket.once('data', (d) => first(head && head.length ? Buffer.concat([head, d]) : d));
    });
    req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode }); });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

function get(port, p, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers: headers || {} }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function startOn(requireToken) {
  for (let i = 0; i < 20; i++) {
    const cand = 21000 + Math.floor(Math.random() * 20000);
    const st = await S.start({ enabled: true, port: cand, requireToken }, {
      getConfig: () => ({}), getPresets: () => [], onClientsChanged: () => {},
    });
    if (st.running) return cand;
  }
  throw new Error('port');
}

for (const requireToken of [false, true]) {
  test('başka siteden bağlantı reddedilir (Token Koruması ' + (requireToken ? 'açık' : 'kapalı') + ')', async () => {
    const port = await startOn(requireToken);
    try {
      const st = S.status();
      const self = '127.0.0.1:' + port;
      const tok = (kind) => (requireToken ? '&token=' + (kind === 'remote' ? st.remoteToken : st.token) : '');
      for (const kind of ['remote', 'overlay']) {
        const q = 'kind=' + kind + tok(kind);
        assert.strictEqual((await upgrade(port, q, { Origin: 'https://evil.example' })).status, 403, kind + ' yabancı köken');
        assert.strictEqual((await upgrade(port, q, { Origin: 'http://127.0.0.1:5577' })).status, 403, kind + ' başka yerel bağlantı noktası');
        assert.strictEqual((await upgrade(port, q, { Origin: 'http://evil.example:' + port, Host: 'evil.example:' + port })).status, 403, kind + ' yeniden bağlama');
        assert.deepStrictEqual(await upgrade(port, q, { Origin: 'http://' + self }), { status: 101, type: 'hello' }, kind + ' aynı köken');
        assert.deepStrictEqual(await upgrade(port, q), { status: 101, type: 'hello' }, kind + ' Origin yok');
      }
      assert.strictEqual(await get(port, '/health', { Host: 'evil.example:' + port }), 403, 'HTTP yeniden bağlama');
      assert.strictEqual(await get(port, '/health'), 200);
    } finally {
      await S.stop();
    }
  });
}

/* Paylaşılan adresler (QR kodu, kopyala düğmesi) yeni denetimlerden geçmeli:
   telefon ve OBS bu adreslerle açıyor. */
test('sunucunun verdiği adresler denetimden geçer', async () => {
  const port = await startOn(false);
  try {
    const urls = S.status().urls;
    for (const key of ['overlay', 'remote', 'local']) {
      const u = new URL(urls[key]);
      assert.ok(S.hostAllowed(u.host), key + ' ' + u.host);
      assert.ok(S.originAllowed(u.origin, u.host), key + ' ' + u.origin);
    }
  } finally {
    await S.stop();
  }
});

test('video ve çerezler başka sitelere açılmaz', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'stream-server.js'), 'utf8');
  assert.ok(!src.includes("'Access-Control-Allow-Origin': '*'"), 'video her siteye açık');
  assert.ok(!/SameSite=Lax/.test(src));
  assert.match(src, /SameSite=Strict/);
});

/* Reddedilen istemci bağlantıyı sert keserse ana süreç yakalanmamış
   ECONNRESET atıyordu ve Electron hata kutusu uygulamayı donduruyordu.
   Canlıda bulundu; Token Koruması açıkken yanlış jetonla da oluyordu. */
test('reddedilen istemci bağlantıyı koparınca sunucu çökmez', async () => {
  const net = require('net');
  const port = await startOn(true);
  const errors = [];
  const onErr = (e) => errors.push(e);
  process.on('uncaughtException', onErr);
  const rude = (headers) => new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write('GET /ws?kind=remote&token=yanlis HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\n'
        + 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n'
        + 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' + headers + '\r\n');
    });
    s.once('data', (d) => {
      const line = d.toString('latin1').split('\r\n')[0];
      s.resetAndDestroy();
      resolve(line);
    });
    s.on('error', () => {});
  });
  try {
    assert.match(await rude(''), / 401 /);
    assert.match(await rude('Origin: https://evil.example\r\n'), / 403 /);
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(await get(port, '/health'), 200, 'sunucu ayakta');
  } finally {
    process.removeListener('uncaughtException', onErr);
    await S.stop();
  }
  assert.deepStrictEqual(errors.map((e) => e.code), []);
});
