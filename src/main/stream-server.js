'use strict';
/* Yayın sunucusu — OBS tarayıcı kaynağı + mobil uzaktan kumanda.

   Neden bu yol: OBS'in "Tarayıcı Kaynağı"na verilen sayfa, görselleştiricinin
   AYNI motorunu (visualizer.js ve modes/*) çalıştırır; tek fark ses karelerinin
   Electron IPC yerine WebSocket ile gelmesidir. Böylece pencere yakalamaya,
   ekran kaydına veya native bir OBS eklentisine gerek kalmaz ve OBS'te gerçek
   saydam üst katman elde edilir.

   WebSocket burada elle yazıldı: bağımlılık eklemeden RFC 6455'in ihtiyaç
   duyulan bölümü (maskeleme, parçalı kare birleştirme, ping/pong, kapatma)
   uygulanıyor. İstemciler yalnızca bizim sayfalarımız ve OBS'in Chromium'u.

   Güvenlik:
   - Varsayılan olarak yalnızca 127.0.0.1 dinlenir; "LAN" açıkça açılmalıdır.
   - LAN modunda her istek geçerli bir jeton ister (URL ?token= veya başlık).
   - Statik dosyalar yalnızca uygulamanın src/ dizininden ve beyaz listedeki
     uzantılarla servis edilir; yol normalize edilip dizin dışına çıkış engellenir.
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mediaUrl = require('../shared/media-url');

const ROOT = path.join(__dirname, '..'); // src/
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024; // istemciden gelen tek mesaj üst sınırı

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
};

let server = null;
let state = {
  running: false,
  port: 0,
  host: '127.0.0.1',
  token: '',
  error: null,
};
let clients = new Set();
let hooks = {
  getConfig: () => null,
  getPresets: () => [],
  getLocale: () => 'en',
  onCommand: () => {},
  onClientsChanged: () => {},
};
let lastFrameSent = 0;
let overlayFps = 60;

// ----------------------------------------------------------------------------
// WebSocket kare kodlama/çözme
// ----------------------------------------------------------------------------
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

/* Gelen baytları çözer. Tamamlanan mesajları onMessage'a verir.
   Dönüş: kalan (henüz tamamlanmamış) tampon. */
function decodeFrames(client, onMessage, onClose) {
  let buf = client.buf;
  for (;;) {
    if (buf.length < 2) break;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      const hi = buf.readUInt32BE(2);
      const lo = buf.readUInt32BE(6);
      len = hi * 4294967296 + lo;
      offset = 10;
    }
    if (len > MAX_MESSAGE) { onClose(1009, 'message too big'); return Buffer.alloc(0); }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) break;

    let payload = buf.slice(offset + maskLen, offset + maskLen + len);
    if (masked) {
      const mask = buf.slice(offset, offset + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    buf = buf.slice(offset + maskLen + len);

    if (opcode === 0x8) { onClose(1000, 'client close'); return Buffer.alloc(0); }
    if (opcode === 0x9) { // ping -> pong
      try { client.socket.write(encodeFrame(0xa, payload)); } catch { /* kapanmış */ }
      continue;
    }
    if (opcode === 0xa) continue; // pong

    if (opcode === 0x0) {
      // devam karesi
      client.fragments.push(payload);
      if (fin) {
        onMessage(Buffer.concat(client.fragments), client.fragmentOpcode);
        client.fragments = [];
      }
    } else {
      if (fin) {
        onMessage(payload, opcode);
      } else {
        client.fragmentOpcode = opcode;
        client.fragments = [payload];
      }
    }
  }
  return buf;
}

// ----------------------------------------------------------------------------
// İstemci yönetimi
// ----------------------------------------------------------------------------
function sendTo(client, opcode, payload) {
  if (client.socket.destroyed) return;
  // Geri baskı: yazma tamponu dolduysa ses karesi atlanır (kontrol mesajları
  // yine de sıraya girer). Aksi halde yavaş bir istemci belleği şişirir.
  if (opcode === 0x2 && client.backpressure) return;
  try {
    const ok = client.socket.write(encodeFrame(opcode, payload));
    if (!ok) {
      client.backpressure = true;
      client.socket.once('drain', () => { client.backpressure = false; });
    }
  } catch { dropClient(client); }
}

function sendJson(client, obj) {
  sendTo(client, 0x1, Buffer.from(JSON.stringify(obj), 'utf-8'));
}

