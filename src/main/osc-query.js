/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OSCQuery HTTP + mDNS (#734). Ağaç src/shared/osc-tree.js ile aynı. */

const http = require('http');
const dgram = require('dgram');
const os = require('os');
const tree = require('../shared/osc-tree');
const mdns = require('../shared/osc-mdns');

let server = null;
let socket = null;
let timer = null;
let listening = false;
let announcing = false;

const VIRTUAL_NAME = /vethernet|virtual|vbox|vmware|host-only|wsl|hyper-?v|tap|tun|docker|tailscale|zerotier|bluetooth|npcap|vmnet|virbr/i;

function isIPv4(family) {
  return family === 'IPv4' || family === 4;
}

/* İlk bulunan adres sanal kart olabiliyor (VirtualBox 192.168.56.1).
   Yayın sunucusundaki puanla aynı tercih: gerçek Ethernet veya Wi-Fi,
   özel ağ, sanal ad en sonda. */
function chooseLanIPv4(nets) {
  const candidates = [];
  const table = nets && typeof nets === 'object' ? nets : {};
  for (const name of Object.keys(table)) {
    const virtual = VIRTUAL_NAME.test(name);
    for (const net of table[name] || []) {
      if (!net || !isIPv4(net.family) || net.internal) continue;
      const addr = net.address;
      if (!addr || addr.startsWith('127.') || addr.startsWith('169.254.')) continue;
      let score = virtual ? 0 : 10;
      if (/wi-fi|wifi|wlan/i.test(name)) score += 8;
      else if (/ethernet|eth|en/i.test(name)) score += 5;
      if (addr.startsWith('192.168.')) score += 4;
      else if (addr.startsWith('10.')) score += 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score += 2;
      candidates.push({ address: addr, score });
    }
  }
  if (!candidates.length) return '127.0.0.1';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].address;
}

function lanIPv4() {
  return chooseLanIPv4(os.networkInterfaces());
}

function status() {
  const addr = server && server.listening ? server.address() : null;
  return {
    running: !!(server && server.listening),
    port: addr ? addr.port : 0,
    mdns: listening,
    mdnsAnnounce: announcing,
    error: null,
  };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  listening = false;
  announcing = false;
  const closing = [];
  if (socket) {
    const s = socket;
    socket = null;
    closing.push(new Promise((resolve) => {
      try { s.close(() => resolve()); } catch { resolve(); }
    }));
  }
  if (server) {
    const h = server;
    server = null;
    closing.push(new Promise((resolve) => {
      try { h.close(() => resolve()); } catch { resolve(); }
    }));
  }
  return Promise.all(closing).then(() => status());
}

function announceNow(opt) {
  if (!socket) return;
  const buf = mdns.announce(opt);
  try { socket.send(buf, 5353, '224.0.0.251'); } catch { /* ağ yok */ }
}

function armAnnounce(s, opt) {
  socket = s;
  announcing = true;
  try { s.setMulticastTTL(255); } catch { /* platform reddi */ }
  announceNow(opt);
  timer = setInterval(() => announceNow(opt), 60000);
  if (timer.unref) timer.unref();
}

/* 5353 IANA mDNS portudur ve değişmez. Paylaşılabilirsa sorguya da cevap
   verilir. Başkası portu yalnız kendine aldıysa duyuru kısa ömürlü bir
   soketten yine gider; sorgu bu sürece ulaşmaz. */
function startMdns(opt) {
  return new Promise((resolve) => {
    let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); }
    catch { resolve({ bound: false, announce: false }); return; }
    let done = false;
    const finish = (bound) => {
      if (done) return;
      done = true;
      clearTimeout(giveUp);
      if (!bound) {
        try { s.close(); } catch { /* kapalı */ }
        if (socket === s) socket = null;
        listening = false;
        announceOnly(opt).then(resolve);
        return;
      }
      resolve({ bound: true, announce: true });
    };
    const giveUp = setTimeout(() => finish(false), 1500);
    s.on('error', () => { if (!done) finish(false); });
    s.on('message', (buf, rinfo) => {
      const reply = mdns.answer(buf, opt);
      if (!reply || !rinfo) return;
      try { s.send(reply, rinfo.port, rinfo.address); } catch { /* düştü */ }
    });
    try {
      s.bind({ port: 5353, address: '0.0.0.0', exclusive: false }, () => {
        if (done) return;
        listening = true;
        try { s.addMembership('224.0.0.251'); } catch { /* üyelik reddi duyuruyu düşürmez */ }
        armAnnounce(s, opt);
        finish(true);
      });
    } catch { finish(false); }
  });
}

