/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISI: AĞDA GÖRÜNME (#1054, docs/PHONE-LINK.md). Bağlantı açık ve "Ağda görünür
   ol" seçiliyken iki saniyede bir yerel ağa UDP duyurusu yollar. Duyuruda gizli bir şey yok:
   uygulama adı, bilgisayar kimliği ve adı, bağlantı noktası. Telefon listeyi gösterir; eşleşme
   yine QR ya da kod ister. Dışarıdan bir şey dinlemez, gelen paket işlenmez. Bağımlılık yok. */
const dgram = require('dgram');
const os = require('os');

const PORT = 47821;
const EVERY_MS = 2000;

/** Duyuru paketi (sınamada da kullanılır). */
function packet(info) {
  const name = String(info.name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 64);
  return Buffer.from(JSON.stringify({ sv: 'sv-link', v: 1, id: String(info.id || '').slice(0, 32), name, port: info.port | 0 }));
}

/** Telefonun yaptığı gibi duyuruyu çözer: geçersizse null. */
function parse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length > 512) return null;
  let o;
  try { o = JSON.parse(buf.toString('utf8')); } catch { return null; }
  if (!o || o.sv !== 'sv-link' || o.v !== 1 || typeof o.id !== 'string' || !(o.port > 0 && o.port < 65536)) return null;
  return { id: o.id.slice(0, 32), name: String(o.name || '').slice(0, 64), port: o.port | 0 };
}

/** Her IPv4 ağ kartının yayın adresi (sanal kartlar dahil; telefon hangisindeyse onu duyar). */
function broadcastAddresses(nets) {
  const out = new Set(['255.255.255.255']);
  const all = nets || os.networkInterfaces();
  for (const name of Object.keys(all)) {
    for (const n of all[name] || []) {
      if (n.family !== 'IPv4' && n.family !== 4) continue;
      if (n.internal || !n.netmask) continue;
      const a = n.address.split('.').map(Number), m = n.netmask.split('.').map(Number);
      if (a.length !== 4 || m.length !== 4 || a[0] === 169) continue;
      out.add(a.map((x, i) => (x | (~m[i] & 255)) & 255).join('.'));
    }
  }
  return Array.from(out);
}

function create() {
  let sock = null;
  let timer = null;
  let info = null;
  function tick() {
    if (!sock || !info) return;
    const p = packet(info);
    for (const addr of broadcastAddresses()) {
      try { sock.send(p, PORT, addr, () => {}); } catch { /* ağ kartı yok olmuş olabilir */ }
    }
  }
  function start(next) {
    info = next;
    if (sock) { tick(); return; }
    sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => stop());
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* */ }
      tick();
      timer = setInterval(tick, EVERY_MS);
      if (timer.unref) timer.unref();
    });
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (sock) { try { sock.close(); } catch { /* */ } sock = null; }
  }
  return { start, stop, running: () => !!sock };
}

module.exports = { PORT, packet, parse, broadcastAddresses, create };
