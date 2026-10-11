/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OSC (Open Sound Control) alıcısı — UDP.

   TouchOSC, Resolume, Ableton, QLab gibi kaynaklardan gelen mesajlar dinlenir
   ve yönetici paneline iletilir; eşleme (hangi adres hangi ayarı sürer) orada
   uygulanır. Böylece yapılandırmanın tek bir sahibi kalır.

   OSC 1.0 ayrıştırması elle yapıldı. Adlar ASCII kalır; ad taşıyan dizeler
   UTF-8 okunur (#734). Bir datagram tek paket olarak iletilir ki #bundle
   bütün uygulanabilsin. Zaman etiketi paketin üstündedir.

   IPv4 ve IPv6 ayrı soketlerde dinlenir. Gönderen süzülmez: birden çok masa
   aynı porta yazabilir. Bozuk paket düşer, süreç düşmez. */

const dgram = require('dgram');

const MAX_PACKET = 8192;
const MAX_ARGS = 32;
const NTP_UNIX = 2208988800;

let sockets = [];
let state = { running: false, port: 0, error: null, lastAddress: '', messages: 0, ipv6: false };
let onPacket = () => {};
let generation = 0;

function readString(buf, pos) {
  let end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  const str = buf.toString('utf8', pos, end);
  const next = pos + Math.ceil((end - pos + 1) / 4) * 4;
  return { str, next };
}

function readTimetag(buf, pos) {
  if (pos + 8 > buf.length) return { immediate: true, unixMs: null };
  const sec = buf.readUInt32BE(pos);
  const frac = buf.readUInt32BE(pos + 4);
  if (sec === 0 && frac === 1) return { immediate: true, unixMs: null };
  const unixMs = (sec - NTP_UNIX) * 1000 + Math.round(frac / 0x100000000 * 1000);
  return { immediate: false, unixMs };
}

function parseMessage(buf) {
  const addr = readString(buf, 0);
  if (!addr || !addr.str.startsWith('/') || addr.str.length > 256) return null;
  const args = [];
  let pos = addr.next;
  if (pos < buf.length && buf[pos] === 0x2c /* ',' */) {
    const tags = readString(buf, pos);
    if (!tags) return null;
    pos = tags.next;
    const types = tags.str.slice(1);
    for (let i = 0; i < types.length && i < MAX_ARGS; i++) {
      const t = types[i];
      if (t === 'f') {
        if (pos + 4 > buf.length) return null;
        args.push(buf.readFloatBE(pos));
        pos += 4;
      } else if (t === 'i') {
        if (pos + 4 > buf.length) return null;
        args.push(buf.readInt32BE(pos));
        pos += 4;
      } else if (t === 's') {
        const s = readString(buf, pos);
        if (!s) return null;
        args.push(s.str.slice(0, 256));
        pos = s.next;
      } else if (t === 'T') args.push(true);
      else if (t === 'F') args.push(false);
      else if (t === 'N') args.push(null);
      else if (t === 'd') {
        if (pos + 8 > buf.length) return null;
        args.push(buf.readDoubleBE(pos));
        pos += 8;
      } else if (t === 'b') {
        if (pos + 4 > buf.length) return null;
        const len = buf.readInt32BE(pos);
        pos += 4 + Math.ceil(Math.max(0, len) / 4) * 4;
        args.push(null);
      } else {
        break;
      }
    }
  }
  return { address: addr.str, args };
}

// #bundle paketleri iç içe mesaj taşır. Üst zaman etiketi mesajlara yazılır.
function parsePacket(buf, out, depth, time) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || (depth || 0) > 4) return time || null;
  if (buf.length >= 16 && buf.toString('ascii', 0, 7) === '#bundle') {
    const tag = readTimetag(buf, 8);
    let pos = 16;
    while (pos + 4 <= buf.length) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      if (size <= 0 || pos + size > buf.length) break;
      parsePacket(buf.slice(pos, pos + size), out, (depth || 0) + 1, tag);
      pos += size;
    }
    return tag;
  }
  const m = parseMessage(buf);
  if (m) {
    m.time = time || null;
    out.push(m);
  }
  return time || null;
}

function take(buf) {
  if (!buf || buf.length > MAX_PACKET) return;
  const messages = [];
  let time = null;
  try { time = parsePacket(buf, messages, 0, null); } catch { return; }
  if (!messages.length) return;
  state.messages += messages.length;
  state.lastAddress = messages[messages.length - 1].address;
  onPacket({ messages, time });
}

function bindOne(type, port, gen) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = dgram.createSocket({ type, reuseAddr: true, ipv6Only: type === 'udp6' });
    } catch (err) {
      resolve({ ok: false, error: err.code || err.message });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    socket.on('error', (err) => {
      try { socket.close(); } catch { /* kapalı */ }
      finish({ ok: false, error: err.code || err.message });
    });
    socket.on('message', (buf) => { if (gen === generation) take(buf); });
    try {
      socket.bind({ port, address: type === 'udp6' ? '::' : '0.0.0.0' }, () => {
        if (gen !== generation) {
          try { socket.close(); } catch { /* kapalı */ }
          finish({ ok: false, error: 'stopped' });
          return;
        }
        sockets.push(socket);
        finish({ ok: true });
      });
    } catch (err) {
      try { socket.close(); } catch { /* kapalı */ }
      finish({ ok: false, error: err.code || err.message });
    }
  });
}

function start(cfg, handler) {
  const port = Math.max(1, Math.min(65535, (cfg && cfg.port) | 0 || 9000));
  onPacket = handler || onPacket;
  const gen = ++generation;
  return stop({ keepGen: true }).then(() => {
    if (gen !== generation) return status();
    return Promise.all([bindOne('udp4', port, gen), bindOne('udp6', port, gen)]).then((both) => {
      if (gen !== generation) return status();
      const v4 = both[0].ok;
      const v6 = both[1].ok;
      state = {
        running: v4 || v6,
        port: v4 || v6 ? port : 0,
        error: v4 || v6 ? null : (both[0].error || both[1].error || 'bind'),
        lastAddress: '',
        messages: 0,
        ipv6: v6,
      };
      return status();
    });
  });
}

function stop(opts) {
  if (!opts || !opts.keepGen) generation++;
  state.running = false;
  state.ipv6 = false;
  const open = sockets;
  sockets = [];
  return Promise.all(open.map((s) => new Promise((resolve) => {
    try { s.close(() => resolve()); } catch { resolve(); }
  }))).then(() => status());
}

function status() {
  return Object.assign({}, state);
}

module.exports = { start, stop, status, parsePacket, readTimetag };
