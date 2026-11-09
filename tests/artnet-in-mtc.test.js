'use strict';
/* Art-Net (DMX) girişi ve MIDI Time Code girişi.
   Donanım yok: ArtDmx paketleri 127.0.0.1'e gönderilir; MTC sentetik
   çeyrek kare dizileriyle (24/25/29.97 DF/30 fps, sıçrama, durma) sınanır. */
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
const artnet = require('../src/main/artnet');
const AIN = require('../src/main/artnet-in');
const MTC = require('../src/shared/mtc.js');
require('../src/shared/defaults.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function dmxPacket(universe, values) {
  const data = Buffer.alloc(Math.max(2, values.length + (values.length % 2)));
  values.forEach((v, i) => { data[i] = v; });
  return artnet.buildPacket({ universe }, data);
}

function freePort() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function sendTo(port, buf) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.send(buf, port, '127.0.0.1', () => s.close(resolve));
  });
}

test('varsayılan: Art-Net girişi ve MTC kapalı, giriş yalnız 127.0.0.1', () => {
  const d = global.window.SV.defaultConfig();
  assert.deepStrictEqual(d.control.artnet, { enabled: false, bind: '127.0.0.1', port: 6454, universe: 0, mappings: [] });
  assert.deepStrictEqual(d.control.mtc, { enabled: false, deviceId: 'all', offsetSec: 0 });
});

test('ArtDmx çözümü ve değişen kanal farkı', () => {
  const p = AIN.parseData(dmxPacket(3, [10, 20, 30]));
  assert.strictEqual(p.universe, 3);
  assert.deepStrictEqual(Array.from(p.data.subarray(0, 3)), [10, 20, 30]);
  assert.strictEqual(AIN.parseData(Buffer.from('nope')), null);
  const prev = new Int16Array(512).fill(-1);
  assert.deepStrictEqual(AIN.diff(prev, Buffer.from([1, 2])), [[1, 1], [2, 2]]);
  assert.deepStrictEqual(AIN.diff(prev, Buffer.from([1, 9])), [[2, 9]]);
  assert.deepStrictEqual(AIN.diff(prev, Buffer.from([1, 9])), []);
});

test('dinleme adresi yalnız güvenli değerler', () => {
  assert.strictEqual(AIN.safeBind(''), '127.0.0.1');
  assert.strictEqual(AIN.safeBind('0.0.0.0'), '0.0.0.0');
  assert.strictEqual(AIN.safeBind('192.168.1.20'), '192.168.1.20');
  assert.strictEqual(AIN.safeBind('evil.example; rm'), '127.0.0.1');
  assert.strictEqual(AIN.safeBind('300.1.1.1'), '127.0.0.1');
});

test('loopback: seçili evrenin değişen kanalları toplu iletilir, başka evren yok sayılır', async () => {
  const port = await freePort();
  const got = [];
  const rx = AIN.createReceiver({ port, bind: '127.0.0.1', universe: 2, flushMs: 10, onChanges: (m) => got.push(m) });
  const st = await rx.start();
  assert.strictEqual(st.listening, true);
  try {
    await sendTo(port, dmxPacket(5, [255, 255]));
    await sendTo(port, dmxPacket(2, [0, 128, 255]));
    await new Promise((r) => setTimeout(r, 60));
    await sendTo(port, dmxPacket(2, [0, 128, 200]));
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(got.length, 2);
    assert.strictEqual(got[0].universe, 2);
    assert.deepStrictEqual(got[0].changes.slice(0, 3), [[1, 0], [2, 128], [3, 255]]);
    assert.deepStrictEqual(got[1].changes, [[3, 200]], 'yalnız değişen kanal');
    assert.strictEqual(rx.status().packets, 2);
  } finally {
    await rx.stop();
  }
  assert.strictEqual(rx.status().listening, false);
});

