'use strict';
/* Ağ LED çıkışları: sACN (E1.31), WLED DDP + keşif, WLED ses senkronu.
   Gerçek donanım yok: paket baytları birim olarak, gönderim 127.0.0.1
   üzerindeki UDP dinleyicilerle, WLED /json/info sahte HTTP sunucusuyla,
   mDNS cevabı elle kurulmuş paketle ve yerel sahte yanıtlayıcıyla doğrulanır. */
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');

const artnet = require('../src/main/artnet');
const sacn = require('../src/main/sacn');
const ddp = require('../src/main/ddp');
const sync = require('../src/main/wled-audiosync');
const mdns = require('../src/shared/osc-mdns');
global.window = global.window || {};
require('../src/shared/defaults.js');

const FRAME = { level: 0.5, bass: 0.6, mid: 0.3, treble: 0.2, time: 2, backgroundColors: ['#ff0000', '#00ff00', '#0000ff'] };

function listen() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const got = [];
    const waiters = [];
    s.on('message', (m, r) => { got.push({ m, r }); waiters.splice(0).forEach((w) => w()); });
    s.bind(0, '127.0.0.1', () => resolve({
      port: s.address().port,
      got,
      next: (n) => new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('UDP zaman aşımı')), 2000);
        const check = () => { if (got.length >= n) { clearTimeout(t); res(got); } else waiters.push(check); };
        check();
      }),
      close: () => new Promise((r) => s.close(r)),
    }));
  });
}

const cfgDefaults = () => global.window.SV.defaultConfig();

test('varsayılanlar: üç çıkış da kapalı', () => {
  const d = cfgDefaults();
  assert.strictEqual(d.sacn.enabled, false);
  assert.strictEqual(d.wled.enabled, false);
  assert.strictEqual(d.wledSync.enabled, false);
  assert.strictEqual(d.sacn.host, '', 'sACN varsayılanı multicast');
  assert.strictEqual(d.wled.host, '', 'WLED adresi boş: hiçbir yere gönderilmez');
});

test('sACN: E1.31 başlık alanları ve kanal verisi', () => {
  const cfg = { universe: 7, priority: 150, sourceName: 'SV Test', fixtures: 4, channelsPerFixture: 3, mode: 'palette' };
  const data = artnet.buildChannels(cfg, FRAME);
  const p = sacn.buildPacket(cfg, data, { seq: 42 });
  assert.strictEqual(p.length, 126 + data.length);
  assert.strictEqual(p.readUInt16BE(0), 0x0010);
  assert.strictEqual(p.toString('ascii', 4, 13), 'ASC-E1.17');
  assert.strictEqual(p.readUInt16BE(16) & 0x0fff, p.length - 16);
  assert.strictEqual(p.readUInt16BE(16) >> 12, 0x7);
  assert.strictEqual(p.readUInt32BE(18), 4);
  assert.strictEqual(p.readUInt16BE(38) & 0x0fff, p.length - 38);
  assert.strictEqual(p.readUInt32BE(40), 2);
  assert.strictEqual(p.readUInt16BE(115) & 0x0fff, p.length - 115);
  assert.strictEqual(p[117], 0x02);
  assert.strictEqual(p[118], 0xa1);
  assert.strictEqual(p.readUInt16BE(121), 1);
  assert.strictEqual(p.readUInt16BE(123), data.length + 1);
  const r = sacn.parsePacket(p);
  assert.strictEqual(r.universe, 7);
  assert.strictEqual(r.priority, 150);
  assert.strictEqual(r.sequence, 42);
  assert.strictEqual(r.sourceName, 'SV Test');
  assert.strictEqual(r.startCode, 0);
  assert.ok(r.data.equals(data), 'kanal verisi Art-Net üreticisiyle aynı');
});

