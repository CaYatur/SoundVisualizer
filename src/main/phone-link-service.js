/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAĞLANTISI HİZMETİ (#1054, docs/PHONE-LINK.md). Çekirdeği (phone-link.js) yayın
   sunucusunun `/link` istemcilerine bağlar: kalıcı kimlik ve cihaz deposu, el sıkışma,
   şifreli istek/yanıt, izin denetimi, panel durumu. Electron'a bağlı değil: depo, koruma
   (safeStorage), saat ve işlemler dışarıdan verilir, Node'da sınanır.

   Oturumdaki iletiler (şifreli, JSON):
     telefon → { id, op, args }            istek
     PC → { re: id, ok: true, result }     yanıt   | { re: id, ok: false, error }
     PC → { ev, ... }                      olay (durum değişti, canlı özet …)
   `op` izin tablosundan geçer (phone-link.js OPS). Bilinmeyen ya da izinsiz işlem yanıtı
   `not-allowed`; işleyicisi olmayan izinli işlem `unsupported` (sonraki aşamalarda eklenir). */
const Link = require('./phone-link');

const RATE_PER_SEC = 120;
const MAX_ID = 64;

function createService(deps) {
  const d = deps || {};
  const now = d.now || Date.now;
  const stream = d.stream; // { linkSendText, linkSendBinary, dropClient }
  const notify = typeof d.notify === 'function' ? d.notify : () => {};
  const ops = Object.assign({}, d.ops || {});
  let host = null;
  let enabled = false;
  const pending = new Map(); // bağlantı no → { conn, client, digits, name, model, at }
  let seq = 0;
  let keyed = []; // anahtarlı son cihaz listesi: depoya bu yazılır

  function load() {
    const saved = (d.store && d.store.read()) || {};
    const unseal = (s) => { try { return d.protect ? d.protect.unseal(s) : Buffer.from(String(s || ''), 'base64'); } catch { return null; } };
    let identity = null;
    if (saved.identity && saved.identity.priv && saved.identity.pub) {
      const priv = unseal(saved.identity.priv);
      const pub = Buffer.from(String(saved.identity.pub), 'base64');
      if (priv && priv.length === 32 && Link.validPublicKey(pub)) identity = { priv, pub };
    }
    const devices = (Array.isArray(saved.devices) ? saved.devices : []).map((x) => Object.assign({}, x, { key: unseal(x.key) })).filter((x) => x.key && x.key.length === 32);
    keyed = devices;
    host = Link.createHost({
      identity, devices, now, pcName: d.pcName ? d.pcName() : 'PC',
      randomBytes: d.randomBytes,
      onChange: (list) => { keyed = list; save(); notify('phonelink-state', status()); },
      onEvent,
    });
    if (!identity) save();
  }
  function save() {
    if (!d.store) return;
    const seal = (buf) => (d.protect ? d.protect.seal(buf) : Buffer.from(buf).toString('base64'));
    const devices = keyed.filter((x) => x.key).map((x) => ({ id: x.id, name: x.name, model: x.model, level: x.level, pairedAt: x.pairedAt, lastSeen: x.lastSeen, key: seal(x.key) }));
    d.store.write({ v: 1, identity: { priv: seal(host.identity.priv), pub: host.identity.pub.toString('base64') }, devices });
  }

  function onEvent(ev) {
    if (ev.type === 'sas') {
      const no = ++seq;
      ev.conn.no = no;
      pending.set(no, { conn: ev.conn, digits: ev.digits, name: ev.name, model: ev.model, via: ev.via || 'code', at: now() });
      notify('phonelink-sas', { no, digits: ev.digits, name: ev.name, model: ev.model, via: ev.via || 'code' });
      notify('phonelink-state', status());
    } else if (ev.type === 'paired' || ev.type === 'session' || ev.type === 'closed' || ev.type === 'code-burned') {
      if (ev.type === 'closed' && ev.conn.no) pending.delete(ev.conn.no);
      notify('phonelink-state', status());
    }
  }

  // ---- Yayın sunucusunun kancaları
  function onOpen(client) {
    if (!enabled || !host) { stream.dropClient(client); return; }
    client.link = host.connection({ address: client.address });
    client.link.client = client;
    client.rate = { t: now(), n: 0 };
    // Oturumdan önce yayın sunucusu yalnız küçük, parçasız metin kareleri kabul eder
    client.preAuth = true;
    // Boşta bekleyen el sıkışma yer tutmasın: süresi dolunca düşer (onay bekleyen daha uzun)
    client.linkTimer = setInterval(() => {
      if (client.link && host.expired(client.link)) stream.dropClient(client);
    }, 1000);
    if (client.linkTimer.unref) client.linkTimer.unref();
    stream.linkSendText(client, JSON.stringify(host.hello()));
  }
  function onText(client, text) {
    const c = client.link;
    if (!c) return;
    const out = c.handle(text);
    for (const m of out) stream.linkSendText(client, JSON.stringify(m));
    if (c.stage === 'session') client.preAuth = false;
    if (c.stage === 'failed') setTimeout(() => stream.dropClient(client), 50);
  }
  async function onBinary(client, frame) {
    const c = client.link;
    if (!c || c.stage !== 'session') return;
    const t = now();
    if (t - client.rate.t >= 1000) { client.rate.t = t; client.rate.n = 0; }
    if (++client.rate.n > RATE_PER_SEC) return;
    const msg = c.decrypt(frame);
    if (!msg || typeof msg !== 'object') return;
    const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? String(msg.id).slice(0, MAX_ID) : null;
    const reply = (obj) => { if (id !== null && c.stage === 'session' && !c.closed) stream.linkSendBinary(client, c.encrypt(Object.assign({ re: id }, obj))); };
    const op = typeof msg.op === 'string' ? msg.op : '';
    const level = c.device ? c.device.level : 'view';
    if (!Link.allowed(level, op)) { reply({ ok: false, error: 'not-allowed' }); return; }
    const fn = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : null;
    if (!fn) { reply({ ok: false, error: 'unsupported' }); return; }
    try {
      const result = await fn(msg.args && typeof msg.args === 'object' ? msg.args : {}, { device: Object.assign({}, c.device, { key: undefined }), client });
      reply({ ok: true, result: result === undefined ? null : result });
    } catch (e) {
      reply({ ok: false, error: (e && e.code) || 'failed' });
    }
  }
  function onClose(client) {
    if (client.linkTimer) { clearInterval(client.linkTimer); client.linkTimer = null; }
    if (client.link) client.link.close();
    client.link = null;
  }

  // ---- Panel
  function setEnabled(on) {
    enabled = !!on;
    if (enabled && !host) load();
    if (!enabled && host) {
      host.closePairing();
      for (const c of host.connections()) if (c.client) stream.dropClient(c.client);
      pending.clear();
    }
    notify('phonelink-state', status());
  }
  function newCode() { if (!host) load(); host.openPairing(); notify('phonelink-state', status()); return status(); }
  function confirm(no, ok) {
    const p = pending.get(no);
    if (!p) return false;
    pending.delete(no);
    const out = p.conn.confirm(!!ok);
    const client = p.conn.client;
    for (const m of out) stream.linkSendText(client, JSON.stringify(m));
    if (p.conn.stage === 'session') client.preAuth = false;
    if (p.conn.stage === 'failed') setTimeout(() => stream.dropClient(client), 50);
    notify('phonelink-state', status());
    return p.conn.stage === 'session';
  }
  function dropConns(list) { for (const c of list) if (c.client) stream.dropClient(c.client); }
  function forget(id) { if (!host) return; dropConns(host.forget(String(id))); notify('phonelink-state', status()); }
  function forgetAll() { if (!host) return; dropConns(host.forgetAll()); notify('phonelink-state', status()); }
  function setLevel(id, level) { return host ? host.setLevel(String(id), String(level)) : false; }
  function disconnect(id) {
    if (!host) return;
    dropConns(host.connections().filter((c) => c.device && c.device.id === id));
  }
  /** Bağlı bütün telefonlara olay (izle düzeyi ve üstü). */
  function broadcast(ev) {
    if (!host) return;
    for (const c of host.connections()) if (c.stage === 'session' && c.client) stream.linkSendBinary(c.client, c.encrypt(ev));
  }

  function status(extra) {
    // Kapalıyken de eşleşmiş cihazlar listelensin: depo varsa yükle (yoksa dosya yazılmaz)
    if (!host && d.store && d.store.read()) load();
    const p = host ? host.pairingInfo() : null;
    const hosts = d.addresses ? d.addresses() : [];
    const port = d.port ? d.port() : 0;
    return Object.assign({
      enabled,
      running: d.running ? !!d.running() : enabled,
      pcId: host ? host.pcId : '',
      pairing: p ? { code: p.code, expiresAt: p.expiresAt, qr: host.qrPayload(hosts, port) } : null,
      addresses: hosts, port,
      devices: host ? host.devices() : [],
      pending: Array.from(pending.entries()).map(([no, x]) => ({ no, digits: x.digits, name: x.name, model: x.model, via: x.via })),
    }, extra || {});
  }

  return {
    hooks: { onLinkOpen: onOpen, onLinkText: onText, onLinkBinary: onBinary, onLinkClose: onClose },
    setEnabled, newCode, confirm, forget, forgetAll, setLevel, disconnect, broadcast, status,
    setOp: (name, fn) => { ops[name] = fn; },
    isEnabled: () => enabled,
    pcId: () => (host ? host.pcId : ''),
  };
}

module.exports = { createService };
