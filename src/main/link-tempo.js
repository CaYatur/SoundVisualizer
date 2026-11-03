/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ABLETON LINK TEMPOSU (yalnız dinleme).

   Link eşleri 224.76.78.75:20808 çok noktaya yayın grubuna "_asdp_v\x01"
   başlıklı paketler yollar. Başlıktan sonra: ileti türü (1 bayt; 1 canlı,
   2 yanıt, 3 ayrılış), TTL (1), grup kimliği (2), düğüm kimliği (8), sonra
   anahtar(4) + boy(4, BE) + değer kayıtları. 'tmln' kaydı:
   microsPerBeat(int64) + beatOrigin(int64) + timeOrigin(int64).
     bpm = 60e6 / microsPerBeat

   Uygulama Link oturumuna KATILMAZ ve tempo yayınlamaz: yalnızca dinler,
   ağdaki Ableton/Traktor/Rekordbox'un temposunu modülasyon saatine verir.
   Tam katılım (evre eşleme, tempo önerme) resmi C++ kitaplığını ister;
   yerel eklenti eklememek için kapsam dışı. */
const dgram = require('dgram');

const GROUP = '224.76.78.75';
const PORT = 20808;
const MAGIC = Buffer.from('_asdp_v\x01', 'latin1');

function parsePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length + 12) return null;
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  let o = MAGIC.length;
  const type = buf[o];
  o += 4; // tür, ttl, grup kimliği
  const node = buf.subarray(o, o + 8).toString('hex');
  o += 8;
  if (type === 3) return { type, node, bpm: 0 };
  let bpm = 0;
  while (o + 8 <= buf.length) {
    const key = buf.subarray(o, o + 4).toString('latin1');
    const size = buf.readUInt32BE(o + 4);
    o += 8;
    if (o + size > buf.length) break;
    if (key === 'tmln' && size >= 8) {
      const mpb = Number(buf.readBigInt64BE(o));
      if (mpb > 0) bpm = Math.round((60e6 / mpb) * 100) / 100;
    }
    o += size;
  }
  return { type, node, bpm: bpm >= 20 && bpm <= 999 ? bpm : 0 };
}

/* onTempo({ bpm, peers }) tempo ya da eş sayısı değişince çağrılır. */
function createListener(onTempo, opts) {
  const o = opts || {};
  const peers = new Map(); // düğüm -> son görülme
  let sock = null;
  let last = { bpm: 0, peers: 0 };
  let sweep = null;
  const emit = (bpm) => {
    const cur = { bpm: bpm || last.bpm, peers: peers.size };
    if (!cur.peers) cur.bpm = 0;
    if (cur.bpm !== last.bpm || cur.peers !== last.peers) { last = cur; try { onTempo(cur); } catch { /* */ } }
  };
  return {
    start() {
      if (sock) return;
      const factory = o.createSocket || dgram.createSocket;
      sock = factory({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => { /* port meşgulse sessizce kapalı kalır */ });
      sock.on('message', (msg) => {
        const p = parsePacket(msg);
        if (!p) return;
        if (p.type === 3) { peers.delete(p.node); emit(0); return; }
        peers.set(p.node, Date.now());
        if (p.bpm) emit(p.bpm);
      });
      try {
        sock.bind(PORT, () => {
          try { sock.addMembership(GROUP); } catch { /* ağ yoksa */ }
        });
      } catch { /* */ }
      sweep = setInterval(() => {
        const now = Date.now();
        for (const [k, t] of peers) if (now - t > 5000) peers.delete(k);
        emit(0);
      }, 2000);
      if (sweep.unref) sweep.unref();
    },
    stop() {
      if (sweep) clearInterval(sweep);
      sweep = null;
      if (sock) { try { sock.close(); } catch { /* */ } }
      sock = null;
      peers.clear();
      last = { bpm: 0, peers: 0 };
    },
    running() { return !!sock; },
    state() { return Object.assign({}, last); },
  };
}

module.exports = { parsePacket, createListener, GROUP, PORT, MAGIC };
