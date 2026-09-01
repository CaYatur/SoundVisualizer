'use strict';
/* Art-Net (DMX over Ethernet) çıkışı.

   Sahne renklerini profesyonel ışık dünyasının standart protokolüyle yayar:
   herhangi bir Art-Net düğümü, DMX arayüzü ya da yazılım konsolu (QLC+,
   Resolume, grandMA) bu paketleri doğrudan alır.

   Windows Dynamic Lighting'in tamamlayıcısıdır, yerine geçmez: o klavye/fare
   gibi tüketici aygıtlarını, bu sahne ışıklarını sürer.

   ArtDMX paketi (OpCode 0x5000) 18 baytlık sabit bir başlık + kanal
   verisinden oluşur; UDP üzerinden 6454 portuna gider. Bağımlılık gerekmez,
   protokolün ihtiyaç duyulan kısmı burada. */

const dgram = require('dgram');

const ART_PORT = 6454;
const OPCODE_DMX = 0x5000;
const PROTOCOL_VERSION = 14;

let socket = null;
let sequence = 0;
let state = { running: false, error: null, host: '', universe: 0, packets: 0, lastSend: 0 };
let lastSendAt = 0;

// Sahne renklerinden DMX kanal verisi üretir
function buildChannels(cfg, frame) {
  const a = cfg || {};
  const fixtures = Math.max(1, Math.min(170, a.fixtures | 0 || 8));
  const perFixture = a.channelsPerFixture === 4 ? 4 : 3;
  const brightness = Math.max(0, Math.min(1, a.brightness == null ? 1 : a.brightness));
  const start = Math.max(1, Math.min(512, a.startChannel | 0 || 1));
  const total = Math.min(512, start - 1 + fixtures * perFixture);
  const data = Buffer.alloc(total < 2 ? 2 : total % 2 ? total + 1 : total);

  const level = frame && frame.level ? frame.level : 0;
  const bass = frame && frame.bass ? frame.bass : 0;
  const mid = frame && frame.mid ? frame.mid : 0;
  const treble = frame && frame.treble ? frame.treble : 0;
  const colors = (frame && frame.backgroundColors) || [];

  for (let i = 0; i < fixtures; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    const f = fixtures > 1 ? i / (fixtures - 1) : 0;

    if (a.mode === 'bands') {
      // Aygıtlar bas → orta → tiz boyunca dağılır
      const band = f < 0.34 ? bass : f < 0.67 ? mid : treble;
      const hue = f * 300;
      const rgb = hsvToRgb(hue, 0.9, Math.min(1, band * 1.4));
      r = rgb[0]; g = rgb[1]; b = rgb[2];
    } else if (a.mode === 'single') {
      const rgb = hexToRgb(a.color || '#ff2020');
      const k = Math.min(1, level * 1.6);
      r = rgb[0] * k; g = rgb[1] * k; b = rgb[2] * k;
    } else if (a.mode === 'spectrum') {
      const hue = (f * 360 + (frame && frame.time ? frame.time * 30 : 0)) % 360;
      const rgb = hsvToRgb(hue, 0.95, Math.min(1, 0.25 + level * 1.5));
      r = rgb[0]; g = rgb[1]; b = rgb[2];
    } else {
      // 'palette': görselleştiricinin o anki arkaplan renkleri
      const hex = colors.length ? colors[Math.floor(f * (colors.length - 1))] : '#3aa6ff';
      const rgb = hexToRgb(hex);
      const k = Math.min(1, 0.2 + level * 1.5);
      r = rgb[0] * k; g = rgb[1] * k; b = rgb[2] * k;
    }

    const base = start - 1 + i * perFixture;
    if (base + perFixture > data.length) break;
    data[base] = clamp255(r * 255 * brightness);
    data[base + 1] = clamp255(g * 255 * brightness);
    data[base + 2] = clamp255(b * 255 * brightness);
    if (perFixture === 4) {
      // RGBW: beyaz kanal, üç rengin en küçüğünden türetilir
      data[base + 3] = clamp255(Math.min(r, g, b) * 255 * brightness);
    }
  }
  return data;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(s, 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((((h / 60) % 2) + 2) % 2 - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  if (seg === 0) { r = c; g = x; }
  else if (seg === 1) { r = x; g = c; }
  else if (seg === 2) { g = c; b = x; }
  else if (seg === 3) { g = x; b = c; }
  else if (seg === 4) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

function buildPacket(cfg, data) {
  const universe = Math.max(0, Math.min(32767, cfg.universe | 0));
  const header = Buffer.alloc(18);
  header.write('Art-Net\0', 0, 'ascii');
  header.writeUInt16LE(OPCODE_DMX, 8);
  header.writeUInt16BE(PROTOCOL_VERSION, 10);
  header.writeUInt8(sequence, 12);
  header.writeUInt8(0, 13); // physical
  header.writeUInt8(universe & 0xff, 14); // SubUni
  header.writeUInt8((universe >> 8) & 0x7f, 15); // Net
  header.writeUInt16BE(data.length, 16);
  sequence = (sequence + 1) % 256;
  if (sequence === 0) sequence = 1; // 0 = "sıra kullanılmıyor"
  return Buffer.concat([header, data]);
}

function start(cfg) {
  const a = cfg || {};
  if (!a.enabled) return stop().then(() => status());
  if (socket) {
    state.host = a.host || '255.255.255.255';
    state.universe = a.universe | 0;
    return Promise.resolve(status());
  }
  return new Promise((resolve) => {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('error', (err) => {
      state.error = err.code || err.message;
      state.running = false;
      try { socket.close(); } catch { /* zaten kapalı */ }
      socket = null;
      resolve(status());
    });
    socket.bind(() => {
      try {
        // Yayın (broadcast) adresi Art-Net'in olağan kullanımıdır
        socket.setBroadcast(true);
      } catch { /* bazı ortamlarda izin yok; tek adrese göndermeye devam */ }
      state = {
        running: true,
        error: null,
        host: a.host || '255.255.255.255',
        universe: a.universe | 0,
        packets: 0,
        lastSend: 0,
      };
      resolve(status());
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    state.running = false;
    if (!socket) { resolve(); return; }
    const s = socket;
    socket = null;
    try { s.close(() => resolve()); } catch { resolve(); }
    setTimeout(resolve, 200);
  });
}

/* Ses/renk karesini DMX'e çevirip yollar. Kare hızı ayardan sınırlanır:
   DMX 44 Hz'in üstünü zaten taşıyamaz ve ağı gereksiz doldurmanın anlamı yok. */
function send(cfg, frame) {
  if (!socket || !state.running || !cfg || !cfg.enabled) return;
  const now = Date.now();
  const minGap = 1000 / Math.max(1, Math.min(44, cfg.fps | 0 || 30));
  if (now - lastSendAt < minGap - 1) return;
  lastSendAt = now;

  const data = buildChannels(cfg, frame);
  const packet = buildPacket(cfg, data);
  const host = cfg.host || '255.255.255.255';
  const port = cfg.port | 0 || ART_PORT;
  try {
    socket.send(packet, port, host, (err) => {
      if (err) state.error = err.code || err.message;
      else {
        state.packets++;
        state.lastSend = now;
      }
    });
  } catch (err) {
    state.error = err.message;
  }
}

function status() {
  return Object.assign({}, state);
}

module.exports = { start, stop, send, status, buildChannels, buildPacket, ART_PORT };
