/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Bağımlılıksız küçük MQTT 3.1.1 istemcisi (yalnız QoS 0).

   Ev otomasyonu için yeter: bağlan (kullanıcı/parola, son vasiyet), yayınla
   (retain), abone ol, ping, kopunca artan aralıkla yeniden bağlan. TLS
   Node'un tls modülüyle, sertifika doğrulaması açık. Yerel derleme yok;
   üç işletim sisteminde aynı çalışır. Paket kodlayıcı ve ayrıştırıcı dışa
   açık: testlerdeki sahte aracı (broker) da bunları kullanır. */
const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');

const T = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };
const MAX_PACKET = 256 * 1024;

function varInt(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}

function str(s) {
  const b = Buffer.from(String(s == null ? '' : s), 'utf8');
  const h = Buffer.alloc(2);
  h.writeUInt16BE(b.length);
  return Buffer.concat([h, b]);
}

function packet(type, flags, body) {
  return Buffer.concat([Buffer.from([(type << 4) | (flags & 0x0f)]), varInt(body.length), body]);
}

function connect(o) {
  let flags = 0x02; // temiz oturum
  const parts = [str(o.clientId || '')];
  if (o.will && o.will.topic) {
    flags |= 0x04 | (o.will.retain ? 0x20 : 0);
    parts.push(str(o.will.topic), str(o.will.payload || ''));
  }
  if (o.username) { flags |= 0x80; parts.push(str(o.username)); }
  if (o.username && o.password) { flags |= 0x40; parts.push(str(o.password)); }
  const ka = Buffer.alloc(2);
  ka.writeUInt16BE(Math.max(0, Math.min(65535, o.keepalive == null ? 30 : o.keepalive)));
  const head = Buffer.concat([str('MQTT'), Buffer.from([4, flags]), ka]);
  return packet(T.CONNECT, 0, Buffer.concat([head].concat(parts)));
}

function publish(topic, payload, retain) {
  const body = Buffer.concat([str(topic), Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload == null ? '' : payload), 'utf8')]);
  return packet(T.PUBLISH, retain ? 1 : 0, body);
}

function subscribe(id, topics) {
  const pid = Buffer.alloc(2);
  pid.writeUInt16BE(id & 0xffff);
  const parts = [pid];
  for (const t of topics) parts.push(str(t), Buffer.from([0]));
  return packet(T.SUBSCRIBE, 2, Buffer.concat(parts));
}

/* Tampondan tam paketleri ayıklar. { packets, rest } döner; bozuk ya da
   aşırı büyük pakette error alanı dolar. */
function parse(buf) {
  const packets = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    let mult = 1;
    let len = 0;
    let i = off + 1;
    let done = false;
    for (let k = 0; k < 4 && i < buf.length; k++, i++) {
      len += (buf[i] & 0x7f) * mult;
      mult *= 128;
      if (!(buf[i] & 0x80)) { done = true; i++; break; }
    }
    if (!done) {
      if (i - off - 1 >= 4) return { packets, rest: Buffer.alloc(0), error: 'bad length' };
      break;
    }
    if (len > MAX_PACKET) return { packets, rest: Buffer.alloc(0), error: 'packet too large' };
    if (i + len > buf.length) break;
    const type = buf[off] >> 4;
    const flags = buf[off] & 0x0f;
    const body = buf.subarray(i, i + len);
    packets.push(decode(type, flags, body));
    off = i + len;
  }
  return { packets, rest: buf.subarray(off) };
}

function readStr(b, o) {
  const n = b.readUInt16BE(o);
  return { value: b.toString('utf8', o + 2, o + 2 + n), next: o + 2 + n };
}

function decode(type, flags, body) {
  const p = { type, flags };
  try {
    if (type === T.CONNACK) { p.returnCode = body[1]; }
    else if (type === T.PUBLISH) {
      const t = readStr(body, 0);
      p.topic = t.value;
      p.qos = (flags >> 1) & 3;
      p.retain = !!(flags & 1);
      let o = t.next;
      if (p.qos > 0) { p.id = body.readUInt16BE(o); o += 2; }
      p.payload = body.subarray(o);
    } else if (type === T.SUBACK || type === T.PUBACK) { p.id = body.readUInt16BE(0); }
    else if (type === T.SUBSCRIBE) {
      p.id = body.readUInt16BE(0);
      p.topics = [];
      let o = 2;
      while (o < body.length) { const t = readStr(body, o); p.topics.push(t.value); o = t.next + 1; }
    } else if (type === T.CONNECT) {
      const proto = readStr(body, 0);
      let o = proto.next;
      p.level = body[o];
      const f = body[o + 1];
      p.keepalive = body.readUInt16BE(o + 2);
      o += 4;
      const cid = readStr(body, o); p.clientId = cid.value; o = cid.next;
      if (f & 0x04) { const wt = readStr(body, o); const wp = readStr(body, wt.next); p.will = { topic: wt.value, payload: wp.value, retain: !!(f & 0x20) }; o = wp.next; }
      if (f & 0x80) { const u = readStr(body, o); p.username = u.value; o = u.next; }
      if (f & 0x40) { const pw = readStr(body, o); p.password = pw.value; o = pw.next; }
    }
  } catch (e) { p.error = 'malformed'; }
  return p;
}