test('sACN: sıra numarası ilerler ve 255 sonra 0 olur; evren/öncelik sınırlanır', () => {
  const a = sacn.parsePacket(sacn.buildPacket({ universe: 0, priority: 999 }, Buffer.alloc(3)));
  const b = sacn.parsePacket(sacn.buildPacket({ universe: 70000 }, Buffer.alloc(3)));
  assert.strictEqual((a.sequence + 1) & 0xff, b.sequence);
  assert.strictEqual(a.universe, 1);
  assert.strictEqual(a.priority, 200);
  assert.strictEqual(b.universe, 63999);
  assert.strictEqual(sacn.parsePacket(sacn.buildPacket({}, Buffer.alloc(0), { terminated: true })).terminated, true);
});

test('sACN: multicast adresi evrenden türetilir; host verilirse unicast', () => {
  assert.strictEqual(sacn.multicastHost(1), '239.255.0.1');
  assert.strictEqual(sacn.multicastHost(300), '239.255.1.44');
  assert.strictEqual(sacn.targetHost({ universe: 2 }), '239.255.0.2');
  assert.strictEqual(sacn.targetHost({ universe: 2, host: ' 10.0.0.5 ' }), '10.0.0.5');
});

test('sACN: 127.0.0.1 dinleyicisine gerçek paket gider; kapanışta akış-bitti', async () => {
  const L = await listen();
  const cfg = { enabled: true, host: '127.0.0.1', port: L.port, universe: 3, fixtures: 2, fps: 44 };
  try {
    const st = await sacn.start(cfg);
    assert.strictEqual(st.running, true);
    assert.strictEqual(sacn.send(cfg, FRAME), true);
    await L.next(1);
    const r = sacn.parsePacket(L.got[0].m);
    assert.strictEqual(r.universe, 3);
    assert.strictEqual(r.data.length, 6);
    await sacn.stop(cfg);
    await L.next(4);
    assert.strictEqual(sacn.parsePacket(L.got[1].m).terminated, true);
    assert.strictEqual(sacn.status().running, false);
    assert.strictEqual(sacn.send(cfg, FRAME), false, 'durunca gönderilmez');
  } finally {
    await sacn.stop();
    await L.close();
  }
});

test('sACN: kapalı ayarla start soket açmaz', async () => {
  const st = await sacn.start({ enabled: false });
  assert.strictEqual(st.running, false);
  assert.strictEqual(sacn.send({ enabled: false }, FRAME), false);
});

test('DDP: başlık, parçalama ve PUSH yalnız son pakette', () => {
  const pixels = Buffer.alloc(1000 * 3, 7);
  const pk = ddp.buildPackets(pixels, { seq: 5 });
  assert.strictEqual(pk.length, 3); // 480 + 480 + 40
  const parsed = pk.map(ddp.parsePacket);
  assert.deepStrictEqual(parsed.map((p) => p.offset), [0, 1440, 2880]);
  assert.deepStrictEqual(parsed.map((p) => p.length), [1440, 1440, 120]);
  assert.deepStrictEqual(parsed.map((p) => p.push), [false, false, true]);
  for (const p of parsed) {
    assert.strictEqual(p.sequence, 5);
    assert.strictEqual(p.type, 0x0b);
    assert.strictEqual(p.id, 1);
  }
  assert.strictEqual(pk[0][0], 0x40);
  assert.strictEqual(pk[2][0], 0x41);
  assert.strictEqual(pk[0].length, 10 + 1440);
});

test('DDP: sıra 1..15 arasında döner, 0 kullanılmaz', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(ddp.parsePacket(ddp.buildPackets(Buffer.alloc(3))[0]).sequence);
  assert.ok(!seen.has(0));
  assert.strictEqual(Math.max(...seen), 15);
});

