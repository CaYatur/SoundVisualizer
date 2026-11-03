/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ÇOKLU KOPYA UZAKTAN KUMANDA (eş aktarma).

   instances.js aynı makinedeki kopyaların ayar klasörünü ayırıyor; bir
   kumandanın birden çok kopyayı (başka makinedekiler dahil) birlikte
   sürmesi yoktu. Burada: stream.remotePeers'taki her eşe (öbür kopyanın
   /remote adresi, jetonuyla) WebSocket açılır; bu kopyaya gelen kumanda
   komutu eşlere de yollanır. Eşe giden ileti `relayed: true` taşır, eş onu
   bir daha aktarmaz: iki kopya birbirini listelese de döngü olmaz.

   Eş adresi: http(s)://host:port/remote?token=JETON (kumanda sayfasının
   adresi olduğu gibi yapıştırılır). Jeton web istemcisine gitmez. */

function parsePeers(text) {
  const out = [];
  const seen = new Set();
  String(text || '').split(/[\r\n,]+/).forEach((raw) => {
    const s = raw.trim();
    if (!s) return;
    let u;
    try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'http://' + s); } catch { return; }
    if (!/^(https?|wss?):$/.test(u.protocol) || !u.hostname) return;
    const secure = u.protocol === 'https:' || u.protocol === 'wss:';
    const token = u.searchParams.get('token') || '';
    const q = new URLSearchParams({ kind: 'remote' });
    if (token) q.set('token', token);
    const ws = (secure ? 'wss://' : 'ws://') + u.host + '/ws?' + q.toString();
    if (seen.has(ws)) return;
    seen.add(ws);
    out.push({ ws, host: u.host, token });
  });
  return out.slice(0, 16);
}

/* Aktarılabilir komut: kumandanın kendi sayfa işleri (ping vb.) değil */
function relayable(msg) {
  return !!(msg && typeof msg === 'object' && msg.type === 'command' && !msg.relayed);
}

function createRelay(opts) {
  const o = opts || {};
  const WS = o.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  let peers = [];
  const conns = new Map(); // ws url -> { sock, retry, wait }
  let key = '';

  function open(p) {
    const c = conns.get(p.ws) || { sock: null, retry: null, wait: 1000 };
    conns.set(p.ws, c);
    if (!WS) return;
    let s;
    try { s = new WS(p.ws); } catch { schedule(p, c); return; }
    c.sock = s;
    s.onopen = () => { c.wait = 1000; };
    s.onclose = () => { if (conns.get(p.ws) === c) { c.sock = null; schedule(p, c); } };
    s.onerror = () => { /* onclose ardından gelir */ };
    s.onmessage = () => { /* eşin yayınları burada gerekmez */ };
  }
  function schedule(p, c) {
    if (c.retry || conns.get(p.ws) !== c) return;
    c.retry = setTimeout(() => { c.retry = null; if (conns.get(p.ws) === c) open(p); }, c.wait);
    if (c.retry.unref) c.retry.unref();
    c.wait = Math.min(30000, c.wait * 2);
  }
  function closeAll() {
    for (const c of conns.values()) {
      if (c.retry) clearTimeout(c.retry);
      if (c.sock) { try { c.sock.onclose = null; c.sock.close(); } catch { /* */ } }
    }
    conns.clear();
  }
  return {
    update(text) {
      const next = parsePeers(text);
      const k = next.map((p) => p.ws).join('|');
      if (k === key) return;
      key = k;
      closeAll();
      peers = next;
      peers.forEach(open);
    },
    forward(msg) {
      if (!relayable(msg)) return 0;
      const data = JSON.stringify(Object.assign({}, msg, { relayed: true }));
      let n = 0;
      for (const c of conns.values()) {
        if (c.sock && c.sock.readyState === 1) { try { c.sock.send(data); n++; } catch { /* */ } }
      }
      return n;
    },
    status() {
      return peers.map((p) => {
        const c = conns.get(p.ws);
        return { host: p.host, connected: !!(c && c.sock && c.sock.readyState === 1) };
      });
    },
    stop() { key = ''; closeAll(); peers = []; },
  };
}

module.exports = { parsePeers, relayable, createRelay };
