/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* WLED'i doğrudan sürme: DDP (Distributed Display Protocol), UDP 4048.

   WLED her DDP paketini gerçek zamanlı kipte piksellere yazar; Art-Net
   evren/kanal ayarı gerekmez. Renkler Art-Net ile AYNI renk üreticisinden
   (artnet.colorAt) LED sayısı kadar üretilir.

   Başlık 10 bayt:
     0  bayraklar: 0x40 (sürüm 1) | 0x01 (PUSH, karenin son paketi)
     1  sıra (alt 4 bit, 1..15; 0 = kullanılmıyor)
     2  veri türü: 0x0B = RGB, 8 bit
     3  hedef: 0x01 (varsayılan çıkış)
     4  veri ofseti (bayt, BE uint32)
     8  veri boyu (bayt, BE uint16)
   Bir pakete en çok 480 piksel (1440 bayt) sığar; uzun şeritler parçalanır,
   yalnız son parçada PUSH vardır (WLED kareyi o zaman gösterir).

   Keşif (mDNS _wled._tcp) ve LED sayısı (/json/info) yalnız kullanıcı
   "Bul" ya da "Bilgi Al" dediğinde çalışır; kendiliğinden ağ taranmaz. */

const http = require('http');
const dgram = require('dgram');
const artnet = require('./artnet');
const mdns = require('../shared/osc-mdns');
const { createSender } = require('./udp-sender');

const DDP_PORT = 4048;
const MAX_PIXELS_PER_PACKET = 480;
const MAX_LEDS = 4096;
const TYPE_RGB24 = 0x0b;
const WLED_SERVICE = '_wled._tcp.local';

const sender = createSender('ddp');
let sequence = 1;

function ledCount(cfg) {
  return Math.max(1, Math.min(MAX_LEDS, (cfg && cfg.ledCount) | 0 || 60));
}

// LED sayısı kadar RGB bayt üretir
function renderPixels(cfg, frame) {
  const c = cfg || {};
  const n = ledCount(c);
  const brightness = Math.max(0, Math.min(1, c.brightness == null ? 1 : c.brightness));
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const rgb = artnet.colorAt(c, frame, i, n);
    out[i * 3] = artnet.clamp255(rgb[0] * 255 * brightness);
    out[i * 3 + 1] = artnet.clamp255(rgb[1] * 255 * brightness);
    out[i * 3 + 2] = artnet.clamp255(rgb[2] * 255 * brightness);
  }
  return out;
}

/* Piksel baytlarını DDP paketlerine böler. `opt.seq` testte sabit sıra. */
function buildPackets(pixels, opt) {
  const o = opt || {};
  const chunk = MAX_PIXELS_PER_PACKET * 3;
  let seq;
  if (o.seq != null) seq = o.seq & 0x0f;
  else { seq = sequence; sequence = sequence >= 15 ? 1 : sequence + 1; }
  const out = [];
  const len = pixels.length;
  for (let off = 0; off < len || (off === 0 && len === 0); off += chunk) {
    const part = pixels.subarray(off, Math.min(len, off + chunk));
    const last = off + chunk >= len;
    const h = Buffer.alloc(10);
    h[0] = 0x40 | (last ? 0x01 : 0);
    h[1] = seq;
    h[2] = TYPE_RGB24;
    h[3] = 0x01;
    h.writeUInt32BE(off, 4);
    h.writeUInt16BE(part.length, 8);
    out.push(Buffer.concat([h, part]));
    if (len === 0) break;
  }
  return out;
}

function parsePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  if ((buf[0] & 0xc0) !== 0x40) return null;
  const length = buf.readUInt16BE(8);
  return {
    push: (buf[0] & 0x01) !== 0,
    sequence: buf[1] & 0x0f,
    type: buf[2],
    id: buf[3],
    offset: buf.readUInt32BE(4),
    length,
    data: buf.subarray(10, 10 + length),
  };
}

function host(cfg) {
  return String((cfg && cfg.host) || '').trim();
}

function start(cfg) {
  const c = cfg || {};
  if (!c.enabled) return stop().then(() => status());
  // Hedef yoksa soket açılmaz: WLED adresi olmadan yayın yapılmaz
  if (!host(c)) return stop().then(() => Object.assign(status(), { error: 'no-host' }));
  return sender.start({ host: host(c) }).then(() => status());
}

function stop() { return sender.stop(); }

function send(cfg, frame) {
  if (!cfg || !cfg.enabled || !host(cfg) || !sender.running()) return false;
  if (!sender.due(cfg.fps, 60)) return false;
  return sender.send(buildPackets(renderPixels(cfg, frame)), cfg.port | 0 || DDP_PORT, host(cfg));
}

function status() { return sender.status(); }

// --------------------------------------------------------------------------
// WLED bilgi ve keşif (yalnız kullanıcı isteğiyle)
// --------------------------------------------------------------------------