test('DDP: piksel sayısı = LED sayısı, renkler Art-Net renk mantığıyla aynı', () => {
  const cfg = { ledCount: 9, mode: 'bands', brightness: 1 };
  const px = ddp.renderPixels(cfg, FRAME);
  assert.strictEqual(px.length, 27);
  const dmx = artnet.buildChannels({ fixtures: 9, channelsPerFixture: 3, mode: 'bands', brightness: 1 }, FRAME);
  assert.ok(px.equals(dmx.subarray(0, 27)));
  assert.strictEqual(ddp.renderPixels({ ledCount: 99999 }, FRAME).length, 4096 * 3);
});

test('DDP: host yoksa başlamaz; host varsa 127.0.0.1 dinleyicisine kare gider', async () => {
  const none = await ddp.start({ enabled: true, host: '' });
  assert.strictEqual(none.running, false);
  assert.strictEqual(none.error, 'no-host');
  const L = await listen();
  const cfg = { enabled: true, host: '127.0.0.1', port: L.port, ledCount: 600, fps: 60 };
  try {
    assert.strictEqual((await ddp.start(cfg)).running, true);
    assert.strictEqual(ddp.send(cfg, FRAME), true);
    await L.next(2);
    const p = L.got.map((g) => ddp.parsePacket(g.m));
    assert.strictEqual(p[0].length + p[1].length, 1800);
    assert.ok(p.some((x) => x.push));
  } finally {
    await ddp.stop();
    await L.close();
  }
});

test('WLED: /json/info sahte sunucudan LED sayısı okunur; kötü adres reddedilir', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/json/info') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: 'Masa', ver: '0.15.0', leds: { count: 144, rgbw: false } }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const info = await ddp.fetchInfo('127.0.0.1:' + srv.address().port, 1500);
    assert.deepStrictEqual(info, { ok: true, name: 'Masa', version: '0.15.0', leds: 144, rgbw: false });
  } finally { srv.close(); }
  assert.strictEqual((await ddp.fetchInfo('http://x/../../')).error, 'bad-host');
  assert.strictEqual(ddp.parseHost('wled.local').port, 80);
  assert.strictEqual(ddp.parseHost('10.0.0.2:8080').port, 8080);
  assert.strictEqual(ddp.parseHost('a b'), null);
});

// Sahte WLED mDNS cevabı: PTR + SRV + A
function fakeAnswer(id, inst, hostName, ip, port) {
  const rec = (name, type, rdata) => {
    const n = mdns.encodeName(name);
    const h = Buffer.alloc(10);
    h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt32BE(120, 4); h.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([n, h, rdata]);
  };
  const srv = Buffer.concat([Buffer.from([0, 0, 0, 0, port >> 8, port & 255]), mdns.encodeName(hostName)]);
  const recs = [
    rec('_wled._tcp.local', 12, mdns.encodeName(inst + '._wled._tcp.local')),
    rec(inst + '._wled._tcp.local', 33, srv),
    rec(hostName, 1, Buffer.from(ip.split('.').map(Number))),
  ];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0); head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(recs.length, 6);
  return Buffer.concat([head].concat(recs));
}

test('mDNS: sorgu _wled._tcp PTR sorar; cevap ad, IP ve port verir', () => {
  const q = ddp.buildQuery(77);
  const qs = mdns.questions(q);
  assert.deepStrictEqual(qs, [{ name: '_wled._tcp.local', type: 12, cls: 1 }]);
  const list = ddp.parseResponse(fakeAnswer(77, 'wled-tavan', 'wled-tavan.local', '192.168.1.44', 80), { address: '192.168.1.44' });
  assert.deepStrictEqual(list, [{ name: 'wled-tavan', host: '192.168.1.44', port: 80 }]);
  assert.deepStrictEqual(ddp.parseResponse(Buffer.alloc(5)), []);
});

