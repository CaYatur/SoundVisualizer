/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Loopback MCP endpoint. Binds 127.0.0.1 only and only while mcp.enabled is on.
   Claude, Cursor, and Codex spawn src/main/mcp-stdio.js, which forwards here. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mcp = require('../shared/mcp');

const BIND_HOST = '127.0.0.1';
const DEFAULT_PORT = 38471;

function assertLoopback(host) {
  if (host !== BIND_HOST) {
    throw new Error('MCP transport refuses non-loopback host: ' + host);
  }
}

function isLoopbackAddress(addr) {
  return addr === '127.0.0.1' || addr === '::ffff:127.0.0.1' || addr === '::1';
}

function create(deps) {
  deps = deps || {};
  let server = null;
  let token = '';
  let port = 0;
  let portBusy = false;
  let busyPort = 0;
  let endpointFile = '';
  let revision = 0;

  function ctx() {
    return {
      getConfig: deps.getConfig,
      setConfig: function (cfg) {
        if (deps.setConfig) deps.setConfig(cfg);
      },
      noteWrite: function () { revision += 1; return revision; },
      revision: function () { return revision; },
      live: deps.live,
      nowPlaying: deps.nowPlaying,
      displays: deps.displays,
      outputStatus: deps.outputStatus,
      presets: deps.presets,
      openOutput: deps.openOutput,
      closeOutput: deps.closeOutput,
      setFloatingOpen: deps.setFloatingOpen,
      stopClips: deps.stopClips,
      startExport: deps.startExport,
      cancelExport: deps.cancelExport,
      outPathGuard: deps.outPathGuard,
      writeText: deps.writeText,
      writeBinary: deps.writeBinary,
      capturePreview: deps.capturePreview,
      recordStart: deps.recordStart,
      recordStop: deps.recordStop,
      timeline: deps.timeline,
      launchClip: deps.launchClip,
      locale: deps.locale,
      // OS the admin panel runs on; control.osc.port uses the same port floor
      platform: process.platform,
      /* Bu altısı eksikti: araçlar listede görünüyor ama uygulamada hep
         "kullanılamıyor" ya da boş dönüyordu (#695). */
      analysis: deps.analysis,
      diagnoseAudio: deps.diagnoseAudio,
      repairAudio: deps.repairAudio,
      newStreamToken: deps.newStreamToken,
      downloadUpdate: deps.downloadUpdate,
      installUpdate: deps.installUpdate,
    };
  }

  function scriptPath() {
    return path.join(deps.userData, 'mcp-stdio.js');
  }

  function status() {
    const script = scriptPath();
    const bundle = mcp.commandBundle(script);
    const cfg = deps.getConfig ? deps.getConfig() : null;
    return {
      enabled: !!(cfg && mcp.normalizeMcp(cfg.mcp).enabled),
      running: !!(server && server.listening),
      host: BIND_HOST,
      port: port || 0,
      script: script,
      command: bundle.command,
      args: bundle.args,
      shell: bundle.shell,
      url: bundle.url,
      configuredPort: configuredPort(),
      portBusy: portBusy,
      requestedPort: portBusy ? busyPort : (port || configuredPort()),
    };
  }

  function configuredPort() {
    const cfg = deps.getConfig ? deps.getConfig() : null;
    const raw = cfg && cfg.mcp ? Number(cfg.mcp.port) : DEFAULT_PORT;
    if (!Number.isInteger(raw) || raw < 1 || raw > 65535 || raw === 8722) return DEFAULT_PORT;
    return raw;
  }

  function writeEndpoint() {
    endpointFile = path.join(deps.userData, 'mcp-endpoint.json');
    fs.mkdirSync(deps.userData, { recursive: true });
    const bridge = fs.readFileSync(path.join(__dirname, 'mcp-stdio.js'));
    fs.writeFileSync(scriptPath(), bridge);
    fs.writeFileSync(endpointFile, JSON.stringify({ host: BIND_HOST, port: port, token: token }, null, 2));
    /* Uç nokta belirteci taşır. Linux ve macOS'ta dosya yalnız bu kullanıcı
       okusun; Windows chmod'u yok sayar, orada kullanıcı profili yeter. */
    if (process.platform !== 'win32') {
      try { fs.chmodSync(scriptPath(), 0o600); } catch (e) { /* yok */ }
      try { fs.chmodSync(endpointFile, 0o600); } catch (e) { /* yok */ }
    }
  }

  function clearEndpoint() {
    if (!deps.userData) return;
    for (const name of ['mcp-endpoint.json']) {
      try { fs.unlinkSync(path.join(deps.userData, name)); } catch (e) { /* already gone */ }
    }
  }

  function onRequest(req, res) {
    const remote = req.socket && req.socket.remoteAddress;
    if (!isLoopbackAddress(remote)) {
      res.writeHead(403);
      res.end('loopback only');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }
    const auth = String(req.headers.authorization || '');
    if (auth !== 'Bearer ' + token) {
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      let msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (e) {
        res.writeHead(400);
        res.end('bad json');
        return;
      }
      Promise.resolve(mcp.handleRpc(msg, ctx())).then(function (out) {
        try { if (deps.syncPresets) deps.syncPresets(); } catch (e) { /* klasör okunamadı */ }
        if (out == null) {
          res.writeHead(202);
          res.end();
          return;
        }
        const body = JSON.stringify(out);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      }).catch(function (e) {
        try { if (deps.syncPresets) deps.syncPresets(); } catch (err) { /* klasör okunamadı */ }
        const body = JSON.stringify({ jsonrpc: '2.0', id: msg && msg.id, error: { code: -32603, message: String((e && e.message) || e) } });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
      });
    });
  }

  function start(opts) {
    const host = (opts && opts.host) || BIND_HOST;
    assertLoopback(host);
    if (host !== BIND_HOST) throw new Error('MCP listens on 127.0.0.1 only');
    const want = (opts && Number.isInteger(Number(opts.port)) && Number(opts.port) > 0) ? Number(opts.port) : configuredPort();
    if (want === 8722) return Promise.reject(new Error('MCP will not use the stream port 8722'));
    if (server && server.listening && port === want) return Promise.resolve(status());
    const begin = function () {
      token = crypto.randomBytes(24).toString('hex');
      server = http.createServer(onRequest);
      portBusy = false;
      busyPort = 0;
      return new Promise(function (resolve, reject) {
        server.once('error', function (err) {
          server = null;
          port = 0;
          if (err && err.code === 'EADDRINUSE') {
            portBusy = true;
            busyPort = want;
            try { clearEndpoint(); } catch (e) { /* ignore */ }
            resolve(status());
            return;
          }
          reject(err);
        });
        server.listen(want, BIND_HOST, function () {
          const addr = server.address();
          if (!addr || (addr.address !== BIND_HOST && addr.address !== '::ffff:127.0.0.1') || addr.port !== want) {
            try { server.close(); } catch (e) { /* ignore */ }
            server = null;
            port = 0;
            portBusy = true;
            busyPort = want;
            resolve(status());
            return;
          }
          port = addr.port;
          portBusy = false;
          try { writeEndpoint(); } catch (e) { reject(e); return; }
          resolve(status());
        });
      });
    };
    if (server) return stop().then(begin);
    return begin();
  }

  function stop() {
    clearEndpoint();
    port = 0;
    token = '';
    if (!server) return Promise.resolve(status());
    const closing = server;
    server = null;
    return new Promise(function (resolve) {
      closing.close(function () { resolve(status()); });
    });
  }

  function sync(enabled) {
    if (enabled) return start();
    return stop();
  }

  return { start: start, stop: stop, sync: sync, status: status };
}

