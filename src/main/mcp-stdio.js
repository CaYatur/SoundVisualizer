'use strict';
/* Stdio MCP bridge. Clients spawn this file. It speaks MCP on stdin/stdout
   and forwards JSON-RPC to the app, which listens on 127.0.0.1 only. */
const http = require('http');
const fs = require('fs');
const path = require('path');

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function endpointFrom(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || !isLoopbackHost(data.host)) {
    throw new Error('Refusing non-loopback MCP endpoint');
  }
  const port = Number(data.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid MCP port');
  return { host: '127.0.0.1', port: port, token: data.token || '' };
}

function endpointPath() {
  const i = process.argv.indexOf('--endpoint');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return path.join(__dirname, 'mcp-endpoint.json');
}

function loadEndpoint() {
  return endpointFrom(fs.readFileSync(endpointPath(), 'utf8'));
}

function rpc(ep, msg) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(msg);
    const req = http.request({
      host: '127.0.0.1',
      port: ep.port,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: 'Bearer ' + ep.token,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve(null);
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
}

function fail(id, message) {
  writeMessage({ jsonrpc: '2.0', id: id == null ? null : id, error: { code: -32000, message: message } });
}

function main() {
  let buf = Buffer.alloc(0);
  let ep = null;
  try { ep = loadEndpoint(); }
  catch (e) {
    /* Endpoint is resolved per message so a late enable still works. */
  }

  function ensure() {
    if (ep) return ep;
    ep = loadEndpoint();
    return ep;
  }

  function onMessage(msg) {
    let endpoint;
    try { endpoint = ensure(); }
    catch (e) {
      if (msg && msg.id != null) {
        fail(msg.id, 'SoundVisualizer MCP is not running. Enable MCP on the Control card and keep the app open.');
      }
      return;
    }
    rpc(endpoint, msg).then((res) => {
      if (res && msg && msg.id != null) writeMessage(res);
    }).catch(() => {
      if (msg && msg.id != null) {
        fail(msg.id, 'SoundVisualizer MCP is not reachable on 127.0.0.1. Enable MCP and keep the app open.');
      }
    });
  }

  function pump() {
    while (buf.length) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        const header = buf.slice(0, headerEnd).toString('utf8');
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) { buf = buf.slice(headerEnd + 4); continue; }
        const len = Number(m[1]);
        const start = headerEnd + 4;
        if (buf.length < start + len) return;
        const body = buf.slice(start, start + len).toString('utf8');
        buf = buf.slice(start + len);
        try { onMessage(JSON.parse(body)); } catch (e) { /* ignore malformed */ }
        continue;
      }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl).toString('utf8').trim();
      buf = buf.slice(nl + 1);
      if (!line || line[0] !== '{') continue;
      try { onMessage(JSON.parse(line)); } catch (e) { /* ignore */ }
    }
  }

  process.stdin.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); pump(); });
}

if (require.main === module) main();
else module.exports = { isLoopbackHost, endpointFrom };