test('mDNS keşfi: yerel sahte yanıtlayıcıdan aygıt bulunur', async () => {
  const resp = dgram.createSocket('udp4');
  resp.on('message', (m, r) => {
    const qs = mdns.questions(m);
    if (qs.some((x) => x.name === '_wled._tcp.local')) resp.send(fakeAnswer(m.readUInt16BE(0), 'wled-a', 'wled-a.local', '127.0.0.1', 80), r.port, r.address);
  });
  await new Promise((r) => resp.bind(0, '127.0.0.1', r));
  try {
    const r = await ddp.discover({ ms: 400, address: '127.0.0.1', port: resp.address().port });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.devices, [{ name: 'wled-a', host: '127.0.0.1', port: 80 }]);
  } finally { resp.close(); }
});

test('WLED ses senkronu: 44 baytlık v2 paketi', () => {
  const st = { smooth: 0, bassAvg: 0.1, lastPeak: 0, frame: 0 };
  const spectrum = Array.from({ length: 16 }, (_, i) => (i === 3 ? 1 : i / 32));
  const p = sync.buildPacket({ level: 0.5, bass: 0.9, spectrum }, st, 1000);
  assert.strictEqual(p.length, 44);
  assert.strictEqual(p.toString('ascii', 0, 5), '00002');
  assert.strictEqual(p[5], 0);
  const r = sync.parsePacket(p);
  assert.ok(Math.abs(r.sampleRaw - 127.5) < 0.01);
  assert.strictEqual(r.samplePeak, 1, 'bas ortalamasının çok üstünde: vuruş');
  assert.strictEqual(r.frameCounter, 1);
  assert.strictEqual(r.fft[3], 255);
  assert.strictEqual(r.fft.length, 16);
  assert.ok(r.majorPeak > 50 && r.majorPeak < 200, 'baskın frekans 4. bant merkezinde: ' + r.majorPeak);
  // hemen ardından ikinci vuruş sayılmaz (120 ms)
  assert.strictEqual(sync.parsePacket(sync.buildPacket({ level: 0.5, bass: 1 }, st, 1050)).samplePeak, 0);
  // perde analizi varsa o kullanılır
  assert.ok(Math.abs(sync.parsePacket(sync.buildPacket({ analysis: { pitchHz: 440 } }, st, 2000)).majorPeak - 440) < 0.01);
});

test('WLED ses senkronu: spektrum yoksa bas/orta/tiz bantlara yayılır', () => {
  const b = sync.bands16({ bass: 1, mid: 0.5, treble: 0 });
  assert.strictEqual(b.length, 16);
  assert.strictEqual(b[0], 1);
  assert.strictEqual(b[8], 0.5);
  assert.strictEqual(b[15], 0);
});

test('WLED ses senkronu: 127.0.0.1:port dinleyicisine paket gider', async () => {
  const L = await listen();
  const cfg = { enabled: true, host: '127.0.0.1', port: L.port, fps: 60 };
  try {
    assert.strictEqual((await sync.start(cfg)).running, true);
    assert.strictEqual(sync.send(cfg, FRAME), true);
    await L.next(1);
    assert.ok(sync.parsePacket(L.got[0].m));
  } finally {
    await sync.stop();
    await L.close();
  }
});

test('ana süreç: ağ LED çıkışları Art-Net yetki kapısından geçer ve otomasyonda kapalı', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /if \(g\.artnet && currentConfig\) \{[\s\S]{0,200}sacn\.send\(/);
  assert.match(main, /function syncLedNet\(\)[\s\S]{0,200}HW_OFF \? \{ enabled: false \}/);
  assert.match(main, /'wled:discover', \(\) => \(HW_OFF/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
  assert.match(html, /<script src="led-net-panel\.js"><\/script>/);
});

test('çeviri: panel metinlerinin İngilizcesi var', () => {
  global.window = global.window || {};
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.js'), 'utf8');
  for (const k of ['sACN (E1.31) Çıkışı', 'WLED (DDP) Çıkışı', 'WLED Ses Senkronu', 'Ağda WLED Bul', 'LED Sayısını Al', 'Öncelik']) {
    assert.ok(i18n.includes("'" + k + "':"), k);
  }
});
