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
      writeText: deps.writeText,
      writeBinary: deps.writeBinary,
      capturePreview: deps.capturePreview,
      recordStart: deps.recordStart,
      recordStop: deps.recordStop,
      timeline: deps.timeline,
      launchClip: deps.launchClip,
      locale: deps.locale,
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
        if (out == null) {
          res.writeHead(202);
          res.end();
          return;
        }
        const body = JSON.stringify(out);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      }).catch(function (e) {
        const body = JSON.stringify({ jsonrpc: '2.0', id: msg && msg.id, error: { code: -32603, message: String((e && e.message) || e) } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
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

module.exports = { BIND_HOST: BIND_HOST, DEFAULT_PORT: DEFAULT_PORT, assertLoopback: assertLoopback, create: create };