/* İstemci. Olaylar: 'connect', 'close', 'message' (topic, payloadString),
   'error' (mesaj). */
function createClient(opts) {
  const o = Object.assign({ port: 1883, keepalive: 30, reconnectMin: 2000, reconnectMax: 30000 }, opts || {});
  const ev = new EventEmitter();
  ev.on('error', () => {}); // dinleyici yoksa 'error' süreci düşürmesin
  let sock = null;
  let buf = Buffer.alloc(0);
  let connected = false;
  let stopped = false;
  let retryMs = o.reconnectMin;
  let retryTimer = null;
  let pingTimer = null;
  let lastError = '';
  let subId = 1;

  function cleanup() {
    clearInterval(pingTimer);
    pingTimer = null;
    connected = false;
    buf = Buffer.alloc(0);
    if (sock) { sock.removeAllListeners(); try { sock.destroy(); } catch (e) { /* kapalı */ } }
    sock = null;
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; open(); }, retryMs);
    if (retryTimer.unref) retryTimer.unref();
    retryMs = Math.min(o.reconnectMax, retryMs * 2);
  }

  function fail(msg) {
    lastError = msg;
    ev.emit('error', msg);
  }

  function open() {
    if (stopped) return;
    const onConn = () => {
      sock.write(connect({ clientId: o.clientId, username: o.username, password: o.password, keepalive: o.keepalive, will: o.will }));
    };
    try {
      sock = o.tls
        ? tls.connect({ host: o.host, port: o.port, servername: net.isIP(o.host) ? undefined : o.host }, onConn)
        : net.connect({ host: o.host, port: o.port }, onConn);
    } catch (e) {
      fail(String(e.message || e));
      scheduleRetry();
      return;
    }
    sock.setNoDelay(true);
    sock.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      const r = parse(buf);
      buf = r.rest;
      if (r.error) { fail(r.error); cleanup(); ev.emit('close'); scheduleRetry(); return; }
      for (const p of r.packets) onPacket(p);
    });
    sock.on('error', (e) => fail(String((e && (e.code || e.message)) || e)));
    sock.on('close', () => {
      const was = connected;
      cleanup();
      if (was) ev.emit('close');
      scheduleRetry();
    });
  }

  function onPacket(p) {
    if (p.type === T.CONNACK) {
      if (p.returnCode !== 0) {
        const why = ['', 'protocol', 'client id', 'server unavailable', 'bad username or password', 'not authorized'][p.returnCode] || ('code ' + p.returnCode);
        fail('refused: ' + why);
        cleanup();
        scheduleRetry();
        return;
      }
      connected = true;
      lastError = '';
      retryMs = o.reconnectMin;
      if (o.keepalive > 0) {
        pingTimer = setInterval(() => { if (sock) sock.write(packet(T.PINGREQ, 0, Buffer.alloc(0))); }, o.keepalive * 500);
        if (pingTimer.unref) pingTimer.unref();
      }
      ev.emit('connect');
    } else if (p.type === T.PUBLISH && !p.error) {
      // QoS 1 gelirse onaylanır (aboneliğimiz QoS 0, yine de güvenli)
      if (p.qos === 1 && sock) { const id = Buffer.alloc(2); id.writeUInt16BE(p.id); sock.write(packet(T.PUBACK, 0, id)); }
      ev.emit('message', p.topic, p.payload.toString('utf8'), p.retain);
    }
  }

  ev.start = () => { stopped = false; open(); };
  ev.publish = (topic, payload, retain) => {
    if (!connected || !sock) return false;
    sock.write(publish(topic, payload, retain));
    return true;
  };
  ev.subscribe = (topics) => {
    if (!connected || !sock || !topics.length) return false;
    sock.write(subscribe(subId++, topics));
    return true;
  };
  /* Kapanış: varsa son mesajlar yazıldıktan sonra DISCONNECT. */
  ev.stop = (finals) => new Promise((resolve) => {
    stopped = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!sock || !connected) { cleanup(); resolve(); return; }
    for (const m of finals || []) sock.write(publish(m.topic, m.payload, m.retain));
    const s = sock;
    s.end(packet(T.DISCONNECT, 0, Buffer.alloc(0)), () => { cleanup(); resolve(); });
    setTimeout(() => { cleanup(); resolve(); }, 500).unref();
  });
  ev.status = () => ({ connected, error: lastError });
  return ev;
}

module.exports = { T, varInt, connect, publish, subscribe, packet, parse, createClient };