function announceOnly(opt) {
  return new Promise((resolve) => {
    let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); }
    catch { resolve({ bound: false, announce: false }); return; }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      listening = false;
      if (!ok) {
        announcing = false;
        try { s.close(); } catch { /* kapalı */ }
        if (socket === s) socket = null;
      }
      resolve({ bound: false, announce: ok });
    };
    s.on('error', () => finish(false));
    try {
      s.bind(0, () => {
        armAnnounce(s, opt);
        finish(true);
      });
    } catch { finish(false); }
  });
}

const RESERVED_QUERY = new Set([80, 443, 1900, 5353, 5355, 9000, 9001, 38471]);

function queryCandidates(preferred) {
  const out = [];
  const push = (port) => {
    const p = port | 0;
    if (out.includes(p)) return;
    if (p === 0) { out.push(0); return; }
    if (p < 1 || p > 65535 || RESERVED_QUERY.has(p)) return;
    out.push(p);
  };
  push(preferred);
  push(tree.DEFAULT_QUERY_PORT);
  for (let i = 1; i <= 20; i++) push(tree.DEFAULT_QUERY_PORT + i);
  push(0);
  return out;
}

function localhostIsOurs(port) {
  return new Promise((resolve) => {
    const req = http.get({
      host: '127.0.0.1', port, path: '/?HOST_INFO', timeout: 400,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = null; }
        resolve(res.statusCode === 200 && !!(json && json.NAME === 'SoundVisualizer'));
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function closeHttp(httpServer) {
  return new Promise((resolve) => {
    try { httpServer.close(() => resolve()); } catch { resolve(); }
  });
}

function openQuery(o, port) {
  return new Promise((resolve) => {
    const httpServer = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{}');
        return;
      }
      let body = null;
      try {
        const state = typeof o.getState === 'function' ? o.getState() : {};
        body = tree.handleQuery(req.url, state && state.cfg, {
          live: state && state.live,
          oscPort: o.oscPort,
          ip: o.ip || lanIPv4(),
        });
      } catch { body = null; }
      if (!body) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end('{}');
        return;
      }
      const json = JSON.stringify(body);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': '*',
      });
      res.end(json);
    });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      httpServer.close(() => resolve({ ok: false, error: error || 'listen' }));
    };
    httpServer.once('error', (err) => fail(err.code || err.message));
    try {
      httpServer.listen(port, '0.0.0.0', () => {
        if (settled) return;
        settled = true;
        const addr = httpServer.address();
        resolve({ ok: true, server: httpServer, port: addr && addr.port });
      });
    } catch (err) {
      fail(err.code || err.message);
    }
  });
}

function start(opts) {
  const o = opts || {};
  const requested = Math.max(1, Math.min(65535, o.port | 0 || tree.DEFAULT_QUERY_PORT));
  return stop().then(async () => {
    let lastError = 'EADDRINUSE';
    for (const candidate of queryCandidates(requested)) {
      const opened = await openQuery(o, candidate);
      if (!opened.ok) {
        lastError = opened.error || lastError;
        continue;
      }
      const ours = await localhostIsOurs(opened.port);
      if (!ours) {
        await closeHttp(opened.server);
        lastError = 'shadowed';
        continue;
      }
      server = opened.server;
      const mdnsOpt = {
        port: opened.port, ip: o.ip || lanIPv4(), name: 'SoundVisualizer', host: 'soundvisualizer',
      };
      const mdnsState = await startMdns(mdnsOpt);
      const st = status();
      st.port = opened.port;
      st.mdns = !!(mdnsState && mdnsState.bound);
      st.mdnsAnnounce = !!(mdnsState && mdnsState.announce);
      st.requestedPort = requested;
      st.moved = opened.port !== requested;
      return st;
    }
    return { running: false, port: 0, mdns: false, mdnsAnnounce: false, error: lastError, requestedPort: requested, moved: false };
  });
}

module.exports = { start, stop, status, lanIPv4, chooseLanIPv4, queryCandidates };
