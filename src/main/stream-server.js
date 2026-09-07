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
let httpSockets = new Set();
let lastNowPlaying = null;
let state = {
  running: false,
  port: 0,
  host: '127.0.0.1',
  token: '',
  remoteToken: '',
  requireToken: false, // varsayılan: yerel kullanımda token zorunlu değil
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

function broadcastNowPlaying(st) {
  lastNowPlaying = st;
  broadcast({ type: 'now-playing', state: st });
}

// ----------------------------------------------------------------------------
// HTTP
// ----------------------------------------------------------------------------
function extractCookieToken(cookieHeader, name) {
  if (!cookieHeader) return '';
  const n = name || 'sv_token';
  const match = String(cookieHeader).match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function extractRefererToken(referer) {
  if (!referer) return '';
  try {
    const refUrl = new URL(referer);
    return refUrl.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

function safeCompare(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
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
  const hdrs = req.headers || {};

  // 1. Health check her zaman açık
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'CAYADEV Visualizer', clients: clients.size }));
    return;
  }

  // 2. Sayfa giriş noktaları: / (overlay) ve /remote
  // Token zorunluluğu kapalıysa doğrulama atlanır; açıksa URL veya başlıktan token beklenir.
  const urlToken = url.searchParams.get('token') || hdrs['x-sv-token'] || '';

  if (p === '/' || p === '/overlay' || p === '/overlay.html') {
    const expected = state.token;
    if (state.requireToken && (!expected || !safeCompare(urlToken, expected))) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Gecersiz veya eksik jeton. URL sonuna ?token=... ekleyin.');
      return;
    }
    sendPage(res, path.join(ROOT, 'web', 'overlay.html'), state.requireToken ? 'sv_token' : null, state.requireToken ? expected : null);
    return;
  }

  if (p === '/remote' || p === '/remote.html') {
    const cfg = hooks.getConfig();
    if (cfg && cfg.stream && cfg.stream.remote === false) { res.writeHead(404).end('remote disabled'); return; }
    const expected = state.remoteToken || state.token;
    if (state.requireToken && (!expected || !safeCompare(urlToken, expected))) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Gecersiz veya eksik jeton. URL sonuna ?token=... ekleyin.');
      return;
    }
    sendPage(res, path.join(ROOT, 'web', 'remote.html'), state.requireToken ? 'sv_remote_token' : null, state.requireToken ? expected : null);
    return;
  }

  // 3. Alt kaynaklar: /app/... ve /media-file
  // Token zorunluluğu kapalıysa serbestçe servis edilir; açıksa çerez/URL/Referer'dan doğrulama yapılır.
  if (state.requireToken) {
    const cookieOverlay = extractCookieToken(hdrs['cookie'], 'sv_token');
    const cookieRemote = extractCookieToken(hdrs['cookie'], 'sv_remote_token');
    const refererToken = extractRefererToken(hdrs['referer']);
    const candidates = [urlToken, cookieOverlay, cookieRemote, refererToken].filter(Boolean);

    const subresourceOk = candidates.some(
      (t) => (state.token && safeCompare(t, state.token)) || (state.remoteToken && safeCompare(t, state.remoteToken))
    );

    if (!subresourceOk) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Gecersiz veya eksik jeton.');
      return;
    }
  }

  if (p === '/media-file') { serveMedia(req, res); return; }
  if (p.startsWith('/app/')) { serveStatic(res, p); return; }
  res.writeHead(404).end('not found');
}

/* Sayfayı servis ederken uygulamanın dilini enjekte eder ve alt kaynaklar
   için güvenli oturum çerezini tanımlar. */
function sendPage(res, file, cookieName, tokenVal) {
  fs.readFile(file, 'utf-8', (err, html) => {
    if (err) { res.writeHead(500).end('page missing'); return; }
    const locale = hooks.getLocale() === 'tr' ? 'tr' : 'en';
    const injected = html.replace(
      '<head>',
      '<head>\n    <script>window.__SV_LOCALE=' + JSON.stringify(locale) + ';</script>'
    );
    const respHeaders = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (cookieName && tokenVal) {
      respHeaders['Set-Cookie'] = `${cookieName}=${encodeURIComponent(tokenVal)}; Path=/; SameSite=Lax`;
    }
    res.writeHead(200, respHeaders);
    res.end(injected);
  });
}

