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
const crypto = require('crypto');
const tree = require('../shared/osc-tree');
const mdns = require('../shared/osc-mdns');

let server = null;
let socket = null;
let timer = null;
let listening = false;
let announcing = false;
let epoch = 0;
let tail = Promise.resolve();
const mdnsSockets = new Set();
const INSTANCE = crypto.randomBytes(8).toString('hex');

const VIRTUAL_NAME = /vethernet|veth|virtual|vbox|vmware|host-only|wsl|hyper-?v|tap|tun|docker|tailscale|zerotier|bluetooth|npcap|vmnet|virbr|awdl|llw|anpi/i;
const WIFI_NAME = /wi-?fi|wlan|wlp|wlx/i;
/* "en" kelimenin içinde (OpenVPN) eşleşmesin. macOS en0, Linux eth0 ve enp3s0 geçer. */
const ETHER_NAME = /ethernet|(?:^|[^a-z])(?:eth|eno|ens|enp|enx|em|en)\d*/i;

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
      if (WIFI_NAME.test(name)) score += 8;
      else if (ETHER_NAME.test(name)) score += 5;
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

function closeSocket(s) {
  return new Promise((resolve) => {
    if (!s) { resolve(); return; }
    try { s.close(() => resolve()); } catch { resolve(); }
  });
}

/* Açık olan her mDNS soketini kapat. 5353 paylaşılınca yeni bind eskisini
   düşürmez; gecikmiş bind geri çağrısı da soketi bırakmamalı. */
function halt() {
  if (timer) clearInterval(timer);
  timer = null;
  listening = false;
  announcing = false;
  socket = null;
  const sockets = [...mdnsSockets];
  mdnsSockets.clear();
  const httpServer = server;
  server = null;
  return Promise.all(sockets.map(closeSocket).concat(httpServer ? [closeHttp(httpServer)] : []));
}

function stop() {
  epoch += 1;
  const job = tail.then(() => halt());
  tail = job.then(() => {}, () => {});
  return job.then(() => status());
}

function announceNow(opt) {
  if (!socket) return;
  const buf = mdns.announce(opt);
  try { socket.send(buf, 5353, '224.0.0.251'); } catch { /* ağ yok */ }
}

function trackMdns(s) {
  mdnsSockets.add(s);
  s.once('close', () => {
    mdnsSockets.delete(s);
    if (socket === s) {
      socket = null;
      listening = false;
      announcing = false;
      if (timer) clearInterval(timer);
      timer = null;
    }
  });
}

function armAnnounce(s, opt) {
  if (timer) clearInterval(timer);
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
function bindMdns(port, mine, onUp) {
  return new Promise((resolve) => {
    let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); }
    catch { resolve(false); return; }
    trackMdns(s);
    let done = false;
    const giveUp = setTimeout(() => finish(false), 1500);
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(giveUp);
      if (!ok) closeSocket(s);
      resolve(ok);
    };
    s.on('error', () => finish(false));
    s.on('message', (buf, rinfo) => {
      if (socket !== s) return;
      const reply = mdns.answer(buf, port.opt);
      if (!reply || !rinfo) return;
      try { s.send(reply, rinfo.port, rinfo.address); } catch { /* düştü */ }
    });
    const options = port.number === 0
      ? { port: 0, exclusive: true }
      : { port: 5353, address: '0.0.0.0', exclusive: false };
    try {
      s.bind(options, () => {
        /* Zaman aşımı veya yeni bir start bu soketi çoktan bıraktıysa
           dinlemede tutma. Paylaşılan 5353'te bu, birikmenin kaynağıydı. */
        if (done || mine !== epoch) {
          done = true;
          clearTimeout(giveUp);
          closeSocket(s);
          resolve(false);
          return;
        }
        done = true;
        clearTimeout(giveUp);
        onUp(s);
        resolve(true);
      });
    } catch { finish(false); }
  });
}

function startMdns(opt, mine) {
  return bindMdns({ number: 5353, opt }, mine, (s) => {
    listening = true;
    try { s.addMembership('224.0.0.251'); } catch { /* üyelik reddi duyuruyu düşürmez */ }
    armAnnounce(s, opt);
  }).then((bound) => {
    if (bound) return { bound: true, announce: true };
    if (mine !== epoch) return { bound: false, announce: false };
    listening = false;
    return bindMdns({ number: 0, opt }, mine, (s) => {
      armAnnounce(s, opt);
    }).then((ok) => ({ bound: false, announce: ok }));
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
      host: '127.0.0.1', port, path: '/?HOST_INFO', timeout: 400, agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = null; }
        resolve(res.statusCode === 200 && !!(json && json.NAME === 'SoundVisualizer' && json.X_SV_INSTANCE === INSTANCE));
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function closeHttp(httpServer) {
  return new Promise((resolve) => {
    if (!httpServer) { resolve(); return; }
    try {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
      httpServer.close(() => resolve());
    } catch { resolve(); }
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
        if (body && body.NAME === 'SoundVisualizer') body = Object.assign({ X_SV_INSTANCE: INSTANCE }, body);
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
        if (settled) {
          closeHttp(httpServer);
          return;
        }
        settled = true;
        const addr = httpServer.address();
        resolve({ ok: true, server: httpServer, port: addr && addr.port });
      });
    } catch (err) {
      fail(err.code || err.message);
    }
  });
}

async function boot(o, mine) {
  const requested = Math.max(1, Math.min(65535, o.port | 0 || tree.DEFAULT_QUERY_PORT));
  let lastError = 'EADDRINUSE';
  for (const candidate of queryCandidates(requested)) {
    if (mine !== epoch) return status();
    const opened = await openQuery(o, candidate);
    if (mine !== epoch) {
      if (opened.ok) await closeHttp(opened.server);
      return status();
    }
    if (!opened.ok) {
      lastError = opened.error || lastError;
      continue;
    }
    const ours = await localhostIsOurs(opened.port);
    if (mine !== epoch || !ours) {
      await closeHttp(opened.server);
      if (mine !== epoch) return status();
      lastError = 'shadowed';
      continue;
    }
    server = opened.server;
    const mdnsOpt = {
      port: opened.port, ip: o.ip || lanIPv4(), name: 'SoundVisualizer', host: 'soundvisualizer',
    };
    const mdnsState = await startMdns(mdnsOpt, mine);
    if (mine !== epoch) {
      await halt();
      return status();
    }
    const st = status();
    st.port = opened.port;
    st.mdns = !!(mdnsState && mdnsState.bound);
    st.mdnsAnnounce = !!(mdnsState && mdnsState.announce);
    st.requestedPort = requested;
    st.moved = opened.port !== requested;
    return st;
  }
  return { running: false, port: 0, mdns: false, mdnsAnnounce: false, error: lastError, requestedPort: requested, moved: false };
}

function start(opts) {
  const mine = ++epoch;
  const job = tail.then(() => halt()).then(() => (mine === epoch ? boot(opts || {}, mine) : status()));
  tail = job.then(() => {}, () => {});
  return job;
}

function socketCount() {
  return mdnsSockets.size;
}

module.exports = { start, stop, status, lanIPv4, chooseLanIPv4, queryCandidates, socketCount };