/* Adres "192.168.1.5", "wled.local" ya da "host:port" olabilir. Yalnız
   ana makine adı ve port kabul edilir; yol/şema verilemez. */
function parseHost(text) {
  const t = String(text || '').trim();
  const m = /^([A-Za-z0-9.-]{1,253}|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/.exec(t);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 80;
  if (!(port > 0 && port < 65536)) return null;
  return { hostname: m[1].replace(/^\[|\]$/g, ''), port };
}

/* GET /json/info: ad, sürüm ve LED sayısı. Zaman aşımı kısa. */
function fetchInfo(text, timeoutMs) {
  const h = parseHost(text);
  if (!h) return Promise.resolve({ ok: false, error: 'bad-host' });
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get({ hostname: h.hostname, port: h.port, path: '/json/info', timeout: timeoutMs || 2000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); finish({ ok: false, error: 'http-' + res.statusCode }); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const leds = j && j.leds ? j.leds.count | 0 : 0;
          finish({ ok: true, name: String((j && j.name) || '').slice(0, 64), version: String((j && j.ver) || '').slice(0, 32), leds, rgbw: !!(j && j.leds && j.leds.rgbw) });
        } catch { finish({ ok: false, error: 'bad-json' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => finish({ ok: false, error: (e && e.code) || 'error' }));
  });
}

// mDNS sorgusu: _wled._tcp.local PTR (tek seferlik, 5353 dışından → cevap bize unicast gelir)
function buildQuery(id) {
  const name = mdns.encodeName(WLED_SERVICE);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id & 0xffff, 0);
  head.writeUInt16BE(1, 4);
  const q = Buffer.alloc(4);
  q.writeUInt16BE(12, 0); // PTR
  q.writeUInt16BE(1, 2); // IN
  return Buffer.concat([head, name, q]);
}

/* Cevaptaki kayıtlardan WLED aygıtlarını çıkarır: PTR → örnek adı,
   SRV → ana makine + port, A → IPv4. Bilinmeyen kayıtlar atlanır. */
function parseResponse(buf, from) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) {
    const n = mdns.readName(buf, pos, 0);
    if (!n) return [];
    pos = n.next + 4;
  }
  const ptr = [];
  const srv = new Map();
  const a = new Map();
  for (let i = 0; i < total && i < 64; i++) {
    const n = mdns.readName(buf, pos, 0);
    if (!n || n.next + 10 > buf.length) break;
    const type = buf.readUInt16BE(n.next);
    const rdlen = buf.readUInt16BE(n.next + 8);
    const rd = n.next + 10;
    if (rd + rdlen > buf.length) break;
    const name = n.name.toLowerCase();
    if (type === 12 && name === WLED_SERVICE) {
      const t = mdns.readName(buf, rd, 0);
      if (t) ptr.push(t.name);
    } else if (type === 33 && rdlen >= 7) {
      const t = mdns.readName(buf, rd + 6, 0);
      if (t) srv.set(name, { port: buf.readUInt16BE(rd + 4), target: t.name.toLowerCase() });
    } else if (type === 1 && rdlen === 4) {
      a.set(name, buf[rd] + '.' + buf[rd + 1] + '.' + buf[rd + 2] + '.' + buf[rd + 3]);
    }
    pos = rd + rdlen;
  }
  return ptr.map((inst) => {
    const s = srv.get(inst.toLowerCase());
    const ip = (s && a.get(s.target)) || (from && from.address) || '';
    return { name: inst.replace('.' + WLED_SERVICE, '').replace(/\._wled\._tcp\.local$/i, ''), host: ip, port: s ? s.port : 80 };
  }).filter((d) => d.host);
}

/* Kısa süreli keşif: rastgele porttan multicast sorgu, `ms` boyunca gelen
   cevaplar toplanır, soket kapanır. Sonuç adrese göre tekilleşir. */
function discover(opts) {
  const o = Object.assign({ ms: 2000, address: '224.0.0.251', port: 5353 }, opts || {});
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { resolve({ ok: false, error: 'socket', devices: [] }); return; }
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try { sock.close(); } catch { /* */ }
      resolve({ ok: !err, error: err || null, devices: Array.from(found.values()) });
    };
    sock.on('error', (e) => finish((e && e.code) || 'error'));
    sock.on('message', (msg, rinfo) => {
      for (const d of parseResponse(msg, rinfo)) if (!found.has(d.host)) found.set(d.host, d);
    });
    sock.bind(0, () => {
      try { sock.setMulticastTTL(1); } catch { /* */ }
      const q = buildQuery(Math.floor(Math.random() * 65535));
      sock.send(q, o.port, o.address, (err) => { if (err) finish(err.code || 'send'); });
      setTimeout(() => finish(null), o.ms);
    });
  });
}

module.exports = {
  start, stop, send, status, renderPixels, buildPackets, parsePacket, parseHost, fetchInfo,
  buildQuery, parseResponse, discover, DDP_PORT, MAX_PIXELS_PER_PACKET, WLED_SERVICE,
};