/* Dosya yazan MCP araçlarının hedefi (dışa aktarma, kare, video).
   Uygulamanın kendi klasörlerine (ayarlar, kurulum) yazılmaz; var olan bir
   dosyanın üstüne ancak açıkça `overwrite:true` ile yazılır. Eskiden
   herhangi bir mutlak .json yolunun üstüne yazılabiliyordu, settings.json
   dahil. Boş dönüş = yazılabilir. */
/* Gerçek yol: sembolik bağlantı ve kavşaklar çözülür. Hedef henüz yoksa
   var olan en yakın üst klasör çözülüp kalan parçalar eklenir. Eskiden
   yalnız path.resolve vardı: /tmp/link → userData bağlantısıyla uygulamanın
   kendi settings.json'unun üstüne yazılabiliyordu. */
function realish(p, P) {
  const start = P.resolve(String(p));
  const rest = [];
  let cur = start;
  for (;;) {
    try {
      const r = fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur);
      return rest.length ? P.join.apply(P, [r].concat(rest.slice().reverse())) : r;
    } catch (e) { /* yok ya da okunamıyor: bir üste */ }
    const parent = P.dirname(cur);
    if (parent === cur) return start;
    rest.push(P.basename(cur));
    cur = parent;
  }
}

function outPathGuard(file, overwrite, protectedDirs, platform) {
  const win = (platform || process.platform) === 'win32';
  const P = win ? path.win32 : path.posix;
  const sameHost = win === (process.platform === 'win32');
  const norm = function (p) {
    const r = sameHost ? realish(p, P) : P.resolve(String(p));
    return win ? r.toLowerCase() : r;
  };
  const target = norm(file);
  for (const dir of protectedDirs || []) {
    if (!dir) continue;
    const d = norm(dir);
    if (target === d || target.indexOf(d.endsWith(P.sep) ? d : d + P.sep) === 0) return "path is inside the app's own folder. Choose another folder.";
  }
  let st = null;
  try { st = fs.statSync(file); } catch (e) { st = null; }
  if (st && st.isDirectory()) return 'path is a folder.';
  if (st && !overwrite) return 'File already exists. Pass overwrite:true to replace it.';
  /* Sabit bağlantı (hardlink) gerçek yolla ayırt edilemiyor: settings.json'a
     klasör dışından açılmış bir bağlantı üzerine yazmak ayarı ezerdi. Başka
     adı da olan bir dosyanın üzerine yazılmaz. */
  if (st && st.nlink > 1) return 'File has other hard links, so replacing it would change another file too. Choose a new file name.';
  return '';
}

module.exports = { BIND_HOST: BIND_HOST, DEFAULT_PORT: DEFAULT_PORT, assertLoopback: assertLoopback, create: create, outPathGuard: outPathGuard };
