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

function lanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function status() {
  const addr = server && server.listening ? server.address() : null;
  return {
    running: !!(server && server.listening),
    port: addr ? addr.port : 0,
    mdns: listening,
    error: null,
  };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  listening = false;
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

function startMdns(opt) {
  return new Promise((resolve) => {
    let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); }
    catch { resolve(false); return; }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(giveUp);
      listening = ok;
      resolve(ok);
    };
    const giveUp = setTimeout(() => finish(false), 1500);
    s.on('error', () => {
      try { s.close(); } catch { /* kapalı */ }
      if (socket === s) socket = null;
      listening = false;
      finish(false);
    });
    s.on('message', (buf, rinfo) => {
      const reply = mdns.answer(buf, opt);
      if (!reply || !rinfo) return;
      try { s.send(reply, rinfo.port, rinfo.address); } catch { /* düştü */ }
    });
    s.bind(5353, () => {
      socket = s;
      try { s.addMembership('224.0.0.251'); } catch { /* üyelik reddi duyuruyu düşürmez */ }
      announceNow(opt);
      timer = setInterval(() => announceNow(opt), 60000);
      if (timer.unref) timer.unref();
      finish(true);
    });
  });
}

function start(opts) {
  const o = opts || {};
  const port = Math.max(1, Math.min(65535, o.port | 0 || 9010));
  return stop().then(() => new Promise((resolve) => {
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
    server = httpServer;
    httpServer.once('error', (err) => {
      resolve({ running: false, port: 0, mdns: false, error: err.code || err.message });
    });
    httpServer.listen(port, '0.0.0.0', () => {
      const addr = httpServer.address();
      const mdnsOpt = { port: addr.port, ip: o.ip || lanIPv4(), name: 'SoundVisualizer', host: 'soundvisualizer' };
      startMdns(mdnsOpt).then((ok) => {
        const st = status();
        st.mdns = ok;
        resolve(st);
      });
    });
  }));
}

module.exports = { start, stop, status, lanIPv4 };
