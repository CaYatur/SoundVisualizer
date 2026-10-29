'use strict';
/* YETKİ, DÖNEM VE ÇİT (#814). Eskiden yetki yalnız kimin karar verdiğini
 * değiştiriyordu: Art-Net, OSC çıkışı ve OpenRGB iki makinede de gidiyordu
 * ve birincil yedeğin yetkiyi aldığını görse de geri çekilmiyordu.
 * Burada: yetkinin tek kaynaktan hesaplanması, çıkış kapıları, diskteki
 * dönem, iki yönetici kuralı, korumalı geri verme koşulları, iki yönlü
 * komut izin listesi ve HMAC eşleşmesi (gerçek yayın sunucusuyla).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const R = require('../src/main/redundancy');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const MAIN = read('src/main/main.js');

test('yetki: rol kapalı her zaman burada; çitli birincil bilinmiyor; yeni dönemli yedek kazanır', () => {
  assert.strictEqual(R.authority({ role: 'off' }), 'self');
  assert.strictEqual(R.authority({ role: 'primary' }), 'self');
  assert.strictEqual(R.authority({ role: 'primary', fenced: true }), 'unknown');
  assert.strictEqual(R.authority({ role: 'primary', peerState: 'active', peerTerm: 3, term: 2 }), 'peer');
  // Eşit ya da eski dönemli yedek kazanamaz (iki yönetici kuralı ayrı)
  assert.strictEqual(R.authority({ role: 'primary', peerState: 'active', peerTerm: 2, term: 2 }), 'self');
  assert.strictEqual(R.authority({ role: 'primary', peerState: 'following', peerTerm: 9, term: 2 }), 'self');
  assert.strictEqual(R.authority({ role: 'backup', state: 'active' }), 'self');
  for (const st of ['following', 'lost', 'connecting']) assert.strictEqual(R.authority({ role: 'backup', state: st }), 'peer');
});

test('kapılar: varsayılan yalnız yetkiyle; "her zaman" iki makinede de açık', () => {
  const c = R.normalize({ outputs: { artnet: 'always', oscOut: 'bogus' } });
  assert.deepStrictEqual(c.outputs, { artnet: 'always', oscOut: 'authority', openrgb: 'authority', lighting: 'authority' });
  assert.deepStrictEqual(R.gates('peer', c), { artnet: true, oscOut: false, openrgb: false, lighting: false });
  assert.deepStrictEqual(R.gates('self', c), { artnet: true, oscOut: true, openrgb: true, lighting: true });
  assert.deepStrictEqual(R.gates('unknown', R.normalize({})), { artnet: false, oscOut: false, openrgb: false, lighting: false });
  // Çıkış ayarı bağlantıyı yeniden kurdurmaz
  assert.strictEqual(R.linkSig({ role: 'backup', outputs: { artnet: 'always' }, artnetOnLoss: 'zero', handbackAt: 'now' }), R.linkSig({ role: 'backup' }));
  assert.strictEqual(R.normalize({ artnetOnLoss: 'x' }).artnetOnLoss, 'hold');
  assert.strictEqual(R.normalize({ handbackAt: 'x' }).handbackAt, 'scene');
});

test('dönem: diskte kalıyor, küçülmüyor; parola değişince sıfırlanıyor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-term-'));
  const file = path.join(dir, 'redundancy', 'term.json');
  let t = R.createTermStore(file);
  assert.strictEqual(t.load('a'.repeat(20)), 0);
  assert.strictEqual(t.bump(0), 1);
  assert.strictEqual(t.bump(5), 6, 'görülenlerin en büyüğünden bir fazlası');
  assert.strictEqual(t.see(3), false, 'küçük dönem benimsenmez');
  assert.strictEqual(t.see(8), true);
  t = R.createTermStore(file);
  assert.strictEqual(t.load('a'.repeat(20)), 8, 'yeniden açılışta aynı');
  assert.strictEqual(t.load('b'.repeat(20)), 0, 'yeni eşleşme sıfırdan');
  // BOM'lu ve bozuk dosya
  fs.writeFileSync(file, '﻿' + JSON.stringify({ term: 4, tag: R.secretTag('c'.repeat(20)) }));
  assert.strictEqual(R.createTermStore(file).load('c'.repeat(20)), 4);
  fs.writeFileSync(file, '{bozuk');
  assert.strictEqual(R.createTermStore(file).load('c'.repeat(20)), 0);
});

test('iki yönetici: yetkideki yedek, dönemi en az kendisininki kadar olan "yetki bende" atışı görürse', () => {
  const base = { role: 'backup', state: 'active', term: 5 };
  assert.strictEqual(R.splitBrain(Object.assign({}, base, { beatHolder: 'self', beatTerm: 5 })), true);
  assert.strictEqual(R.splitBrain(Object.assign({}, base, { beatHolder: 'self', beatTerm: 4 })), false, 'birincil henüz yeni dönemi görmedi: bir atış');
  assert.strictEqual(R.splitBrain(Object.assign({}, base, { beatHolder: 'peer', beatTerm: 9 })), false);
  assert.strictEqual(R.splitBrain(Object.assign({}, base, { state: 'following', beatHolder: 'self', beatTerm: 9 })), false);
});

test('takipçi: veto kendiliğinden devralmayı durdurur, elle devralma çalışır', () => {
  const f = R.createFollower({ role: 'backup', host: 'h', secret: 'x'.repeat(16), heartbeatMs: 100, timeoutMs: 300 }, 0);
  f.connected();
  f.beat({ seq: 0, at: 0 }, 0);
  f.setVeto('artnet');
  assert.strictEqual(f.tick(1000), true);
  assert.strictEqual(f.status.state, 'lost', 'tanık birincili görüyor: kendiliğinden devralma yok');
  assert.strictEqual(f.tick(1100), false);
  f.setVeto('');
  assert.strictEqual(f.tick(1200), true);
  assert.strictEqual(f.status.state, 'active');
  const g = R.createFollower({ role: 'backup', host: 'h', secret: 'x'.repeat(16) }, 0);
  g.setVeto('split');
  assert.strictEqual(g.takeover(10), true, 'elle her zaman');
});

test('geri verme: her koşul adıyla; an seçimi', () => {
  const ok = { role: 'backup', state: 'active', aliveMs: 6000, differences: 0, offsetSamples: 25, primaryVersion: '3.1.6', version: '3.1.6' };
  assert.deepStrictEqual(R.handbackCheck(ok), []);
  assert.deepStrictEqual(R.handbackCheck(Object.assign({}, ok, { aliveMs: 1000 })), ['primary-alive']);
  assert.deepStrictEqual(R.handbackCheck(Object.assign({}, ok, { differences: 2 })), ['show-differs']);
  assert.deepStrictEqual(R.handbackCheck(Object.assign({}, ok, { differences: null })), ['show-unknown']);
  assert.deepStrictEqual(R.handbackCheck(Object.assign({}, ok, { offsetSamples: 3, primaryVersion: '3.1.5' })), ['clock', 'version']);
  assert.ok(R.handbackCheck(Object.assign({}, ok, { state: 'following' })).includes('not-active'));
  assert.strictEqual(R.handbackDue('now', {}, {}), true);
  assert.strictEqual(R.handbackDue('scene', { scene: 'a' }, { scene: 'a' }), false);
  assert.strictEqual(R.handbackDue('scene', { scene: 'a' }, { scene: 'b' }), true);
  assert.strictEqual(R.handbackDue('black', {}, { black: false }), false);
  assert.strictEqual(R.handbackDue('black', {}, { black: true }), true);
});

test('komut: izin listesi, yinelenen kimlik bir kez', () => {
  assert.strictEqual(R.ctlKind('nextScene'), 'show');
  assert.strictEqual(R.ctlKind('redHandback'), 'red');
  assert.strictEqual(R.ctlKind('set'), '');
  assert.strictEqual(R.ctlKind('__proto__'), '');
  const fresh = R.createCtlDedupe(2);
  assert.strictEqual(fresh('a'), true);
  assert.strictEqual(fresh('a'), false);
  assert.strictEqual(fresh(''), false);
  fresh('b'); fresh('c');
  assert.strictEqual(fresh('a'), true, 'pencere kaydı');
});

// Sahte WebSocket: el sıkışmayı ve eski birincile düşüşü sürer
function fakeWs(script) {
  const made = [];
  class WS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = []; made.push(this);
      setTimeout(() => script(this), 0);
    }
    send(t) { this.sent.push(JSON.parse(t)); if (this.onsent) this.onsent(JSON.parse(t)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  return { WS, made };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('istemci: HMAC sınaması; birincil parolayı kanıtlamazsa bağlanılmaz', async () => {
  const secret = 's'.repeat(20);
  let opened = 0;
  const msgs = [];
  const { WS, made } = fakeWs((ws) => {
    ws.readyState = 1; ws.onopen();
    ws.onsent = (m) => {
      if (m.type === 'peer-auth') {
        assert.strictEqual(m.mac, R.peerMac(secret, 'c', 'n1'), 'yedek sınamayı parolayla yanıtlar');
        ws.onmessage({ data: JSON.stringify({ type: 'peer-welcome', mac: R.peerMac(secret, 's', m.nonce) }) });
        ws.onmessage({ data: JSON.stringify({ type: 'beat', seq: 1 }) });
      }
    };
    ws.onmessage({ data: JSON.stringify({ type: 'beat', seq: 0 }) }); // sınamadan önce: yok sayılır
    ws.onmessage({ data: JSON.stringify({ type: 'peer-challenge', nonce: 'n1' }) });
  });
  const c = R.createClient({ urls: ['ws://h/ws?kind=peer&auth=hmac', 'ws://h/ws?kind=peer&token=x'], secret, WebSocket: WS, onOpen: () => opened++, onMessage: (m) => msgs.push(m) });
  await wait(20);
  assert.strictEqual(opened, 1);
  assert.strictEqual(c.mode, 'hmac');
  assert.deepStrictEqual(msgs.map((m) => m.seq), [1]);
  assert.ok(!/token=/.test(made[0].url), 'parola URL\'de yok');
  c.close();
  // Sahte birincil: yanlış kanıt
  let opened2 = 0;
  const fake = fakeWs((ws) => {
    ws.readyState = 1; ws.onopen();
    ws.onsent = (m) => { if (m.type === 'peer-auth') ws.onmessage({ data: JSON.stringify({ type: 'peer-welcome', mac: 'deadbeef' }) }); };
    ws.onmessage({ data: JSON.stringify({ type: 'peer-challenge', nonce: 'n2' }) });
  });
  const c2 = R.createClient({ urls: ['ws://h/ws?kind=peer&auth=hmac'], secret, WebSocket: fake.WS, onOpen: () => opened2++ });
  await wait(20);
  assert.strictEqual(opened2, 0, 'sahte birincile bağlanılmaz');
  c2.close();
});

test('istemci: eski birincil sınama vermeden kapatırsa açık parolalı eski adres', async () => {
  let opened = 0;
  const { WS, made } = fakeWs((ws) => {
    if (/auth=hmac/.test(ws.url)) { ws.close(); return; } // eski sürüm: 401
    ws.readyState = 1; ws.onopen();
  });
  const c = R.createClient({ urls: [R.peerUrlHmac({ host: 'h', secret: 'x' }), R.peerUrl({ host: 'h', secret: 'x' })], secret: 'x', WebSocket: WS, onOpen: () => opened++ });
  await wait(300);
  assert.strictEqual(opened, 1);
  assert.strictEqual(c.mode, 'token');
  assert.ok(/auth=hmac/.test(made[0].url) && /token=/.test(made[1].url));
  c.close();
});

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

test('yayın sunucusu: HMAC eşleşmesi gerçek bağlantıda; yanlış parola düşer; eski token bir sürüm daha', { skip: typeof WebSocket === 'undefined' }, async () => {
  const S = require('../src/main/stream-server.js');
  const port = await freePort();
  const secret = 'h'.repeat(24);
  const opened = [];
  const got = [];
  await S.start({ port, lan: false, peerOnly: true }, {
    getConfig: () => ({ redundancy: { secret } }),
    onPeerOpen: (c) => { opened.push(c); S.sendJson(c, { type: 'hello' }); },
    onPeerMessage: (m) => got.push(m.type),
  });
  S.setPeerSecret(secret);
  try {
    const cfg = { host: '127.0.0.1', port, secret };
    let open1 = 0;
    const hello = [];
    const c = R.createClient({ urls: [R.peerUrlHmac(cfg)], secret, onOpen: () => open1++, onMessage: (m) => hello.push(m.type) });
    await wait(300);
    assert.strictEqual(open1, 1, 'iki yönlü kanıt');
    assert.strictEqual(S.peerCount(), 1);
    assert.strictEqual(S.legacyPeerCount(), 0);
    assert.deepStrictEqual(hello, ['hello']);
    c.send({ type: 'peer-beat', state: 'following', term: 2 });
    c.send({ type: 'ctl', id: 'x', action: 'nextScene' });
    c.send({ type: 'set', path: 'a', value: 1 });
    await wait(100);
    assert.deepStrictEqual(got, ['peer-beat', 'ctl'], 'izin listesi');
    c.close();
    // Yanlış parola: sınama geçilemez, yedek sayılmaz
    let open2 = 0;
    const bad = R.createClient({ urls: [R.peerUrlHmac(cfg)], secret: 'w'.repeat(24), onOpen: () => open2++ });
    await wait(300);
    assert.strictEqual(open2, 0);
    bad.close();
    // Eski sürüm: token= bir sürüm daha
    let open3 = 0;
    const old = R.createClient({ urls: [R.peerUrl(cfg)], secret, onOpen: () => open3++ });
    await wait(300);
    assert.strictEqual(open3, 1);
    assert.strictEqual(S.legacyPeerCount(), 1, 'gösteri öncesi denetim uyarır');
    old.close();
  } finally {
    await S.stop();
  }
});

test('ana süreç: kapı ölçer karesinde, çitli açılış, atış dönemi taşır, devralma dönemi artırır', () => {
  const m0 = MAIN.indexOf("ipcMain.on('audio-meter'");
  const meter = MAIN.slice(m0, MAIN.indexOf('\n});', m0));
  assert.match(meter, /const g = redAuth\.gates;/);
  assert.match(meter, /if \(g\.lighting\) dynamicLighting\.onAudioFrame/);
  assert.match(meter, /if \(g\.artnet && currentConfig/);
  assert.match(meter, /if \(g\.oscOut && currentConfig/);
  assert.match(meter, /if \(g\.openrgb && currentConfig/);
  assert.match(MAIN, /redAuth\.fenced = prevRole !== 'primary';/);
  assert.match(MAIN, /if \(st\.state === 'active' && !red\.wasActive\) redTerms\(\)\.bump\(redAuth\.beatTerm\);/);
  assert.match(MAIN, /urls: \[redundancy\.peerUrlHmac\(c\), redundancy\.peerUrl\(c\)\], secret: c\.secret,/);
  // Bırakınca ve kayıptan dönünce taze kopya
  assert.match(MAIN, /red\.client\.send\(\{ type: 'peer-resync' \}\);\n    \}\n  \}\n  red\.wasActive/);
  assert.match(MAIN, /st\.state === 'following' && red\.prevFollowState && red\.prevFollowState !== 'following'/);
  // macOS App Nap
  assert.match(MAIN, /powerSaveBlocker\.start\('prevent-app-suspension'\)/);
  // İzin listesi sunucuda
  assert.match(read('src/main/stream-server.js'), /'peer-beat', 'peer-info', 'ctl', 'ctl-result', 'mon', 'mon-frame', 'handback'/);
});

/* UDP için boş kapı: TCP'de boş olan kapı UDP'de dolu olabilir (tanık
   reuseAddr ile bağlanıyor, paket öteki sokete gidebilir). */
