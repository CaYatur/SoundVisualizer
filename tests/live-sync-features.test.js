'use strict';
/* Tempo eşleme (Ableton Link + MIDI saati), oyun kumandası, ekran
 * koruyucu, oturum kurtarma ve çoklu kopya kumandası. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const MC = require('../src/shared/midi-clock.js');
const GP = require('../src/shared/gamepad-map.js');
const SS = require('../src/shared/screensaver.js');
const LT = require('../src/main/link-tempo.js');
const RP = require('../src/main/remote-peers.js');
const SR = require('../src/main/session-recovery.js');
const mcp = require('../src/shared/mcp.js');

test('MIDI saati: 24 ppqn darbeden BPM', () => {
  const c = MC.create();
  const iv = 60000 / (128 * 24);
  c.message(0xfa, 0);
  for (let i = 0; i < 60; i++) c.message(0xf8, i * iv);
  assert.strictEqual(c.bpm(59 * iv), 128);
  assert.strictEqual(c.running(), true);
  assert.strictEqual(c.bpm(59 * iv + 1000), 0); // saat durdu
  assert.strictEqual(MC.shouldApply(128, 128.05), false);
  assert.strictEqual(MC.shouldApply(120, 128), true);
});

test('MIDI saati çıkışı: 120 BPM 24 darbe, durunca bir kez durdur', () => {
  const o = MC.createOut();
  const iv = 60000 / (120 * MC.PPQN);
  assert.deepStrictEqual(o.pull(0, 120, true), [0xfa, 0xf8]);
  assert.deepStrictEqual(o.pull(iv - 0.01, 120, true), []);
  assert.deepStrictEqual(o.pull(iv, 120, true), [0xf8]);
  assert.deepStrictEqual(o.pull(iv * 3, 120, true), [0xf8, 0xf8]);
  assert.strictEqual(o.running(), true);
  assert.deepStrictEqual(o.pull(iv * 3, 120, false), [0xfc]);
  assert.deepStrictEqual(o.pull(iv * 4, 0, false), []);
  assert.strictEqual(o.running(), false);
  // Birikmiş duraklama en çok 4 darbe yollar
  const late = MC.createOut();
  late.pull(0, 120, true);
  const burst = late.pull(iv * 100, 120, true).filter((b) => b === 0xf8);
  assert.ok(burst.length > 0 && burst.length <= 4, 'yığılma: ' + burst.length);
});

test('MIDI saati çıkışı: başlat ve darbe ayrı mesaj gider', () => {
  const sent = [];
  const output = {
    send(data) {
      if (!data || data.length !== 1) throw new TypeError('Invalid MIDI data');
      sent.push(data[0]);
    },
  };
  const bytes = MC.createOut().pull(0, 120, true);
  assert.deepStrictEqual(bytes, [0xfa, 0xf8]);
  assert.strictEqual(MC.sendRealtime(output, bytes), 2);
  assert.deepStrictEqual(sent, [0xfa, 0xf8]);
  assert.deepStrictEqual(MC.realtimeMessages([0xf8, 0xf8]), [[0xf8], [0xf8]]);
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/control.js'), 'utf8');
  const fn = src.slice(src.indexOf('function sendClock'), src.indexOf('function clockOutTick'));
  assert.match(fn, /sendRealtime\(outs\[i\], bytes\)/);
  assert.doesNotMatch(fn, /output\.send\(bytes\)/);
});

test('MIDI saati çıkışı: otomatik seçim dinlenen adı atlar, kimlik seçilirse onu yollar', () => {
  const outs = [
    { id: 'a', name: 'Launchpad', state: 'connected' },
    { id: 'b', name: 'IAC', state: 'connected' },
    { id: 'c', name: 'Gone', state: 'disconnected' },
  ];
  assert.deepStrictEqual(MC.pickOut(outs, 'auto', ['IAC']).map((x) => x.id), ['a']);
  assert.deepStrictEqual(MC.pickOut(outs, 'b', ['IAC']).map((x) => x.id), ['b']);
  assert.deepStrictEqual(MC.pickOut(outs, 'missing', []), []);
});

test('MIDI saati çıkışı varsayılan kapalı', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const ts = global.window.SV.defaultConfig().tempoSync;
  // Alan defaults.js'te değil: o dosya mod küçük resmi anahtarına giriyor,
  // saat ayarı resmi değiştirmez. Yokluk kapalı demektir; kayıtlı anahtar kalır.
  assert.ok(!ts.clockOut);
  assert.strictEqual(ts.clockOutDevice, undefined);
  assert.strictEqual(ts.source, 'off');
});

function linkPacket(type, bpm) {
  const head = Buffer.concat([LT.MAGIC, Buffer.from([type, 5, 0, 0]), Buffer.from('0102030405060708', 'hex')]);
  const v = Buffer.alloc(24);
  v.writeBigInt64BE(BigInt(Math.round(60e6 / bpm)), 0);
  const k = Buffer.alloc(8); k.write('tmln', 0, 'latin1'); k.writeUInt32BE(24, 4);
  return Buffer.concat([head, k, v]);
}

test('Ableton Link paketinden tempo', () => {
  assert.strictEqual(LT.parsePacket(linkPacket(1, 125)).bpm, 125);
  assert.strictEqual(LT.parsePacket(linkPacket(3, 125)).type, 3);
  assert.strictEqual(LT.parsePacket(Buffer.from('rastgele veri 1234567890')), null);
});

test('Link dinleyicisi tempo ve eş sayısını bildirir', () => {
  const EventEmitter = require('events');
  const sock = new EventEmitter();
  sock.bind = (p, cb) => cb && cb();
  sock.addMembership = () => {};
  sock.close = () => {};
  const seen = [];
  const l = LT.createListener((s) => seen.push(s), { createSocket: () => sock });
  l.start();
  sock.emit('message', linkPacket(1, 140));
  l.stop();
  assert.deepStrictEqual(seen[0], { bpm: 140, peers: 1 });
});

test('oyun kumandası: fark olayları, öğrenme ve eşleme', () => {
  const pads = [{ index: 0, connected: true, buttons: [{ value: 0 }, { value: 1, pressed: true }], axes: [0.03, -1] }];
  const r = GP.diff({}, pads);
  assert.ok(r.events.some((e) => e.kind === 'button' && e.index === 1 && e.value01 === 1));
  assert.ok(r.events.some((e) => e.kind === 'axis' && e.index === 1 && e.value01 === 0));
  assert.ok(!r.events.some((e) => e.kind === 'axis' && e.index === 0)); // ölü bölge
  assert.deepStrictEqual(GP.learnFrom(r.events), { kind: 'button', index: 1, pad: -1 });
  assert.ok(GP.matches({ kind: 'button', index: 1, pad: -1 }, r.events.find((e) => e.kind === 'button')));
  assert.strictEqual(GP.diff(r.state, pads).events.length, 0);
});

test('mcp: control.gamepad geçerli bir yüzey', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'mcp.js'), 'utf8');
  assert.match(src, /surfaces = \['midi', 'osc', 'gamepad'(, 'artnet', 'mtc')?\]/);
  assert.ok(mcp);
});

test('ekran koruyucu: sessizlikte girer, sesle çıkar', () => {
  const s = SS.create();
  const cfg = { enabled: true, idleSec: 10, fadeSec: 1 };
  for (let i = 0; i < 100; i++) SS.update(s, { silent: true, dt: 0.1, cfg });
  assert.ok(s.amount === 0);
  for (let i = 0; i < 20; i++) SS.update(s, { silent: true, dt: 0.1, cfg });
  assert.strictEqual(s.amount, 1);
  SS.update(s, { silent: false, dt: 0.1, cfg });
  assert.ok(s.amount < 0.6);
  SS.update(s, { silent: true, dt: 0.5, cfg: { enabled: false } });
  assert.strictEqual(s.amount, 0);
});

test('oturum kurtarma: çöküş işareti, dönen kopyalar, bozuk kopya atlanır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svrec-'));
  let t = Date.UTC(2026, 0, 1);
  const r = SR.create({ dir, keep: 3, now: () => (t += 1000) });
  assert.strictEqual(r.begin(), null);
  for (let i = 0; i < 5; i++) r.snapshot({ n: i });
  assert.strictEqual(r.snapshot({ n: 4 }), false); // değişmedi
  assert.strictEqual(r.files().length, 3);
  fs.writeFileSync(path.join(dir, SR.PREFIX + '9999.json'), '{bozuk');
  assert.deepStrictEqual(r.latest().config, { n: 4 });
  // Kapanış olmadan yeniden açılış = çöküş
  const r2 = SR.create({ dir, keep: 3 });
  assert.ok(r2.begin());
  r2.end({ n: 5 });
  assert.strictEqual(SR.create({ dir }).begin(), null);
});

test('çoklu kopya: adres ayrıştırma ve döngüsüz aktarma', () => {
  const p = RP.parsePeers('http://192.168.1.21:8722/remote?token=abc\nhttps://h.local:9000/remote\n\nbozuk::\nhttp://192.168.1.21:8722/remote?token=abc');
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].ws, 'ws://192.168.1.21:8722/ws?kind=remote&token=abc');
  assert.strictEqual(p[1].ws, 'wss://h.local:9000/ws?kind=remote');
  const sent = [];
  class FakeWS { constructor(u) { this.url = u; this.readyState = 1; } send(d) { sent.push([this.url, JSON.parse(d)]); } close() {} }
  const relay = RP.createRelay({ WebSocket: FakeWS });
  relay.update('http://a:1/remote?token=t');
  assert.strictEqual(relay.forward({ type: 'command', action: 'blackout' }), 1);
  assert.strictEqual(sent[0][1].relayed, true);
  assert.strictEqual(relay.forward(sent[0][1]), 0); // eşten gelen bir daha gitmez
  assert.strictEqual(relay.forward({ type: 'ping' }), 0);
  relay.stop();
});

test('eş adresleri (jetonlu) web istemcisine ve MCP okumasına gitmez', () => {
  const ss = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'stream-server.js'), 'utf8');
  assert.match(ss, /remotePeers: ''/);
  const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'mcp.js'), 'utf8');
  assert.match(m, /\['stream', 'remotePeers'\]/);
});
