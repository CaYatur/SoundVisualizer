'use strict';
/* OSCQuery mDNS duyurusu ağ değişince yeni IP'yi taşır (13.10).

   Duyurulan adres açılışta bir kez seçiliyordu. Wi-Fi'den kabloya geçince
   ya da DHCP yeni adres verince keşif, OSC kapatılıp açılana kadar eski
   adrese gidiyordu. Şimdi adres her duyuru ve cevaptan önce yeniden
   seçilir; değişince hemen duyurulur ve gruba yeniden katılınır. Tekil
   kayıtlar önbellek temizleme bitiyle gider, dinleyici eskisini tutmaz. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Mdns = require('../src/shared/osc-mdns.js');
const Query = require('../src/main/osc-query.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'osc-query.js'), 'utf8').replace(/\r\n/g, '\n');

function withNets(nets, fn) {
  const real = os.networkInterfaces;
  os.networkInterfaces = () => nets;
  try { return fn(); } finally { os.networkInterfaces = real; }
}
const wifi = (address) => ({ 'Wi-Fi': [{ family: 'IPv4', internal: false, address }] });

/* Cevaptaki kayıtlar: ad, tür, sınıf, A ise adres. */
function records(buf) {
  const out = [];
  let pos = 12;
  const count = buf.readUInt16BE(6);
  for (let i = 0; i < count; i++) {
    const name = Mdns.readName(buf, pos, 0);
    pos = name.next;
    const type = buf.readUInt16BE(pos);
    const cls = buf.readUInt16BE(pos + 2);
    const len = buf.readUInt16BE(pos + 8);
    const data = buf.subarray(pos + 10, pos + 10 + len);
    out.push({ name: name.name, type, cls, ip: type === 1 ? [...data].join('.') : null });
    pos += 10 + len;
  }
  return out;
}

test('adres değişince yenilenir; sabit IP verildiyse dokunulmaz', () => {
  const opt = { port: 17801, ip: '192.168.1.5' };
  assert.strictEqual(withNets(wifi('192.168.1.5'), () => Query.refreshIp(opt)), false);
  assert.strictEqual(withNets(wifi('10.0.0.7'), () => Query.refreshIp(opt)), true);
  assert.strictEqual(opt.ip, '10.0.0.7');
  const a = records(Mdns.announce(opt)).find((r) => r.type === 1);
  assert.strictEqual(a.ip, '10.0.0.7');
  const fixed = { port: 17801, ip: '192.168.1.5', fixedIp: true };
  assert.strictEqual(withNets(wifi('10.0.0.7'), () => Query.refreshIp(fixed)), false);
  assert.strictEqual(fixed.ip, '192.168.1.5');
  // Ağ tamamen giderse geri döngüye düşer, ağ gelince yine yenilenir
  assert.strictEqual(withNets({}, () => Query.refreshIp(opt)), true);
  assert.strictEqual(opt.ip, '127.0.0.1');
});

test('tekil kayıtlar önbellek temizleme bitiyle, PTR ve tek seferlik cevap bitsiz', () => {
  const rec = records(Mdns.announce({ port: 9010, ip: '10.0.0.8' }));
  assert.deepStrictEqual(rec.map((r) => [r.type, r.cls]), [[12, 1], [33, 0x8001], [16, 0x8001], [1, 0x8001]]);
  const legacy = records(Mdns.announce({ port: 9010, ip: '10.0.0.8', legacy: true }));
  assert.ok(legacy.every((r) => r.cls === 1), 'RFC 6762 6.7');
});

test('duyuru zamanlayıcısı adresi izler, cevap güncel adresle gider', () => {
  const announce = SRC.slice(SRC.indexOf('function announceNow(opt)'), SRC.indexOf('function trackMdns('));
  assert.match(announce, /refreshIp\(opt\);\n  const buf = mdns\.announce\(opt\);/);
  const arm = SRC.slice(SRC.indexOf('function armAnnounce('), SRC.indexOf('function bindMdns('));
  assert.match(arm, /const moved = refreshIp\(opt\);/);
  assert.match(arm, /if \(moved && listening && socket === s\) rejoin\(s\);/);
  assert.match(arm, /if \(moved \|\| ticks % ANNOUNCE_EVERY === 0\) announceNow\(opt\);/);
  assert.ok(!/setInterval\(\(\) => announceNow\(opt\), 60000\)/.test(SRC), 'eski sabit duyuru kalmamalı');
  const msg = SRC.slice(SRC.indexOf("s.on('message'"), SRC.indexOf('const options = port.number'));
  // Kartlar yalnız bizi soran pakette okunur
  assert.ok(msg.indexOf('if (!reply) return;') < msg.indexOf('refreshIp(port.opt)'));
  assert.match(msg, /legacy = rinfo\.port !== 5353/);
  assert.match(SRC, /fixedIp: !!o\.ip/);
});