function freeUdpPort() {
  const dgram = require('dgram');
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('error', reject);
    s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Koşul gerçekleşene dek bekler; sabit bekleme yavaş CI makinesinde yetmiyordu
async function until(cond, ms, what) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) assert.fail('beklenen olmadı: ' + what);
    await wait(10);
  }
}

/* Eskiden sabit 80 ms bekliyordu: Windows CI'da tanık o sürede bağlanmadığı
   ya da paket gelmediği için düştü, açık kalan soketler de dosyanın sürecini
   kapatmadı ve koşu 17 dakika asılı kaldı (Node 20). Artık bağlanma ve
   paketin işlenmesi beklenir, soketler her durumda kapanır. */
test('Art-Net: sıfır kare, ArtDmx çözümü, tanık yabancı kaynağı görüyor', { timeout: 20000 }, async (t) => {
  const A = require('../src/main/artnet');
  const dgram = require('dgram');
  const pkt = A.buildPacket({ universe: 7 }, Buffer.alloc(8));
  assert.deepStrictEqual(A.parseDmx(pkt), { universe: 7, length: 8 });
  assert.strictEqual(A.parseDmx(Buffer.from('not art-net packet')), null);
  const open = [];
  t.after(() => { for (const x of open) { try { x.stop ? x.stop() : x.close(); } catch { /* kapalı */ } } });
  const listening = (w) => until(() => {
    if (w.status().error) assert.fail('tanık bağlanamadı: ' + w.status().error);
    return w.status().listening;
  }, 5000, 'tanık bağlansın');
  const send = (s, buf, port) => new Promise((r) => s.send(buf, port, '127.0.0.1', r));

  const port = await freeUdpPort();
  const w = A.createWitness({ port, universe: 7, own: [] });
  open.push(w);
  w.start();
  await listening(w);
  const s = dgram.createSocket('udp4');
  open.push(s);
  // Önce başka evren, sonra aynı evren: ikincisi görülünce ilki de işlenmiştir
  await send(s, A.buildPacket({ universe: 2 }, Buffer.alloc(8)), port);
  await send(s, pkt, port);
  await until(() => w.foreign().length > 0, 5000, 'aynı evrendeki paket görülsün');
  assert.deepStrictEqual(w.foreign(), ['127.0.0.1'], 'yalnız aynı evren');
  assert.deepStrictEqual(w.foreign(Date.now() + 5000), [], 'pencere dışında unutulur');
  w.stop();

  // Kendi adresimiz sayılmaz. `own` her eşleşen pakette sorulur: soruldu
  // demek paket işlendi demek, sonuç beklemeden okunabilir.
  let asked = 0;
  const w2 = A.createWitness({ port, universe: 7, own: () => { asked++; return ['127.0.0.1']; } });
  open.push(w2);
  w2.start();
  await listening(w2);
  await send(s, pkt, port);
  await until(() => asked > 0, 5000, 'kendi paketimiz işlensin');
  assert.deepStrictEqual(w2.foreign(), []);
});

test('gösteri öncesi denetim: iki yönetici, çit, eski eşleşme, Art-Net hedefi', () => {
  const P = require('../src/main/preshow');
  const row = (r, extra) => P.evaluate(Object.assign({ redundancy: r }, extra || {})).checks;
  const ids = (c) => c.map((x) => x.id + ':' + x.state);
  assert.ok(ids(row({ role: 'primary', peers: 1, show: { differences: 0 }, split: 'artnet' })).includes('authority:fail'));
  assert.ok(ids(row({ role: 'primary', peers: 1, show: { differences: 0 }, fenced: true })).includes('authority:warn'));
  assert.ok(ids(row({ role: 'primary', peers: 1, show: { differences: 0 }, legacyPeers: 1 })).includes('pairing:warn'));
  const art = row({ role: 'primary', peers: 1, show: { differences: 0 }, outputs: { artnet: 'always' }, peerInfo: { artnet: { host: 'x', universe: 1, mode: 'always' } } }, { artnet: { host: 'x', universe: 1 } });
  assert.ok(ids(art).includes('artnet:warn'));
  assert.ok(!ids(row({ role: 'off' })).some((x) => /^(authority|pairing|artnet):/.test(x)), 'rol kapalıyken satır yok');
});