test('port paylaşımı: redundancy tanığı aynı portta açıkken giriş de açılır', async () => {
  const port = await freePort();
  const w = artnet.createWitness({ port, universe: 0 });
  w.start();
  await new Promise((r) => setTimeout(r, 50));
  const rx = AIN.createReceiver({ port, bind: '127.0.0.1', universe: 0 });
  try {
    const st = await rx.start();
    assert.strictEqual(st.error, '', 'EADDRINUSE olmamalı');
    assert.strictEqual(st.listening, true);
    assert.strictEqual(w.status().error, '');
  } finally {
    await rx.stop();
    w.stop();
  }
});

test('ana süreç: kendi çıkış evreni reddedilir, otomasyonda kapalı, panel değişenleri alır', () => {
  const main = read('src/main/main.js');
  assert.match(main, /if \(!c\.enabled \|\| HW_OFF\)/);
  assert.match(main, /out\.enabled && \(out\.universe \| 0\) === universe[\s\S]{0,80}'same-universe'/);
  assert.match(main, /onChanges: \(msg\) => notifyAdmin\('artnet-in', msg\)/);
  const c = read('src/admin/control.js');
  assert.match(c, /if \(\(m\.channel \| 0\) !== ch\) continue;[\s\S]{0,200}applyMapping\(m, value01\)/);
  assert.match(c, /if \(!a\.enabled\) return;/);
});

// ------------------------------------------------------------------ MTC

function feedAll(dec, msgs, t0, dtMs) {
  let t = t0;
  for (const m of msgs) { dec.feed(m, t); t += dtMs; }
  return t;
}

test('MTC: saniyeye çevirme, drop-frame dahil', () => {
  assert.strictEqual(MTC.toSeconds(1, 0, 0, 0, 3), 3600);
  assert.strictEqual(MTC.toSeconds(0, 0, 1, 12, 1), 1 + 12 / 25);
  assert.strictEqual(MTC.toSeconds(0, 0, 0, 12, 0), 0.5);
  // 29.97 DF: 00:01:00;02 = 1800 kare (00;00..00;01 atlanır)
  assert.ok(Math.abs(MTC.toSeconds(0, 1, 0, 2, 2) - 1800 / 29.97) < 1e-9);
  // 00:10:00;00 = 17982 kare (onun katında atlama yok)
  assert.ok(Math.abs(MTC.toSeconds(0, 10, 0, 0, 2) - 17982 / 29.97) < 1e-9);
});

for (const [code, fps] of [[0, 24], [1, 25], [2, 29.97], [3, 30]]) {
  test('MTC: çeyrek karelerden zaman, ' + fps + ' fps (+2 kare gecikme düzeltmesi)', () => {
    const dec = MTC.createDecoder();
    const q = MTC.encodeQuarterFrames(1, 2, 3, 4, code);
    feedAll(dec, q.slice(0, 7), 0, 10);
    assert.strictEqual(dec.time(), null, 'tam dizi gelmeden zaman yok');
    dec.feed(q[7], 70);
    const want = MTC.toSeconds(1, 2, 3, 4, code) + 2 / fps;
    assert.ok(Math.abs(dec.time() - want) < 1e-9, dec.time() + ' ≠ ' + want);
    assert.strictEqual(dec.label(), '01:02:03:04');
    assert.strictEqual(dec.rate(), fps);
    // sonraki çeyrekler konumu çeyrek kare ilerletir
    dec.feed([0xf1, 0x00 | 6], 80);
    assert.ok(Math.abs(dec.time() - (want + 1 / (4 * fps))) < 1e-9);
  });
}

test('MTC: ardışık bloklar tutarlı ilerler; sıçrama yeni zamanı verir; durma algılanır', () => {
  const dec = MTC.createDecoder();
  feedAll(dec, MTC.encodeQuarterFrames(0, 0, 10, 0, 1), 0, 10);
  const t1 = dec.time();
  feedAll(dec, MTC.encodeQuarterFrames(0, 0, 10, 2, 1), 80, 10);
  assert.ok(Math.abs(dec.time() - (t1 + 2 / 25)) < 1e-9);
  feedAll(dec, MTC.encodeQuarterFrames(0, 5, 0, 0, 1), 160, 10);
  assert.ok(Math.abs(dec.time() - (300 + 2 / 25)) < 1e-9, 'sıçrama');
  assert.strictEqual(dec.running(240, 250), true);
  assert.strictEqual(dec.running(1000, 250), false);
});

