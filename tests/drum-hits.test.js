'use strict';
/* Yakalama karesindeki davul vuruşu. Çizim karesine bağlı değil. */

const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { DrumHits } = require('../src/main/drum-hits');
const osc = require('../src/main/osc-out');

function kickFrame() {
  const freq = new Uint8Array(1024);
  for (let i = 1; i <= 6; i++) freq[i] = 255;
  return freq;
}

test('sessiz kareden sonra bas vuruşu ve kapanış 0', () => {
  const d = new DrumHits();
  const quiet = new Uint8Array(1024);
  assert.strictEqual(d.push(quiet, 48000, 1000), null);
  const hit = d.push(kickFrame(), 48000, 1014);
  assert.ok(hit && hit.kick > 0, 'kick gelmedi');
  assert.strictEqual(hit.snare, 0);
  const close = d.push(kickFrame(), 48000, 1028);
  assert.ok(close, 'kapanış yok');
  assert.strictEqual(close.kick, 0);
});

test('yakalama vuruşu UDP ile /hit/kick olarak çıkar', async () => {
  const sock = dgram.createSocket('udp4');
  const got = [];
  await new Promise((resolve) => sock.bind(0, '127.0.0.1', resolve));
  const port = sock.address().port;
  sock.on('message', (buf) => got.push(buf));
  const d = new DrumHits();
  const cfg = { enabled: true, host: '127.0.0.1', port, hits: true };
  try {
    await osc.start(cfg, { enabled: false, port: 1 });
    d.push(new Uint8Array(1024), 48000, 2000);
    const hit = d.push(kickFrame(), 48000, 2014);
    assert.ok(hit && hit.kick > 0);
    assert.ok(osc.hit(cfg, hit) > 0);
    const deadline = Date.now() + 1000;
    while (!got.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.ok(got.length > 0, 'paket gelmedi');
    const raw = Buffer.concat(got);
    assert.ok(raw.includes(Buffer.from('/cayadev/hit/kick\0')), 'adres pakette yok');
  } finally {
    await osc.stop();
    sock.close();
  }
});