function dropClient(client) {
  if (!clients.has(client)) return;
  clients.delete(client);
  try { client.socket.destroy(); } catch { /* zaten kapalı */ }
  hooks.onClientsChanged(clientInfo());
}

function clientInfo() {
  return Array.from(clients).map((c) => ({ kind: c.kind, since: c.since, address: c.address }));
}

function broadcast(obj, kind) {
  for (const c of clients) {
    if (kind && c.kind !== kind) continue;
    sendJson(c, obj);
  }
}

/* Ses karesi (ikili): [0..3] sampleRate (LE) | [4..] freq | sonra time.
   JSON'a göre ~4 kat küçük ve ayrıştırma maliyeti sıfır. */
function broadcastAudio(frame) {
  if (!clients.size || !frame || !frame.freq) return;
  const now = Date.now();
  const minGap = 1000 / Math.max(1, Math.min(240, overlayFps));
  if (now - lastFrameSent < minGap - 1) return;
  lastFrameSent = now;

  const freq = Buffer.from(frame.freq.buffer || frame.freq, frame.freq.byteOffset || 0, frame.freq.length);
  const time = Buffer.from(frame.time.buffer || frame.time, frame.time.byteOffset || 0, frame.time.length);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(frame.sampleRate || 48000, 0);
  head.writeUInt32LE(freq.length, 4);
  head.writeUInt32LE(time.length, 8);
  const payload = Buffer.concat([head, freq, time]);
  for (const c of clients) {
    if (c.kind === 'overlay') sendTo(c, 0x2, payload);
  }
}

// ----------------------------------------------------------------------------
// HTTP
// ----------------------------------------------------------------------------
function tokenOk(reqUrl, headers) {
  if (state.host === '127.0.0.1') return true; // yalnız yerel: jeton zorunlu değil
  if (!state.token) return false;
  const given = reqUrl.searchParams.get('token') || headers['x-sv-token'] || '';
  // Sabit süreli karşılaştırma: jeton uzunluğu sızdırılmasın
  const a = Buffer.from(String(given));
  const b = Buffer.from(state.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serveStatic(res, urlPath) {
  // /app/... -> src/... (yalnızca beyaz listedeki uzantılar)
  const rel = decodeURIComponent(urlPath.replace(/^\/app\//, ''));
  const ext = path.extname(rel).toLowerCase();
  if (!MIME[ext] || ext === '.mp4' || ext === '.webm' || ext === '.mkv' || ext === '.mov') {
    res.writeHead(403).end('forbidden');
    return;
  }
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// Video dosyasını istemciye aralık (range) destekli servis eder
function serveMedia(req, res) {
  const cfg = hooks.getConfig();
  const file = cfg && cfg.media && cfg.media.file;
  if (!file) { res.writeHead(404).end('no media'); return; }
  const local = mediaUrl.fromMediaUrl(file);
  let stat;
  try { stat = fs.statSync(local); } catch { res.writeHead(404).end('not found'); return; }
  const ext = path.extname(local).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(local, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(local).pipe(res);
  }
}

function handleRequest(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400).end('bad'); return; }
  const p = url.pathname;

  if (!tokenOk(url, req.headers)) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Gecersiz veya eksik jeton. URL sonuna ?token=... ekleyin.');
    return;
  }

  if (p === '/' || p === '/overlay' || p === '/overlay.html') {
    sendPage(res, path.join(ROOT, 'web', 'overlay.html'));
    return;
  }
  if (p === '/remote' || p === '/remote.html') {
    const cfg = hooks.getConfig();
    if (cfg && cfg.stream && cfg.stream.remote === false) { res.writeHead(404).end('remote disabled'); return; }
    sendPage(res, path.join(ROOT, 'web', 'remote.html'));
    return;
  }
  if (p === '/media-file') { serveMedia(req, res); return; }
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'CAYADEV Visualizer', clients: clients.size }));
    return;
  }
  if (p.startsWith('/app/')) { serveStatic(res, p); return; }
  res.writeHead(404).end('not found');
}

/* Sayfayı servis ederken uygulamanın dilini enjekte eder.

   Yayın sayfaları telefonun ya da OBS'in dilini değil, UYGULAMANIN dilini
   kullanmalı: kullanıcı paneli İngilizce yaptıysa kumanda da İngilizce olsun.
   i18n.js bu değişkeni localStorage'dan önce okur. */