// ----------------------------------------------------------------------------
// Yükseltme (HTTP -> WebSocket)
// ----------------------------------------------------------------------------
function handleUpgrade(req, socket) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  const hdrs = req.headers || {};
  const kind = url.searchParams.get('kind') === 'remote' ? 'remote' : 'overlay';
  const expected = kind === 'remote' ? (state.remoteToken || state.token) : state.token;

  const urlToken = url.searchParams.get('token') || hdrs['x-sv-token'] || '';
  const cookieName = kind === 'remote' ? 'sv_remote_token' : 'sv_token';
  const cookieToken = extractCookieToken(hdrs['cookie'], cookieName);
  const refererToken = extractRefererToken(hdrs['referer']);
  const candidates = [urlToken, cookieToken, refererToken].filter(Boolean);

  if (state.requireToken) {
    const ok = expected && candidates.some((t) => safeCompare(t, expected));
    if (!ok) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
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
    kind,
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
  const np = (typeof hooks.getNowPlaying === 'function' ? hooks.getNowPlaying() : null) || lastNowPlaying;
  if (np && np.has) {
    sendJson(client, { type: 'now-playing', state: np });
  }

  socket.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk]);
    client.buf = decodeFrames(
      client,
      (payload, opcode) => {
        if (opcode !== 0x1) return; // yalnızca metin komutları
        let msg;
        try { msg = JSON.parse(payload.toString('utf-8')); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        // Yalnızca mobil kumanda istemcisi komut gönderebilir; overlay asla komut çalıştıramaz
        if (client.kind !== 'remote') return;
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
  let token = cfg.token || '';
  let remoteToken = cfg.remoteToken || '';
  const requireToken = !!cfg.requireToken; // varsayılan false
  overlayFps = cfg.overlayFps || 60;

  if (!token && cfg.enabled) token = newToken();
  if (!remoteToken && cfg.enabled) remoteToken = newToken();
  while (remoteToken && token && remoteToken === token) {
    remoteToken = newToken();
  }
  cfg.token = token;
  cfg.remoteToken = remoteToken;

  // requireToken değiştiğinde sunucu yeniden başlatılmasına gerek yok;
  // sadece state güncellenerek sonraki isteklerden itibaren etki eder.
  if (
    state.running &&
    state.port === port &&
    state.host === host &&
    state.token === token &&
    state.remoteToken === remoteToken
  ) {
    state.requireToken = requireToken;
    return Promise.resolve(status());
  }

  return stop().then(
    () =>
      new Promise((resolve) => {
        server = http.createServer(handleRequest);
        server.on('connection', (sock) => {
          httpSockets.add(sock);
          sock.on('close', () => httpSockets.delete(sock));
        });
        server.on('upgrade', handleUpgrade);
        server.on('error', (err) => {
          state = {
            running: false,
            port,
            host,
            token,
            remoteToken,
            requireToken,
            error: err.code === 'EADDRINUSE' ? 'PORT_IN_USE' : err.code || err.message,
          };
          server = null;
          resolve(status());
        });
        server.listen(port, host, () => {
          state = { running: true, port, host, token, remoteToken, requireToken, error: null };
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
    if (typeof s.closeAllConnections === 'function') {
      try { s.closeAllConnections(); } catch {}
    }
    for (const sock of httpSockets) {
      try { sock.destroy(); } catch {}
    }
    httpSockets.clear();
    try { s.close(() => resolve()); } catch { resolve(); }
    setTimeout(resolve, 200); // kapanmayı beklemede takılma
  });
}

function status() {
  return {
    running: state.running,
    port: state.port,
    host: state.host,
    lan: state.host === '0.0.0.0',
    token: state.token,
    remoteToken: state.remoteToken,
    requireToken: state.requireToken,
    error: state.error,
    clients: clientInfo(),
    urls: urls(),
  };
}

function urls() {
  if (!state.running) return { overlay: '', remote: '' };
  const base = 'http://' + (state.host === '0.0.0.0' ? lanAddress() : '127.0.0.1') + ':' + state.port;
  // Token zorunlu değilse URL'e ?token= eklenmez; zorunluysa eklenir.
  const qOverlay = (state.requireToken && state.token) ? '?token=' + encodeURIComponent(state.token) : '';
  const qRemote = state.requireToken
    ? (state.remoteToken
        ? '?token=' + encodeURIComponent(state.remoteToken)
        : (state.token ? '?token=' + encodeURIComponent(state.token) : ''))
    : '';
  return {
    overlay: base + '/' + qOverlay,
    remote: base + '/remote' + qRemote,
    local: 'http://127.0.0.1:' + state.port + '/' + qOverlay,
  };
}

function lanAddress() {
  const os = require('os');
  const nets = os.networkInterfaces();
  const candidates = [];
  const VIRTUAL_NAME_REGEX = /vethernet|virtual|vbox|vmware|wsl|hyper-v|tap|tun|docker|tailscale|zerotier/i;

  for (const name of Object.keys(nets)) {
    const isVirtual = VIRTUAL_NAME_REGEX.test(name);
    for (const n of nets[name] || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      const addr = n.address;
      if (!addr || addr.startsWith('127.') || addr.startsWith('169.254.')) continue;

      let score = 0;
      if (!isVirtual) score += 10;
      if (/wi-fi|wifi|wlan/i.test(name)) score += 8;
      else if (/ethernet|eth|en/i.test(name)) score += 5;

      if (addr.startsWith('192.168.')) score += 4;
      else if (addr.startsWith('10.')) score += 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score += 2;

      candidates.push({ address: addr, score });
    }
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].address;
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
  broadcastNowPlaying,
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
