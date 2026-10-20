'use strict';
/* SES KÖPRÜSÜ (#813): biçim, eşleşme, gerçek TCP üzerinden kare ve meta,
 * saat farkı, keşif işareti ve "Ağ köprüsü" girişinin geçiş makinesi.
 * Ağ sınamaları 127.0.0.1 ve rastgele port kullanıyor: Windows, macOS ve
 * Linux'ta aynı koşuyor (CI: Ubuntu ve Windows). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const B = require('../src/main/audio-bridge');
const F = require('../src/main/audio-frame');
const { createInputSwitch } = require('../src/main/bridge-input');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SECRET = 'bridge-secret-0123456789';

function sampleFrame(k) {
  return {
    sampleRate: 48000,
    freq: new Uint8Array(F.BINS).map((_, i) => (i + k) & 255),
    time: new Uint8Array(F.FFT_SIZE).map((_, i) => (i * 3 + k) & 255),
    left: new Uint8Array(F.FFT_SIZE).map((_, i) => (i * 5 + k) & 255),
    right: new Uint8Array(F.FFT_SIZE).map((_, i) => (i * 7 + k) & 255),
  };
}
const until = async (fn, ms) => {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  return fn();
};

test('kare: encodeFrame ↔ parseFrame birebir; eksik dizi sessizlik', () => {
  const f = sampleFrame(9);
  const g = F.parseFrame(F.encodeFrame(f));
  assert.strictEqual(g.sampleRate, 48000);
  for (const k of ['freq', 'time', 'left', 'right']) assert.deepStrictEqual(Array.from(g[k]), Array.from(f[k]), k);
  const e = F.parseFrame(F.encodeFrame({ sampleRate: 44100 }));
  assert.strictEqual(e.time[0], 128);
  assert.strictEqual(e.freq[0], 0);
  assert.strictEqual(F.encodeFrame(f).length, F.FRAME_BYTES);
});

test('paket: kare başlığı, sürüm ve bozuk uzunluk', () => {
  const pkt = B.framePacket(F.encodeFrame(sampleFrame(1)), 42, 123456.5);
  const got = [];
  const push = B.createParser((kind, payload) => got.push([kind, payload]));
  // Parça parça gelsin: TCP sınırları paket sınırı değil
  for (let i = 0; i < pkt.length; i += 1000) push(pkt.subarray(i, i + 1000));
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0][0], B.KIND.FRAME);
  const r = B.readFrame(got[0][1]);
  assert.strictEqual(r.seq, 42);
  assert.strictEqual(r.t, 123456.5);
  assert.strictEqual(r.frame.freq[3], 4);
  const bad = Buffer.from(got[0][1]); bad[0] = 99;
  assert.strictEqual(B.readFrame(bad).error, 'version');
  let err = '';
  const p2 = B.createParser(() => {}, (e) => { err = e; });
  const huge = Buffer.alloc(8); huge.writeUInt32BE(B.MAX_PACKET + 1, 0);
  p2(huge);
  assert.strictEqual(err, 'length');
  // JSON paketinde biçim sürümü var
  const j = B.jsonPacket({ type: 'x' });
  assert.strictEqual(JSON.parse(j.subarray(5).toString()).v, B.WIRE_VERSION);
});

test('ayar: parola en az 16 karakter; port aralığı; varsayılanlar', () => {
  assert.strictEqual(B.problem({}), '');
  assert.strictEqual(B.problem({ send: true, secret: 'kısa' }), 'secret');
  assert.strictEqual(B.problem({ receive: true, secret: SECRET }), '');
  const n = B.normalize({ port: 80, fallback: 0, send: 'yes' });
  assert.strictEqual(n.port, B.DEFAULT_PORT);
  assert.strictEqual(n.fallback, true);
  assert.strictEqual(n.send, false);
  assert.ok(B.newSecret().length >= 16);
  // Varsayılan ayar aynı biçimde
  const saved = global.window;
  global.window = {};
  let def;
  try {
    delete require.cache[require.resolve('../src/shared/defaults.js')];
    require('../src/shared/defaults.js');
    def = global.window.SV.defaultConfig();
  } finally { if (saved === undefined) delete global.window; else global.window = saved; }
  assert.deepStrictEqual(Object.keys(def.bridge).sort(), Object.keys(B.DEFAULTS).sort());
});

test('TCP: eşleşen alıcı kare ve meta alıyor, saat farkı ölçülüyor', async () => {
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET, name: 'Köprü', id: 'abc' });
  const st = await sender.start();
  assert.ok(st.listening, JSON.stringify(st));
  sender.meta({ has: true, title: 'Parça', artist: 'Sanatçı', artwork: 'x'.repeat(300 * 1024) });
  const frames = [];
  let meta = null;
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: SECRET, onFrame: (f, info) => frames.push([f, info]), onMeta: (m) => { meta = m; } });
  rx.start();
  try {
    await until(() => sender.peerCount() === 1);
    assert.strictEqual(sender.peerCount(), 1);
    for (let i = 0; i < 5; i++) sender.frame(sampleFrame(i));
    await until(() => frames.length === 5 && meta && rx.status().rttMs != null);
    assert.strictEqual(frames.length, 5);
    assert.deepStrictEqual(Array.from(frames[4][0].left.subarray(0, 4)), Array.from(sampleFrame(4).left.subarray(0, 4)));
    assert.strictEqual(frames[4][1].seq, 5);
    assert.strictEqual(meta.title, 'Parça');
    assert.ok(!('artwork' in meta), 'büyük kapak resmi ağa gitmiyor');
    const s = rx.status();
    assert.strictEqual(s.state, 'connected');
    assert.strictEqual(s.name, 'Köprü');
    assert.ok(Math.abs(s.offsetMs) < 50, 'aynı makine: saat farkı ~0 (' + s.offsetMs + ')');
    assert.ok(s.ageMs != null && s.ageMs < 1000);
  } finally {
    rx.stop();
    await sender.stop();
  }
});

test('TCP: yanlış parola kare almıyor; köprü de parolayı kanıtlamalı', async () => {
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET });
  const st = await sender.start();
  const frames = [];
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: 'baska-bir-parola-123456', onFrame: (f) => frames.push(f) });
  rx.start();
  try {
    await until(() => rx.status().error === 'auth' || rx.status().error, 3000);
    sender.frame(sampleFrame(1));
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(sender.peerCount(), 0);
    assert.strictEqual(frames.length, 0);
  } finally { rx.stop(); await sender.stop(); }

  // Sahte köprü: parolayı bilmeyen sunucu "welcome" yollasa da alıcı kabul etmez
  const net = require('net');
  const fake = net.createServer((sock) => {
    sock.write(B.jsonPacket({ type: 'hello', nonce: 'n' }));
    sock.on('data', () => sock.write(B.jsonPacket({ type: 'welcome', mac: 'deadbeef' })));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const rx2 = B.createReceiver({ host: '127.0.0.1', port: fake.address().port, secret: SECRET });
  rx2.start();
  try {
    await until(() => rx2.status().error === 'auth', 3000);
    assert.strictEqual(rx2.status().error, 'auth');
    assert.notStrictEqual(rx2.status().state, 'connected');
  } finally { rx2.stop(); await new Promise((r) => fake.close(r)); }
});

test('TCP: köprü kapanınca alıcı yeniden bağlanıyor', async () => {
  const sender = B.createSender({ port: 0, host: '127.0.0.1', secret: SECRET });
  const st = await sender.start();
  const rx = B.createReceiver({ host: '127.0.0.1', port: st.port, secret: SECRET });
  rx.start();
  let s2 = null;
  try {
    await until(() => rx.status().state === 'connected');
    await sender.stop();
    await until(() => rx.status().state !== 'connected');
    s2 = B.createSender({ port: st.port, host: '127.0.0.1', secret: SECRET });
    await s2.start();
    await until(() => rx.status().state === 'connected', 6000);
    assert.strictEqual(rx.status().state, 'connected');
  } finally { rx.stop(); if (s2) await s2.stop(); }
});

test('saat: en kısa gidiş-dönüşün farkı seçiliyor', () => {
  const c = B.createClock(4);
  c.add(1000, 1600, 1100); // rtt 100, fark 550
  c.add(2000, 2510, 2020); // rtt 20, fark 500
  c.add(3000, 3700, 3300); // rtt 300
  const b = c.best();
  assert.strictEqual(b.rtt, 20);
  assert.strictEqual(b.offset, 500);
  assert.strictEqual(c.add(5, 1, 1), null, 'geri giden saat örneği atılır');
});

test('keşif: işaret imzalı, taze ve parolası tutan köprü eşleşiyor', () => {
  const o = { id: 'b1', name: 'Sahne', port: 8741, secret: SECRET };
  const now = 1e12;
  const msg = B.beaconMessage(o, now);
  assert.strictEqual(B.verifyBeacon(msg, SECRET, now + 500).paired, true);
  const wrong = B.verifyBeacon(msg, 'baska-bir-parola-123456', now);
  assert.strictEqual(wrong.paired, false);
  assert.strictEqual(wrong.reason, 'secret');
  assert.strictEqual(B.verifyBeacon(msg, SECRET, now + 60000).reason, 'clock');
  assert.strictEqual(B.verifyBeacon(Buffer.from('çöp'), SECRET, now), null);
  assert.ok(!msg.toString().includes(SECRET), 'parola işarette yok');
});

test('keşif: her arayüzün yayın adresi', () => {
  const list = B.broadcastAddresses({
    eth: [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }],
    wifi: [{ family: 4, address: '10.0.5.7', netmask: '255.255.0.0', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    v6: [{ family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', internal: false }],
  });
  assert.deepStrictEqual(list.sort(), ['10.0.255.255', '192.168.1.255', '255.255.255.255'].sort());
});

test('keşif: UDP işareti gerçek soketten alınıyor', async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const found = [];
  const d = B.createDiscovery({ beaconPort: port, secret: SECRET, onChange: (l) => { found.splice(0, found.length, ...l); } });
  d.start();
  const dgram = require('dgram');
  const s = dgram.createSocket('udp4');
  try {
    await until(() => d.status().listening || d.status().error, 2000);
    if (!d.status().listening) { t.skip('UDP dinlenemedi: ' + d.status().error); return; }
    s.send(B.beaconMessage({ id: 'x1', name: 'Köprü', port: 8741, secret: SECRET }, Date.now()), port, '127.0.0.1');
    await until(() => found.length === 1, 2000);
    assert.strictEqual(found[0].id, 'x1');
    assert.strictEqual(found[0].paired, true);
    assert.strictEqual(found[0].host, '127.0.0.1');
  } finally { s.close(); d.stop(); }
});

test('giriş: köprü gelince geçiyor, susunca yerel girişe, kararlı dönünce geri', () => {
  const sw = createInputSwitch({ lossMs: 600, recoverMs: 2000, firstMs: 300 });
  assert.strictEqual(sw.state, 'waiting');
  assert.strictEqual(sw.wantLocal, true, 'beklerken yerel giriş çalışır');
  let t = 0;
  for (; t < 300; t += 15) sw.frame(t);
  assert.strictEqual(sw.state, 'waiting');
  sw.frame(300);
  assert.strictEqual(sw.state, 'bridge');
  assert.strictEqual(sw.useBridge, true);
  assert.strictEqual(sw.wantLocal, false, 'köprüdeyken yerel yakalama kapalı');
  // Köprü sustu
  assert.strictEqual(sw.tick(800), false);
  assert.strictEqual(sw.tick(901), true);
  assert.strictEqual(sw.state, 'fallback');
  assert.strictEqual(sw.wantLocal, true);
  // Titrek dönüş: aralarda boşluk varsa geçmiyor
  sw.frame(1000); sw.frame(1500); sw.frame(2200); sw.frame(2900);
  assert.strictEqual(sw.state, 'fallback');
  // Kesintisiz 2 sn
  for (t = 3000; t <= 5000; t += 15) sw.frame(t);
  assert.strictEqual(sw.state, 'bridge');
  assert.strictEqual(sw.status(5000).switches, 3);
});

test('giriş: yedek giriş kapalıysa köprü susunca yerel yakalama açılmıyor', () => {
  const sw = createInputSwitch({ fallback: false, firstMs: 0 });
  sw.frame(0);
  assert.strictEqual(sw.state, 'bridge');
  sw.tick(5000);
  assert.strictEqual(sw.state, 'fallback');
  assert.strictEqual(sw.wantLocal, false);
});

test('ana süreç: köprü kipi, yakalama ve dağıtım bağlantıları', () => {
  const M = read('src/main/main.js');
  // --bridge ayrı ayar klasörü, GPU kapalı, görüntü çıkışı yok
  assert.match(M, /const BRIDGE_FLAG = process\.argv\.includes\('--bridge'\);\nif \(BRIDGE_FLAG && !process\.argv\.includes\('--bridge-shared-profile'\)\) \{\n  try \{ app\.setPath\('userData', path\.join\(app\.getPath\('userData'\), 'bridge'\)\); \}/);
  assert.ok(M.indexOf("app.setPath('userData'") < M.indexOf('const SETTINGS_PATH ='), 'ayar yolu klasör değişince hesaplanmalı');
  assert.match(M, /if \(BRIDGE_ONLY\) app\.disableHardwareAcceleration\(\);/);
  assert.match(M, /function openVisualizer\(displayIds\) \{\n  \/\/[^\n]*\n  if \(BRIDGE_ONLY\) \{/);
  assert.match(M, /if \(!BRIDGE_ONLY \|\| process\.argv\.includes\('--panel'\)\) createAdminWindow\(\);/);
  assert.match(M, /if \(BRIDGE_ONLY && bridgeTray && !forceQuitApp\) return;/);
  // Yerel kare köprüye; köprüdeyken yerel kare görüntüye gitmez; köprünün karesi aynı dağıtımdan
  assert.match(M, /if \(bridge\.sender\) bridge\.sender\.frame\(frame\);\n[^\n]*\n      if \(bridge\.input && bridge\.input\.useBridge\) return;\n      deliverAudioFrame\(frame\);/);
  assert.match(M, /if \(bridge\.input\.useBridge\) deliverAudioFrame\(frame\);/);
  // Yakalama: alıcı varken açık, köprü girişindeyken yalnız yedek gerekince
  assert.match(M, /if \(bridge\.sender && bridge\.sender\.peerCount\(\) > 0\) return true;\n[^\n]*\n  if \(bridge\.input && !bridge\.input\.wantLocal\) return false;/);
  // Ayar değişince köprü kurulur; köprü kipinde çıkışlar kapalı
  assert.match(M, /syncBridge\(\); \/\/ ses köprüsü \(#813\)\n[^\n]*\n  if \(!BRIDGE_ONLY\) \{/);
  // Gösteri öncesi denetim etkin kaynağı görür
  assert.match(M, /audio: \{ wanted: captureWanted\(\) \|\| !!bridge\.input,/);
  // MCP parolayı okuyamaz/yazamaz
  assert.match(read('src/shared/mcp.js'), /\['bridge', 'secret'\]/);
});

test('gösteri öncesi denetim: köprü girişinin durumu', () => {
  const S = require('../src/main/preshow.js');
  const base = { displays: [], wantedDisplays: [], outputs: [], audio: { wanted: false }, missing: [], redundancy: { role: 'off' }, disks: [] };
  const by = (r) => (r.items || r.checks || r).find((x) => x.id === 'bridge');
  assert.strictEqual(by(S.evaluate(base)), undefined, 'köprü kapalıyken satır yok');
  assert.strictEqual(by(S.evaluate(Object.assign({}, base, { bridge: { receive: true, state: 'bridge' } }))).state, 'ok');
  assert.strictEqual(by(S.evaluate(Object.assign({}, base, { bridge: { receive: true, state: 'fallback' } }))).state, 'warn');
  assert.strictEqual(by(S.evaluate(Object.assign({}, base, { bridge: { receive: true, state: 'waiting', fallback: false } }))).state, 'fail');
  assert.strictEqual(by(S.evaluate(Object.assign({}, base, { bridge: { receive: true, problem: 'secret' } }))).state, 'fail');
});

test('panel: her Türkçe metnin İngilizcesi var; durumlar çiziliyor', () => {
  const src = read('src/admin/bridge-panel.js');
  const i18n = read('src/shared/i18n.js');
  const missing = [];
  const re = /(?:text: |tr\(|: |Row\()'((?:[^'\\]|\\.)*)'/g;
  for (const m of src.matchAll(re)) {
    const t = m[1].replace(/\\'/g, "'");
    if (!/[çğıöşüÇĞİÖŞÜ]/.test(t)) continue;
    if (!i18n.includes("'" + t.replace(/'/g, "\\'") + "':")) missing.push(t);
  }
  for (const t of ['Ses Köprüsü', 'Bir makinenin yakaladığı ses ağdaki başka makinelere gider; birincil ve yedek aynı sinyali çözümler.',
    'Ses köprüden', 'Ses köprüsü sessiz: yerel giriş', 'Ses köprüsü bekleniyor', 'Ses köprüsü ayarı eksik']) {
    if (!i18n.includes("'" + t + "':")) missing.push(t);
  }
  assert.deepStrictEqual(missing, []);

  // Panel düz bir DOM taklidiyle her durumda çiziliyor
  const node = (tag, attrs, children) => ({ tag, attrs: attrs || {}, children: [].concat(children || []).filter(Boolean), addEventListener() {}, appendChild(c) { this.children.push(c); } });
  const cfg = { bridge: { send: true, receive: true, secret: SECRET } };
  global.document = { querySelector: () => null, activeElement: null };
  global.window = {
    SVPanel: { el: node, cfg: () => cfg, row: (l, c) => node('row', { text: l }, [c]), push() {}, rerender() {} },
    api: {},
  };
  delete require.cache[require.resolve('../src/admin/bridge-panel.js')];
  require('../src/admin/bridge-panel.js');
  const P = global.window.SVBridgePanel;
  const texts = (n, out) => { if (!n) return out; if (n.attrs && typeof n.attrs.text === 'string') out.push(n.attrs.text); (n.children || []).forEach((c) => texts(c, out)); return out; };
  const t = texts(P.panel(), []);
  assert.ok(t.includes('Bu Makinenin Sesini Köprüye Ver') && t.includes('Ses Girişi: Ağ Köprüsü'));
  assert.ok(t.includes('Ağda köprü bulunamadı. Köprünün açık olduğundan ve güvenlik duvarının UDP 8742 ile köprü portuna izin verdiğinden emin olun; adresi elle de yazabilirsiniz.'));
  delete global.window;
  delete global.document;
});