test('MTC: tam kare SysEx çözülür', () => {
  const dec = MTC.createDecoder();
  assert.strictEqual(dec.feed([0xf0, 0x7f, 0x7f, 0x01, 0x01, (3 << 5) | 1, 0, 30, 15, 0xf7], 0), true);
  assert.strictEqual(dec.time(), 3600 + 30 + 0.5);
  assert.strictEqual(dec.feed([0x90, 1, 1], 0), false);
});

test('MTC kovalama: oynat, sapınca konuma atla, durunca dur', () => {
  const C = MTC.chaseStep;
  assert.deepStrictEqual(C({ time: 10, running: true }, { time: 0, playing: false }), { play: true, pause: false, seek: 10 });
  assert.deepStrictEqual(C({ time: 10.05, running: true }, { time: 10, playing: true }), { play: false, pause: false, seek: null }, 'küçük sapma: dokunma');
  assert.deepStrictEqual(C({ time: 40, running: true }, { time: 10, playing: true }), { play: false, pause: false, seek: 40 });
  assert.deepStrictEqual(C({ time: 3610, running: true }, { time: 10, playing: true }, { offset: 3600 }), { play: false, pause: false, seek: null });
  assert.deepStrictEqual(C({ time: 12, running: false }, { time: 12.3, playing: true }), { play: false, pause: true, seek: 12 });
  assert.deepStrictEqual(C({ time: 12, running: false }, { time: 12, playing: false }), { play: false, pause: false, seek: null });
  assert.deepStrictEqual(C({ time: null, running: false }, { time: 0, playing: true }), { play: false, pause: false, seek: null });
  assert.strictEqual(C({ time: 5, running: true }, { time: 0, playing: true }, { offset: 3600 }).seek, null, 'ofsetten önce: 0');
});

test('panel: MTC yalnız açıkken dinlenir ve çizelgeyi kamu arayüzüyle sürer', () => {
  const c = read('src/admin/control.js');
  assert.match(c, /const mtcWant = mt\.enabled \? mt\.deviceId \|\| 'all' : null;/);
  assert.match(c, /if \(step\.pause\) tp\.pause\(\);\s*if \(step\.seek != null\) tp\.seek\(step\.seek\);\s*if \(step\.play\) tp\.play\(\);/);
  assert.match(read('src/admin/index.html'), /<script src="\.\.\/shared\/mtc\.js"><\/script>/);
});

test('MCP: control.artnet ve control.mtc tanınır ve doğrulanır', async () => {
  const mcp = require('../src/shared/mcp.js');
  const SV = global.window.SV;
  const ctx = () => {
    const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
    return {
      cfg, platform: 'linux', locale: () => 'en', getConfig: () => cfg,
      setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
      noteWrite: () => 1, revision: () => 1,
    };
  };
  const patch = (c, p, v) => Promise.resolve(mcp.callTool('sv_patch_config', { path: p, value: v }, c));
  let c = ctx();
  assert.strictEqual((await patch(c, 'control.artnet.universe', 4)).ok, true);
  assert.strictEqual(c.cfg.control.artnet.universe, 4);
  for (const [p, v] of [['control.artnet.bind', 'evil host'], ['control.artnet.bind', '1.2.3.400'], ['control.artnet.universe', -1],
    ['control.artnet.port', 80], ['control.mtc.offsetSec', -5], ['control.mtc.deviceId', '']]) {
    c = ctx();
    const r = await patch(c, p, v);
    assert.strictEqual(r.ok, false, p + ' ' + JSON.stringify(v));
  }
  c = ctx();
  assert.strictEqual((await patch(c, 'control.mtc.offsetSec', 3600)).ok, true);
  assert.strictEqual((await patch(c, 'control.nope', {})).ok, false);
});