function sendPage(res, file) {
  fs.readFile(file, 'utf-8', (err, html) => {
    if (err) { res.writeHead(500).end('page missing'); return; }
    const locale = hooks.getLocale() === 'tr' ? 'tr' : 'en';
    const injected = html.replace(
      '<head>',
      '<head>\n    <script>window.__SV_LOCALE=' + JSON.stringify(locale) + ';</script>'
    );
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(injected);
  });
}

// ----------------------------------------------------------------------------
// Yükseltme (HTTP -> WebSocket)
// ----------------------------------------------------------------------------
function handleUpgrade(req, socket) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  if (!tokenOk(url, req.headers)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const client = {
    socket,
    kind: url.searchParams.get('kind') === 'remote' ? 'remote' : 'overlay',
    since: Date.now(),
    address: socket.remoteAddress || '',
    buf: Buffer.alloc(0),
    fragments: [],
    fragmentOpcode: 0x1,
    backpressure: false,
  };
  clients.add(client);
  hooks.onClientsChanged(clientInfo());

  // açılışta mevcut durum
  sendJson(client, { type: 'hello', app: 'CAYADEV Visualizer', kind: client.kind });
  sendJson(client, { type: 'config', config: hooks.getConfig() });
  sendJson(client, { type: 'presets', presets: hooks.getPresets() });

  socket.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk]);
    client.buf = decodeFrames(
      client,
      (payload, opcode) => {
        if (opcode !== 0x1) return; // yalnızca metin komutları
        let msg;
        try { msg = JSON.parse(payload.toString('utf-8')); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        // Komutlar veri olarak ele alınır; ana süreç ne yapacağına kendi karar verir.
        hooks.onCommand(msg, client);
      },
      () => dropClient(client)
    );
  });
  socket.on('error', () => dropClient(client));
  socket.on('close', () => dropClient(client));
}

// ----------------------------------------------------------------------------
// Ömür döngüsü
// ----------------------------------------------------------------------------
function start(cfgStream, newHooks) {
  hooks = Object.assign(hooks, newHooks || {});
  const cfg = cfgStream || {};
  const port = Math.max(1024, Math.min(65535, cfg.port | 0 || 8722));
  const host = cfg.lan ? '0.0.0.0' : '127.0.0.1';
  const token = cfg.token || '';
  overlayFps = cfg.overlayFps || 60;

  if (state.running && state.port === port && state.host === host && state.token === token) {
    return Promise.resolve(status());
  }

  return stop().then(
    () =>
      new Promise((resolve) => {
        server = http.createServer(handleRequest);
        server.on('upgrade', handleUpgrade);
        server.on('error', (err) => {
          state = {
            running: false,
            port,
            host,
            token,
            error: err.code === 'EADDRINUSE' ? 'PORT_IN_USE' : err.code || err.message,
          };
          server = null;
          resolve(status());
        });
        server.listen(port, host, () => {
          state = { running: true, port, host, token, error: null };
          resolve(status());
        });
      })
  );
}

function stop() {
  return new Promise((resolve) => {
    for (const c of Array.from(clients)) dropClient(c);
    clients = new Set();
    if (!server) {
      state.running = false;
      resolve();
      return;
    }
    const s = server;
    server = null;
    state.running = false;
    try { s.close(() => resolve()); } catch { resolve(); }
    setTimeout(resolve, 400); // kapanmayı beklemede takılma
  });
}

function status() {
  return {
    running: state.running,
    port: state.port,
    host: state.host,
    lan: state.host === '0.0.0.0',
    token: state.token,
    error: state.error,
    clients: clientInfo(),
    urls: urls(),
  };
}

function urls() {
  if (!state.running) return { overlay: '', remote: '' };
  const q = state.host === '0.0.0.0' && state.token ? '?token=' + encodeURIComponent(state.token) : '';
  const base = 'http://' + (state.host === '0.0.0.0' ? lanAddress() : '127.0.0.1') + ':' + state.port;
  return { overlay: base + '/' + q, remote: base + '/remote' + q, local: 'http://127.0.0.1:' + state.port + '/' };
}

function lanAddress() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function newToken() {
  return crypto.randomBytes(12).toString('hex');
}

module.exports = {
  start,
  stop,
  status,
  broadcast,
  broadcastAudio,
  newToken,
  lanAddress,
  clientCount: () => clients.size,
  // Ses karesi tüketen istemci sayısı (mobil kumanda sayılmaz)
  overlayCount: () => {
    let n = 0;
    for (const c of clients) if (c.kind === 'overlay') n++;
    return n;
  },
};
