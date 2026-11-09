/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* sACN (ANSI E1.31 / Streaming ACN) çıkışı.

   Art-Net'in yanındaki ikinci standart ışık protokolü. Kanal verisi
   Art-Net ile AYNI üreticiden gelir (artnet.buildChannels): aynı ayarlar
   iki protokolde aynı ışığı yakar. Varsayılan hedef evrenin multicast
   adresi (239.255.H.L), tek bir düğüm için IP yazılabilir (unicast).
   Port 5568. Bağımlılık yok; paket burada kuruluyor.

   Paket: kök katman (ACN) + çerçeve katmanı (kaynak adı, öncelik, sıra,
   evren) + DMP katmanı (başlangıç kodu 0 + kanallar). */

const crypto = require('crypto');
const artnet = require('./artnet');
const { createSender } = require('./udp-sender');

const SACN_PORT = 5568;
const ACN_ID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);
const CID = crypto.randomBytes(16); // süreç başına sabit kaynak kimliği

const sender = createSender('sacn');
let sequence = 0;

function clampUniverse(u) {
  const n = u | 0;
  return Math.max(1, Math.min(63999, n || 1));
}

// Evrenin multicast adresi: 239.255.<üst bayt>.<alt bayt>
function multicastHost(universe) {
  const u = clampUniverse(universe);
  return '239.255.' + ((u >> 8) & 0xff) + '.' + (u & 0xff);
}

function targetHost(cfg) {
  const h = String((cfg && cfg.host) || '').trim();
  return h || multicastHost(cfg && cfg.universe);
}

/* E1.31 veri paketi. `data`: kanal baytları (en çok 512). `opt.seq`
   verilirse o kullanılır (test), yoksa modül sırası ilerler. */
function buildPacket(cfg, data, opt) {
  const c = cfg || {};
  const o = opt || {};
  const slots = Math.min(512, data ? data.length : 0);
  const total = 126 + slots;
  const p = Buffer.alloc(total);
  // Kök katman
  p.writeUInt16BE(0x0010, 0); // önsöz boyu
  p.writeUInt16BE(0x0000, 2); // sonsöz boyu
  ACN_ID.copy(p, 4);
  p.writeUInt16BE(0x7000 | (total - 16), 16);
  p.writeUInt32BE(0x00000004, 18); // VECTOR_ROOT_E131_DATA
  (o.cid || CID).copy(p, 22, 0, 16);
  // Çerçeve katmanı
  p.writeUInt16BE(0x7000 | (total - 38), 38);
  p.writeUInt32BE(0x00000002, 40); // VECTOR_E131_DATA_PACKET
  const name = Buffer.from(String(c.sourceName || 'SoundVisualizer').slice(0, 63), 'utf8').subarray(0, 63);
  name.copy(p, 44);
  p.writeUInt8(Math.max(0, Math.min(200, c.priority == null ? 100 : c.priority | 0)), 108);
  p.writeUInt16BE(0, 109); // senkron adresi yok
  let seq;
  if (o.seq != null) seq = o.seq & 0xff;
  else { seq = sequence; sequence = (sequence + 1) & 0xff; }
  p.writeUInt8(seq, 111);
  p.writeUInt8(o.terminated ? 0x40 : 0x00, 112); // seçenekler: bit 6 = akış bitti
  p.writeUInt16BE(clampUniverse(c.universe), 113);
  // DMP katmanı
  p.writeUInt16BE(0x7000 | (total - 115), 115);
  p.writeUInt8(0x02, 117); // VECTOR_DMP_SET_PROPERTY
  p.writeUInt8(0xa1, 118); // adres ve veri türü
  p.writeUInt16BE(0x0000, 119); // ilk özellik adresi
  p.writeUInt16BE(0x0001, 121); // adres artışı
  p.writeUInt16BE(slots + 1, 123); // özellik sayısı (başlangıç kodu dahil)
  p.writeUInt8(0x00, 125); // DMX başlangıç kodu
  if (slots) data.copy(p, 126, 0, slots);
  return p;
}

/* Gelen paketi çözer (test ve tanılama için): evren, öncelik, sıra, veri. */
function parsePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 126) return null;
  if (!buf.subarray(4, 16).equals(ACN_ID)) return null;
  if (buf.readUInt32BE(18) !== 4 || buf.readUInt32BE(40) !== 2) return null;
  const count = buf.readUInt16BE(123);
  const slots = Math.max(0, Math.min(512, count - 1, buf.length - 126));
  const nameEnd = buf.indexOf(0, 44);
  return {
    sourceName: buf.toString('utf8', 44, nameEnd > 44 && nameEnd < 108 ? nameEnd : 108),
    priority: buf[108],
    sequence: buf[111],
    terminated: (buf[112] & 0x40) !== 0,
    universe: buf.readUInt16BE(113),
    startCode: buf[125],
    data: buf.subarray(126, 126 + slots),
  };
}

function start(cfg) {
  const c = cfg || {};
  if (!c.enabled) return stop().then(() => status());
  return sender.start({ host: targetHost(c), multicastTtl: 4 }).then(() => status());
}

/* Kapanışta alıcılar beklemesin: üç kez "akış bitti" paketi (E1.31 6.2.6). */
function stop(cfg) {
  if (cfg && sender.running()) {
    const pkt = buildPacket(cfg, Buffer.alloc(0), { terminated: true });
    return sender.flush([pkt, pkt, pkt], cfg.port | 0 || SACN_PORT, targetHost(cfg)).then(() => sender.stop());
  }
  return sender.stop();
}

function send(cfg, frame) {
  if (!cfg || !cfg.enabled || !sender.running()) return false;
  if (!sender.due(cfg.fps, 44)) return false;
  const data = artnet.buildChannels(cfg, frame);
  return sender.send(buildPacket(cfg, data), cfg.port | 0 || SACN_PORT, targetHost(cfg));
}

function status() {
  const s = sender.status();
  return s;
}

module.exports = { start, stop, send, status, buildPacket, parsePacket, multicastHost, targetHost, SACN_PORT };
