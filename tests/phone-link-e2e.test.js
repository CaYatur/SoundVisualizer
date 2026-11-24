'use strict';
/* Telefon bağlantısı uçtan uca (src/main/phone-link-service.js + stream-server `/link`):
 * gerçek yayın sunucusu (yalnız 127.0.0.1), elle yazılmış küçük WebSocket istemcisi,
 * kodla eşleşme ve bilgisayarda onay, şifreli istek/yanıt, izin reddi, yeniden bağlanma,
 * bağlantı kapalıyken /link'in reddi ve telefonun yayın iletilerini almaması. */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');

const S = require('../src/main/stream-server.js');
const Link = require('../src/main/phone-link.js');
const { createService } = require('../src/main/phone-link-service.js');

// ---- Küçük WebSocket istemcisi (maskeli gönderir, maskesiz okur)
function wsConnect(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') } });
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('response', (res) => resolve({ status: res.statusCode }));
    req.on('upgrade', (res, socket, head) => {
      const queue = [];
      const waiters = [];
      let buf = Buffer.alloc(0);
      const push = (m) => { const w = waiters.shift(); if (w) w(m); else queue.push(m); };
      const feed = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 15;
          let len = buf[1] & 127, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) push({ text: payload.toString('utf8') });
          else if (op === 2) push({ bin: Buffer.from(payload) });
          else if (op === 8) push({ closed: true });
        }
      };
      if (head && head.length) feed(head);
      socket.on('data', feed);
      socket.on('close', () => push({ closed: true }));
      const send = (op, payload) => {
        const mask = crypto.randomBytes(4);
        const len = payload.length;
        const hdr = len < 126 ? Buffer.from([0x80 | op, 0x80 | len]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 126]), Buffer.from([len >> 8, len & 255])]);
        const body = Buffer.from(payload);
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
        socket.write(Buffer.concat([hdr, mask, body]));
      };
      resolve({
        status: 101,
        sendText: (o) => send(1, Buffer.from(JSON.stringify(o))),
        sendBin: (b) => send(2, b),
        next: (ms) => new Promise((res2, rej2) => {
          if (queue.length) { res2(queue.shift()); return; }
          const t = setTimeout(() => rej2(new Error('no message')), ms || 2000);
          waiters.push((m) => { clearTimeout(t); res2(m); });
        }),
        close: () => socket.destroy(),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function startServer(hooks, phoneLink) {
  for (let i = 0; i < 20; i++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const st = await S.start({ enabled: true, port, phoneLink, listenHost: '127.0.0.1' }, hooks);
    if (st.running) return port;
  }
  throw new Error('port');
}

test('Uçtan uca: kodla eşleş, onayla, şifreli istek, izin, yeniden bağlan; telefon yayın iletisi almaz', async () => {
  let stored = null;
  const notes = [];
  let gateWhy = '';
  const svc = createService({
    gate: () => gateWhy,
    stream: S,
    store: { read: () => stored, write: (o) => { stored = JSON.parse(JSON.stringify(o)); } },
    protect: { seal: (b) => 'x' + Buffer.from(b).toString('base64'), unseal: (s) => Buffer.from(String(s).slice(1), 'base64') },
    notify: (ch, p) => notes.push([ch, p]),
    pcName: () => 'Stüdyo-PC',
    addresses: () => ['192.168.1.24'],
    port: () => 0,
    ops: { 'state.get': () => ({ scene: 'Gece Sürüşü' }) },
  });
  const port = await startServer(svc.hooks, true);
  try {
    svc.setEnabled(true);
    const st = svc.newCode();
    assert.match(st.pairing.qr, /^svlink:\/\/1\?h=192\.168\.1\.24/);
    // Anahtarlar düz yazılmaz: koruma işlevinden geçer
    assert.ok(stored.identity.priv.startsWith('x'));

    const ws = await wsConnect(port, '/link');
    assert.strictEqual(ws.status, 101);
    const hello = JSON.parse((await ws.next()).text);
    assert.strictEqual(hello.t, 'hello');
    assert.strictEqual(hello.pc.name, 'Stüdyo-PC');
    assert.strictEqual(hello.pairing, true);

    const ph = Link.newIdentity();
    ws.sendText({ t: 'pair', kind: 'code', v: 1, pub: Link.b64u(ph.pub), name: 'Redmi', proof: Link.b64u(Link.hmac(Buffer.from(st.pairing.code), 'sv-link-code|', ph.pub)) });
    const commit = JSON.parse((await ws.next()).text);
    assert.strictEqual(commit.t, 'commit');
    const np = crypto.randomBytes(16);
    ws.sendText({ t: 'reveal', np: Link.b64u(np) });
    const rev = JSON.parse((await ws.next()).text);
    const pcPub = Link.unb64u(commit.pub);
    const nc = Link.unb64u(rev.nc);
    assert.ok(Link.hmac(nc, 'sv-link-commit|', pcPub, ph.pub).equals(Link.unb64u(commit.commit)));
    const pend = svc.status().pending;
    assert.strictEqual(pend.length, 1);
    assert.strictEqual(pend[0].digits, Link.sasDigits(ph.pub, pcPub, np, nc));
    assert.ok(notes.some(([ch]) => ch === 'phonelink-sas'));
    assert.strictEqual(svc.confirm(pend[0].no, true), true);
    const paired = JSON.parse((await ws.next()).text);
    assert.strictEqual(paired.t, 'paired');
    assert.strictEqual(paired.level, 'full');

    const devKey = Link.deviceKey(Link.sharedSecret(ph, pcPub), ph.pub, pcPub, np, nc);
    let k = Link.sessionKeys(devKey, np, nc);
    let seal = Link.sealer(k.c2p, 'c2p'), open = Link.opener(k.p2c, 'p2c');
    const ask = async (obj) => { ws.sendBin(seal(Buffer.from(JSON.stringify(obj)))); return JSON.parse(open((await ws.next()).bin).toString()); };
    assert.deepStrictEqual(await ask({ id: 1, op: 'state.get' }), { re: '1', ok: true, result: { scene: 'Gece Sürüşü' } });
    assert.deepStrictEqual(await ask({ id: 2, op: 'file.read' }), { re: '2', ok: false, error: 'not-allowed' });
    assert.deepStrictEqual(await ask({ id: 3, op: 'blackout' }), { re: '3', ok: false, error: 'unsupported' });
    assert.strictEqual(svc.sessionCount(), 1);
    // Ortak kapı: yedek rolünde izlerken kumanda reddedilir, izleme sürer
    gateWhy = 'standby';
    assert.deepStrictEqual(await ask({ id: 'g1', op: 'blackout' }), { re: 'g1', ok: false, error: 'standby' });
    assert.deepStrictEqual(await ask({ id: 'g2', op: 'state.get' }), { re: 'g2', ok: true, result: { scene: 'Gece Sürüşü' } });
    gateWhy = '';

    // Yayın iletisi telefona gitmez; olay yayını şifreli gider
    S.broadcast({ type: 'config', config: {} });
    svc.broadcast({ ev: 'state', scene: 'Tünel' });
    assert.deepStrictEqual(JSON.parse(open((await ws.next()).bin).toString()), { ev: 'state', scene: 'Tünel' });
    // Düzey düşürülünce düzenleme reddedilir
    assert.strictEqual(svc.setLevel(paired.device, 'view'), true);
    assert.deepStrictEqual(await ask({ id: 4, op: 'config.patch' }), { re: '4', ok: false, error: 'not-allowed' });
    ws.close();

    // Uygulama yeniden açıldı gibi: aynı depo, yeni hizmet
    const svc2 = createService({ stream: S, store: { read: () => stored, write: (o) => { stored = o; } },
      protect: { seal: (b) => 'x' + Buffer.from(b).toString('base64'), unseal: (s) => Buffer.from(String(s).slice(1), 'base64') },
      ops: { 'state.get': () => 'ok' } });
    await S.start({ enabled: true, port, phoneLink: true, listenHost: '127.0.0.1' }, svc2.hooks);
    svc2.setEnabled(true);
    const ws2 = await wsConnect(port, '/link');
    await ws2.next();
    const np2 = crypto.randomBytes(16);
    ws2.sendText({ t: 'resume', v: 1, device: paired.device, np: Link.b64u(np2), proof: Link.b64u(Link.hmac(devKey, 'sv-link-resume|phone|', np2)) });
    const w = JSON.parse((await ws2.next()).text);
    assert.strictEqual(w.t, 'welcome');
    assert.strictEqual(w.level, 'view', 'düzey depoda kaldı');
    k = Link.sessionKeys(devKey, np2, Link.unb64u(w.nc));
    seal = Link.sealer(k.c2p, 'c2p'); open = Link.opener(k.p2c, 'p2c');
    ws2.sendBin(seal(Buffer.from(JSON.stringify({ id: 'a', op: 'state.get' }))));
    assert.deepStrictEqual(JSON.parse(open((await ws2.next()).bin).toString()), { re: 'a', ok: true, result: 'ok' });
    // Unutulunca bağlantı kapanır
    svc2.forget(paired.device);
    assert.ok((await ws2.next()).closed);
  } finally {
    await S.stop();
  }
});

/* LAN kapalı, bağlantı açık: BAŞKA bir makineden gelen istek. Sunucunun kendi işleyicileri sahte
   soketle çağrılır (uzak adres 192.168.1.5); sınama ağı dinlemez. */
test('LAN kapalıyken ağdan yalnız /health ve /link yanıt verir; yayın sayfaları, kumanda ve dosyalar 404', async () => {
  const svc = createService({ stream: S });
  await startServer(svc.hooks, true);
  try {
    const H = S._handlers;
    const fakeReq = (url, addr, extra) => ({ url, headers: Object.assign({ host: '192.168.1.24:8722' }, extra || {}), socket: { remoteAddress: addr } });
    const http1 = (url, addr) => new Promise((resolve) => {
      const res = { headers: {}, writeHead(code) { this.code = code; return this; }, setHeader() {}, end() { resolve(this.code); }, write() {} };
      H.handleRequest(fakeReq(url, addr), res);
    });
    for (const p of ['/', '/overlay', '/remote', '/media-file?path=C%3A%5Cx', '/logo-file?id=a', '/mode-thumb?kind=v&type=bars']) {
      assert.strictEqual(await http1(p, '192.168.1.5'), 404, 'ağdan ' + p);
    }
    assert.strictEqual(await http1('/health', '192.168.1.5'), 200);
    assert.notStrictEqual(await http1('/overlay', '127.0.0.1'), 404, 'yerelden yayın sayfası açık');
    const upgrade = (path, addr) => {
      const written = [];
      const sock = { remoteAddress: addr, on() {}, setNoDelay() {}, destroy() { written.push('destroy'); }, end(x) { written.push(String(x)); }, write(x) { written.push(String(x)); } };
      H.handleUpgrade(Object.assign(fakeReq(path, addr, { upgrade: 'websocket', 'sec-websocket-key': crypto.randomBytes(16).toString('base64') })), sock);
      return written.join('|');
    };
    assert.match(upgrade('/ws?kind=overlay', '192.168.1.5'), /404/);
    assert.match(upgrade('/ws?kind=remote', '192.168.1.5'), /404/);
    assert.match(upgrade('/link', '192.168.1.5'), /101 Switching Protocols/);
    for (const c of S.phoneClients()) S.dropClient(c);
  } finally {
    await S.stop();
  }
});

test('Oturumdan önce: ikili ve büyük kare bağlantıyı düşürür', async () => {
  const svc = createService({ stream: S });
  const port = await startServer(svc.hooks, true);
  try {
    svc.setEnabled(true);
    const a = await wsConnect(port, '/link');
    await a.next();
    a.sendBin(Buffer.alloc(16));
    assert.ok((await a.next()).closed, 'ikili kare');
    const b = await wsConnect(port, '/link');
    await b.next();
    b.sendText({ t: 'resume', pad: 'x'.repeat(5000) });
    assert.ok((await b.next()).closed, 'büyük metin');
  } finally {
    await S.stop();
  }
});

test('Bağlantı kapalıyken /link reddedilir, açıkken de yayın sayfası yerel kalır', async () => {
  const svc = createService({ stream: S });
  const port = await startServer(svc.hooks, false);
  try {
    assert.strictEqual((await wsConnect(port, '/link')).status, 404);
    assert.strictEqual(S.status().phoneLink, false);
    assert.strictEqual(S.isLoopback('::ffff:127.0.0.1'), true);
    assert.strictEqual(S.isLoopback('192.168.1.5'), false);
    // Hizmet kapalıyken açılan bağlantı hemen düşer
    await S.start({ enabled: true, port, phoneLink: true, listenHost: '127.0.0.1' }, svc.hooks);
    const ws = await wsConnect(port, '/link');
    assert.ok((await ws.next()).closed);
  } finally {
    await S.stop();
  }
});
