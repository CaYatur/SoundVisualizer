/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
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

function writeMessage(obj, frame) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  if (frame === 'line') {
    process.stdout.write(body);
    process.stdout.write('\n');
    return;
  }
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
}

function fail(id, message, frame) {
  writeMessage({ jsonrpc: '2.0', id: id == null ? null : id, error: { code: -32000, message: message } }, frame);
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

  function onMessage(msg, frame) {
    let endpoint;
    try { endpoint = ensure(); }
    catch (e) {
      if (msg && msg.id != null) {
        fail(msg.id, 'SoundVisualizer MCP is not running. Enable MCP on the Control card and keep the app open.', frame);
      }
      return;
    }
    rpc(endpoint, msg).then((res) => {
      if (res && msg && msg.id != null) writeMessage(res, frame);
    }).catch(() => {
      if (msg && msg.id != null) {
        fail(msg.id, 'SoundVisualizer MCP is not reachable on 127.0.0.1. Enable MCP and keep the app open.', frame);
      }
    });
  }

  function headerSplit(buffer) {
    const crlf = buffer.indexOf('\r\n\r\n');
    const lf = buffer.indexOf('\n\n');
    if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { at: crlf, sep: 4 };
    if (lf >= 0) return { at: lf, sep: 2 };
    return null;
  }

  function pump() {
    while (buf.length) {
      const header = buf.indexOf('\r\n\r\n') === 0 || buf.indexOf('\n\n') === 0
        ? null
        : headerSplit(buf);
      const looksLikeHeader = header && /^content-length:/i.test(buf.slice(0, header.at).toString('utf8').trim());
      if (looksLikeHeader) {
        const text = buf.slice(0, header.at).toString('utf8');
        const m = text.match(/Content-Length:\s*(\d+)/i);
        if (!m) { buf = buf.slice(header.at + header.sep); continue; }
        const len = Number(m[1]);
        const start = header.at + header.sep;
        if (buf.length < start + len) return;
        const body = buf.slice(start, start + len).toString('utf8');
        buf = buf.slice(start + len);
        try { onMessage(JSON.parse(body), 'content-length'); } catch (e) { /* ignore malformed */ }
        continue;
      }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl).toString('utf8').trim();
      buf = buf.slice(nl + 1);
      if (!line || line[0] !== '{') continue;
      try { onMessage(JSON.parse(line), 'line'); } catch (e) { /* ignore */ }
    }
  }

  process.stdin.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); pump(); });
}

if (require.main === module) main();
else module.exports = { isLoopbackHost, endpointFrom };

