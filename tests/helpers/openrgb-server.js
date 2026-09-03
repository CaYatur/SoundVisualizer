'use strict';
/* Sahte OpenRGB sunucusu.
 *
 * Gerçek OpenRGB bu makinede kurulu değil ve kurulu olsa bile sürücüsü
 * olmayan aygıtları taklit edemezdi. Bu sunucu gerçek tel protokolünü
 * konuşur, böylece istemcinin TAMAMI sınanabilir: el sıkışma, sürüm
 * pazarlığı, aygıt keşfi, renk paketleri, kopan bağlantı. Donanıma giden
 * son adım hariç her şey.
 *
 * Sunucu, aldığı her paketi kaydeder; testler "ne gönderdik" sorusunu
 * tahmin ederek değil, telde ne göründüğüne bakarak yanıtlar.
 */

const net = require('net');

const MAGIC = 'ORGB';
const HEADER = 16;

const CMD = {
  REQUEST_CONTROLLER_COUNT: 0,
  REQUEST_CONTROLLER_DATA: 1,
  REQUEST_PROTOCOL_VERSION: 40,
  SET_CLIENT_NAME: 50,
  DEVICE_LIST_UPDATED: 100,
  UPDATE_LEDS: 1050,
  SET_CUSTOM_MODE: 1100,
};

// --- aygıt tanımı kurucuları (gerçek sunucunun yolladığı biçim) ---
function str(s) {
  const b = Buffer.from(s, 'utf8');
  const out = Buffer.alloc(2 + b.length + 1);
  out.writeUInt16LE(b.length + 1, 0);
  b.copy(out, 2);
  return out;
}
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };

function buildController(o, protocol) {
  const p = protocol;
  const modes = o.modes || ['Direct', 'Static'];
  const parts = [u32(0), u32(o.type === undefined ? 5 : o.type), str(o.name)];
  if (p >= 1) parts.push(str('Vendor'));
  parts.push(str('aygıt'), str('1.0'), str('SN'), str('USB:1'));
  parts.push(u16(modes.length), u32(0));
  for (const name of modes) {
    parts.push(str(name), i32(0), u32(0), u32(0), u32(100));
    if (p >= 3) parts.push(u32(0), u32(100));
    parts.push(u32(0), u32(0), u32(50));
    if (p >= 3) parts.push(u32(100));
    parts.push(u32(0), u32(0), u16(0));
  }
  parts.push(u16(1), str('Zone'), u32(1), u32(0), u32(o.leds), u32(o.leds), u16(0));
  if (p >= 4) parts.push(u16(0));
  parts.push(u16(o.leds));
  for (let i = 0; i < o.leds; i++) parts.push(str('L' + i), u32(0));
  parts.push(u16(0));
  const buf = Buffer.concat(parts);
  buf.writeUInt32LE(buf.length, 0);
  return buf;
}

function header(deviceId, commandId, size) {
  const b = Buffer.alloc(HEADER);
  b.write(MAGIC, 0, 'ascii');
  b.writeUInt32LE(deviceId >>> 0, 4);
  b.writeUInt32LE(commandId >>> 0, 8);
  b.writeUInt32LE(size >>> 0, 12);
  return b;
}

/* opts:
     devices          : [{name, leds, modes, type}]
     protocol         : sunucunun desteklediği sürüm
     answerVersion    : false ise sürüm sorusuna HİÇ cevap vermez (eski sunucu) */
function createFakeServer(opts) {
  const o = Object.assign({ devices: [{ name: 'Test Klavye', leds: 4 }], protocol: 4, answerVersion: true }, opts);
  const received = [];
  let clientName = null;
  let sockets = [];

  const server = net.createServer((sock) => {
    sockets.push(sock);
    let buf = Buffer.alloc(0);
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < HEADER) return;
        if (buf.toString('ascii', 0, 4) !== MAGIC) { buf = Buffer.alloc(0); return; }
        const dev = buf.readUInt32LE(4);
        const cmd = buf.readUInt32LE(8);
        const size = buf.readUInt32LE(12);
        if (buf.length < HEADER + size) return;
        const body = Buffer.from(buf.subarray(HEADER, HEADER + size));
        buf = buf.subarray(HEADER + size);
        received.push({ device: dev, command: cmd, body });

        if (cmd === CMD.SET_CLIENT_NAME) {
          clientName = body.toString('utf8').replace(/\0+$/, '');
        } else if (cmd === CMD.REQUEST_PROTOCOL_VERSION) {
          if (o.answerVersion) {
            sock.write(Buffer.concat([header(0, cmd, 4), u32(o.protocol)]));
          }
        } else if (cmd === CMD.REQUEST_CONTROLLER_COUNT) {
          sock.write(Buffer.concat([header(0, cmd, 4), u32(o.devices.length)]));
        } else if (cmd === CMD.REQUEST_CONTROLLER_DATA) {
          const d = o.devices[dev];
          if (d) {
            const blob = buildController(d, o.protocol);
            sock.write(Buffer.concat([header(dev, cmd, blob.length), blob]));
          }
        }
      }
    });
  });

  return {
    server,
    received,
    get clientName() { return clientName; },
    /* Aygıt listesi değişti bildirimi — istemci yeniden taramalı. */
    announceDeviceChange() {
      for (const s of sockets) {
        try { s.write(header(0, CMD.DEVICE_LIST_UPDATED, 0)); } catch {}
      }
    },
    /* Bağlantıyı kopar — yeniden bağlanma sınaması için. */
    dropClients() {
      for (const s of sockets) { try { s.destroy(); } catch {} }
      sockets = [];
    },
    ledPackets() {
      return received.filter((r) => r.command === CMD.UPDATE_LEDS);
    },
    customModeCalls() {
      return received.filter((r) => r.command === CMD.SET_CUSTOM_MODE);
    },
    listen() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const s of sockets) { try { s.destroy(); } catch {} }
        sockets = [];
        server.close(() => resolve());
      });
    },
  };
}

/* Bir renk paketinin gövdesini {r,g,b} listesine çevirir. */
function decodeLedPacket(body) {
  const n = body.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 4;
    out.push({ r: body.readUInt8(o), g: body.readUInt8(o + 1), b: body.readUInt8(o + 2) });
  }
  return out;
}

module.exports = { createFakeServer, decodeLedPacket, CMD };
