/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Ortak UDP gönderici: sACN, DDP (WLED) ve WLED ses senkronu aynı küçük
   soket yaşam döngüsünü kullanır. Yalnız GÖNDERİR; hiçbir porta dinlemek
   için bağlanmaz (bind rastgele yerel porta, yalnız çıkış için). Kapalıyken
   soket hiç açılmaz. Hata olursa soket kapanır ve durum hatayı söyler;
   uygulamanın geri kalanı etkilenmez. */

const dgram = require('dgram');

function createSender(name) {
  let socket = null;
  let opening = null;
  let lastAt = 0;
  let st = { running: false, error: null, host: '', packets: 0, lastSend: 0 };

  function start(opts) {
    const o = opts || {};
    if (socket) {
      st.host = o.host || st.host;
      return Promise.resolve(status());
    }
    if (opening) return opening;
    opening = new Promise((resolve) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('error', (err) => {
        st.error = (err && (err.code || err.message)) || 'error';
        st.running = false;
        try { s.close(); } catch { /* zaten kapalı */ }
        if (socket === s) socket = null;
        opening = null;
        resolve(status());
      });
      s.bind(0, () => {
        try { s.setBroadcast(true); } catch { /* izin yoksa tek adrese gönderilir */ }
        if (o.multicastTtl) { try { s.setMulticastTTL(o.multicastTtl | 0); } catch { /* */ } }
        socket = s;
        opening = null;
        st = { running: true, error: null, host: o.host || '', packets: 0, lastSend: 0 };
        resolve(status());
      });
    });
    return opening;
  }

  function stop() {
    return new Promise((resolve) => {
      st.running = false;
      if (!socket) { resolve(); return; }
      const s = socket;
      socket = null;
      try { s.close(() => resolve()); } catch { resolve(); }
      setTimeout(resolve, 200);
    });
  }

  // Kare hızı sınırı: fps'ten sık çağrılırsa false döner, paket gitmez
  function due(fps, max) {
    const now = Date.now();
    const gap = 1000 / Math.max(1, Math.min(max || 60, fps | 0 || 30));
    if (now - lastAt < gap - 1) return false;
    lastAt = now;
    return true;
  }

  function send(packets, port, host) {
    if (!socket || !st.running) return false;
    const list = Array.isArray(packets) ? packets : [packets];
    const now = Date.now();
    for (const p of list) {
      try {
        socket.send(p, port, host, (err) => {
          if (err) st.error = err.code || err.message;
          else { st.packets++; st.lastSend = now; }
        });
      } catch (err) {
        st.error = err.message;
        return false;
      }
    }
    return true;
  }

  /* Paketleri yollar ve hepsi soketten çıkınca çözülür (kapanış paketi
     soket kapanmadan gitsin diye). En çok 300 ms bekler. */
  function flush(packets, port, host) {
    if (!socket || !st.running) return Promise.resolve(false);
    const s = socket;
    const list = Array.isArray(packets) ? packets : [packets];
    return new Promise((resolve) => {
      let left = list.length;
      const t = setTimeout(() => resolve(false), 300);
      const one = () => { if (--left <= 0) { clearTimeout(t); resolve(true); } };
      for (const p of list) {
        try { s.send(p, port, host, one); } catch { one(); }
      }
    });
  }

  function status() { return Object.assign({ name }, st); }
  function running() { return !!socket && st.running; }

  return { start, stop, send, flush, due, status, running };
}

module.exports = { createSender };
