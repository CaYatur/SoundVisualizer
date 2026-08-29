'use strict';
/* OSC (Open Sound Control) alıcısı — UDP.

   TouchOSC, Resolume, Ableton, QLab gibi kaynaklardan gelen mesajlar dinlenir
   ve yönetici paneline iletilir; eşleme (hangi adres hangi ayarı sürer) orada
   uygulanır. Böylece yapılandırmanın tek bir sahibi kalır.

   OSC 1.0 ayrıştırması elle yapıldı: paket biçimi küçük ve sabit (4 bayta
   hizalı diziler + tip etiketi), bir bağımlılık eklemeye değmez.

   Gelen paketler GÜVENİLMEYEN veridir: adres uzunluğu, argüman sayısı ve
   paket boyutu sınırlanır; ayrıştırma hatası paketi düşürür, süreci düşürmez. */

const dgram = require('dgram');

const MAX_PACKET = 8192;
const MAX_ARGS = 32;

let socket = null;
let state = { running: false, port: 0, error: null, lastAddress: '', messages: 0 };
let onMessage = () => {};

// OSC dizesi: null sonlandırmalı, 4 bayta hizalı
function readString(buf, pos) {
  let end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  const str = buf.toString('ascii', pos, end);
  const next = pos + Math.ceil((end - pos + 1) / 4) * 4;
  return { str, next };
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
        // bilinmeyen tip: kalan argümanlar güvenle çözülemez
        break;
      }
    }
  }
  return { address: addr.str, args };
}

// #bundle paketleri iç içe mesaj taşır
function parsePacket(buf, out, depth) {
  if (buf.length < 4 || (depth || 0) > 4) return;
  if (buf.toString('ascii', 0, 7) === '#bundle') {
    let pos = 16; // '#bundle\0' + 8 bayt zaman etiketi
    while (pos + 4 <= buf.length) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      if (size <= 0 || pos + size > buf.length) break;
      parsePacket(buf.slice(pos, pos + size), out, (depth || 0) + 1);
      pos += size;
    }
    return;
  }
  const m = parseMessage(buf);
  if (m) out.push(m);
}

function start(cfg, handler) {
  const port = Math.max(1, Math.min(65535, (cfg && cfg.port) | 0 || 9000));
  onMessage = handler || onMessage;
  if (state.running && state.port === port) return Promise.resolve(status());

  return stop().then(
    () =>
      new Promise((resolve) => {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', (err) => {
          state = { running: false, port, error: err.code || err.message, lastAddress: '', messages: state.messages };
          try { socket.close(); } catch { /* zaten kapalı */ }
          socket = null;
          resolve(status());
        });
        socket.on('message', (buf) => {
          if (buf.length > MAX_PACKET) return;
          const msgs = [];
          try { parsePacket(buf, msgs, 0); } catch { return; }
          for (const m of msgs) {
            state.messages++;
            state.lastAddress = m.address;
            onMessage(m);
          }
        });
        socket.bind(port, '0.0.0.0', () => {
          state = { running: true, port, error: null, lastAddress: '', messages: 0 };
          resolve(status());
        });
      })
  );
}

function stop() {
  return new Promise((resolve) => {
    state.running = false;
    if (!socket) { resolve(); return; }
    const s = socket;
    socket = null;
    try { s.close(() => resolve()); } catch { resolve(); }
    setTimeout(resolve, 250);
  });
}

function status() {
  return Object.assign({}, state);
}

module.exports = { start, stop, status };
