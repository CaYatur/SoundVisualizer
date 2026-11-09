/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Belgeli HTTP API (OpenAPI 3.0).

   MCP'nin yerel sunucusuna eklenen düz REST yolları. Ayrı bir port, ayrı
   bir jeton ya da ayrı bir izin yok:
   - yalnız 127.0.0.1'de, MCP açıkken ve mcp.httpApi açıkken çalışır
     (varsayılan kapalı);
   - her araç çağrısı mcp.callTool'dan geçer, yani MCP kipi (okuma /
     düzenleme / tam) aynen uygulanır;
   - jeton MCP'ninkidir (Authorization: Bearer ...), her açılışta yenilenir.

   Tarayıcıdan gelen istekler (Origin başlığı) ve yabancı Host başlığı
   (DNS yeniden bağlama) reddedilir. CORS başlığı hiç yollanmaz.

   Yollar:
     GET  /api/v1/openapi.json   belge (jeton istemez)
     GET  /api/v1/tools          araç listesi
     POST /api/v1/tools/{name}   aracı çağırır, gövde = araç argümanları */

const PREFIX = '/api/v1';
const MAX_BODY = 1024 * 1024;

function isApiPath(url) {
  const p = String(url || '').split('?')[0];
  return p === PREFIX || p.indexOf(PREFIX + '/') === 0;
}

/* Host başlığı yalnız loopback adı ve bizim port olabilir. */
function hostAllowed(host, port) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  return h === '127.0.0.1:' + port || h === 'localhost:' + port || h === '[::1]:' + port;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/* Araç adından OpenAPI operationId: sv_set_layer → sv_set_layer (zaten
   güvenli); şema MCP'nin inputSchema'sıdır. */
function openapi(mcp, opts) {
  const o = opts || {};
  const tools = mcp.tools(o.locale || 'en', 'full');
  const paths = {};
  paths[PREFIX + '/tools'] = {
    get: {
      operationId: 'listTools',
      summary: 'List every tool with its JSON input schema.',
      responses: { 200: { description: 'Tool list', content: { 'application/json': { schema: { type: 'object' } } } }, 401: { description: 'Missing or wrong token' } },
    },
  };
  tools.forEach(function (t) {
    paths[PREFIX + '/tools/' + t.name] = {
      post: {
        operationId: t.name,
        summary: String(t.description || '').split(/(?<=[.!?])\s/)[0].slice(0, 200),
        description: t.description,
        requestBody: { required: false, content: { 'application/json': { schema: t.inputSchema || { type: 'object' } } } },
        responses: {
          200: { description: 'Tool result (ok is not false)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } },
          400: { description: 'Tool refused the call (ok:false, see error); also bad JSON', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } },
          401: { description: 'Missing or wrong token' },
        },
      },
    };
  });
  return {
    openapi: '3.0.3',
    info: {
      title: 'SoundVisualizer HTTP API',
      version: o.version || '0.0.0',
      description: 'Loopback-only REST mirror of the MCP tools. Every call uses the same permission mode as MCP (read, edit, full). '
        + 'The bearer token is in mcp-endpoint.json in the app data folder and changes each time MCP starts.',
    },
    servers: [{ url: 'http://127.0.0.1:' + (o.port || 38471) }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Result: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, additionalProperties: true },
      },
    },
    paths: paths,
  };
}

/* İstek işlenirse true döner; /api dışı yollarda false (çağıran devam eder).
   deps: { mcp, ctx(), token(), port(), enabled(), version, locale(), after() } */
function handle(req, res, deps) {
  if (!isApiPath(req.url)) return false;
  if (!deps.enabled()) { res.writeHead(404); res.end(); return true; }
  const hdr = req.headers || {};
  if (!hostAllowed(hdr.host, deps.port())) { sendJson(res, 403, { ok: false, error: 'bad host' }); return true; }
  // Tarayıcı sayfaları Origin yollar; bu API tarayıcı için değil
  if (hdr.origin) { sendJson(res, 403, { ok: false, error: 'browser requests are not allowed' }); return true; }
  const p = String(req.url).split('?')[0];
  const loc = deps.locale ? deps.locale() : 'en';
  if (req.method === 'GET' && p === PREFIX + '/openapi.json') {
    sendJson(res, 200, openapi(deps.mcp, { locale: loc, version: deps.version, port: deps.port() }));
    return true;
  }
  const tok = deps.token();
  if (!tok || String(hdr.authorization || '') !== 'Bearer ' + tok) { sendJson(res, 401, { ok: false, error: 'unauthorized' }); return true; }
  if (req.method === 'GET' && p === PREFIX + '/tools') {
    sendJson(res, 200, { ok: true, tools: deps.mcp.tools(loc, 'full') });
    return true;
  }
  const m = /^\/api\/v1\/tools\/([A-Za-z0-9_]{1,64})$/.exec(p);
  if (!m) { sendJson(res, 404, { ok: false, error: 'not found' }); return true; }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return true; }
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; return; }
    chunks.push(c);
  });
  req.on('end', function () {
    if (tooBig) { sendJson(res, 413, { ok: false, error: 'body too large' }); return; }
    let args = {};
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (raw) {
      try { args = JSON.parse(raw); } catch (e) { sendJson(res, 400, { ok: false, error: 'bad json' }); return; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) { sendJson(res, 400, { ok: false, error: 'body must be a JSON object' }); return; }
    const done = function (out) {
      try { if (deps.after) deps.after(); } catch (e) { /* yok */ }
      const val = out || { ok: false, error: 'no result' };
      sendJson(res, val.ok === false ? 400 : 200, val);
    };
    Promise.resolve()
      .then(function () { return deps.mcp.callTool(m[1], args, deps.ctx()); })
      .then(done, function (e) { done({ ok: false, error: String((e && e.message) || e) }); });
  });
  return true;
}

module.exports = { PREFIX, MAX_BODY, isApiPath, hostAllowed, openapi, handle };
