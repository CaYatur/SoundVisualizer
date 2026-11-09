/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Art-Net (ArtDmx) GİRİŞİ: ışık masasından SoundVisualizer'ı sürmek.

   Seçilen evrene gelen DMX kanallarından yalnız DEĞİŞENLER panele iletilir;
   panel onları MIDI/OSC eşlemesi gibi ayar yollarına ve eylemlere bağlar
   (control.js). Paket hızı ne olursa olsun panele en çok saniyede 30 toplu
   ileti gider.

   Varsayılan dinleme adresi 127.0.0.1: aynı bilgisayardaki masa yazılımı
   (QLC+, MagicQ…) için. Ağdaki bir masa için kullanıcı 0.0.0.0 seçer.
   Bağlantı noktası başka bir uygulamadaysa ya da redundancy tanığıyla
   paylaşılıyorsa (reuseAddr) açılış yine de çökmez; durum hatayı söyler. */

const dgram = require('dgram');
const artnet = require('./artnet');

const HEADER = 18;

/* ArtDmx paketinden evren ve kanal verisi; değilse null. */
function parseData(buf) {
  const p = artnet.parseDmx(buf);
  if (!p) return null;
  const len = Math.max(0, Math.min(512, p.length, buf.length - HEADER));
  return { universe: p.universe, data: buf.subarray(HEADER, HEADER + len) };
}

/* Önceki kareye göre değişen kanallar: [[kanal(1..512), değer(0..255)], …] */
function diff(prev, data) {
  const out = [];
  for (let i = 0; i < data.length; i++) {
    if (prev[i] !== data[i]) { out.push([i + 1, data[i]]); prev[i] = data[i]; }
  }
  return out;
}

function createReceiver(opts) {
  const o = Object.assign({ port: artnet.ART_PORT, bind: '127.0.0.1', universe: 0, flushMs: 33 }, opts || {});
  let sock = null;
  let timer = null;
  const prev = new Int16Array(512).fill(-1);
  const pending = new Map(); // kanal -> değer
  const st = { listening: false, error: '', packets: 0, universe: o.universe | 0, bind: o.bind, port: o.port };

  function flush() {
    timer = null;
    if (!pending.size) return;
    const changes = Array.from(pending.entries()).sort((a, b) => a[0] - b[0]);
    pending.clear();
    if (o.onChanges) {
      try { o.onChanges({ universe: st.universe, changes }); } catch { /* panel kapalı olabilir */ }
    }
  }

  function onMessage(buf) {
    const p = parseData(buf);
    if (!p || p.universe !== st.universe) return;
    st.packets++;
    for (const [ch, v] of diff(prev, p.data)) pending.set(ch, v);
    if (pending.size && !timer) timer = setTimeout(flush, o.flushMs);
  }

  return {
    start() {
      if (sock) return Promise.resolve(this.status());
      return new Promise((resolve) => {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sock = s;
        s.on('error', (e) => {
          st.listening = false;
          st.error = (e && e.code) || 'error';
          try { s.close(); } catch { /* */ }
          if (sock === s) sock = null;
          resolve(this.status());
        });
        s.on('message', onMessage);
        try {
          s.bind(o.port, o.bind, () => { st.listening = true; st.error = ''; resolve(this.status()); });
        } catch (e) {
          st.error = (e && e.code) || 'error';
          sock = null;
          resolve(this.status());
        }
      });
    },
    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      pending.clear();
      prev.fill(-1);
      st.listening = false;
      if (!sock) return Promise.resolve();
      const s = sock;
      sock = null;
      return new Promise((resolve) => { try { s.close(() => resolve()); } catch { resolve(); } setTimeout(resolve, 200); });
    },
    // Kanal değerlerini unut: bir sonraki karede hepsi yeniden iletilir
    resync() { prev.fill(-1); },
    status() { return Object.assign({}, st); },
  };
}

/* Dinleme adresi: yalnız 127.0.0.1 ya da 0.0.0.0 ya da geçerli bir IPv4. */
function safeBind(v) {
  const s = String(v || '').trim();
  if (s === '0.0.0.0' || s === '127.0.0.1') return s;
  const parts = s.split('.');
  if (parts.length === 4 && parts.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return s;
  return '127.0.0.1';
}

module.exports = { createReceiver, parseData, diff, safeBind };
