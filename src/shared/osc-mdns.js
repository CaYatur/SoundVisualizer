/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OSCQuery duyurusu: DNS-SD `_oscjson._tcp.local`.

   Paket kurma saf. Soket ana süreçte açılır. 5353 meşgulse duyuru
   yine de kısa ömürlü bir soketten multicast adresine gider; sorguya
   cevap verilemezse durum bunu söyler. */

const SERVICE = '_oscjson._tcp.local';

function encodeName(name) {
  const labels = String(name || '').replace(/\.$/, '').split('.').filter(Boolean);
  const parts = [];
  for (const label of labels) {
    const b = Buffer.from(label, 'utf8');
    if (b.length < 1 || b.length > 63) return null;
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function readName(buf, pos, depth) {
  if (!buf || (depth || 0) > 8 || pos < 0 || pos >= buf.length) return null;
  const labels = [];
  let jumped = false;
  let end = pos;
  for (let n = 0; n < 40; n++) {
    if (pos >= buf.length) return null;
    const len = buf[pos];
    if (len === 0) {
      pos += 1;
      if (!jumped) end = pos;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) return null;
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) end = pos + 2;
      jumped = true;
      pos = ptr;
      continue;
    }
    if ((len & 0xc0) !== 0 || pos + 1 + len > buf.length) return null;
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
    if (!jumped) end = pos;
  }
  return { name: labels.join('.'), next: end };
}

function questions(buf) {
  if (!buf || buf.length < 12) return [];
  const count = buf.readUInt16BE(4);
  let pos = 12;
  const out = [];
  for (let i = 0; i < count && i < 8; i++) {
    const name = readName(buf, pos, 0);
    if (!name || name.next + 4 > buf.length) break;
    out.push({
      name: name.name.toLowerCase(),
      type: buf.readUInt16BE(name.next),
      cls: buf.readUInt16BE(name.next + 2) & 0x7fff,
    });
    pos = name.next + 4;
  }
  return out;
}

function instanceName(opt) {
  const raw = (opt && opt.name) || 'SoundVisualizer';
  const safe = String(raw).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'SoundVisualizer';
  return safe + '.' + SERVICE;
}

function record(name, type, ttl, rdata) {
  const n = encodeName(name);
  if (!n || !rdata) return null;
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt32BE(ttl >>> 0, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([n, head, rdata]);
}

function ptrRdata(target) {
  return encodeName(target);
}

function srvRdata(port, host) {
  const name = encodeName(host);
  if (!name) return null;
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(0, 2);
  head.writeUInt16BE(port & 0xffff, 4);
  return Buffer.concat([head, name]);
}

function txtRdata() {
  const text = Buffer.from('txtvers=1', 'ascii');
  return Buffer.concat([Buffer.from([text.length]), text]);
}

function ipv4Parts(ip) {
  const bits = String(ip || '').split('.');
  if (bits.length !== 4) return null;
  const nums = bits.map((b) => Number(b));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return Buffer.from(nums);
}

/* Sorgu bu hizmeti soruyorsa cevap. Başka sorulara sessiz. */
function answer(query, opt) {
  const qs = questions(query);
  const want = qs.some((q) => q.name === SERVICE || q.name.endsWith('.' + SERVICE));
  if (!want) return null;
  const id = query.readUInt16BE(0);
  return announce(Object.assign({}, opt, { id }));
}

function announce(opt) {
  const port = (opt && opt.port) | 0;
  const ip = ipv4Parts(opt && opt.ip) ? opt.ip : '127.0.0.1';
  const host = ((opt && opt.host) || 'soundvisualizer') + '.local';
  const inst = instanceName(opt);
  const records = [
    record(SERVICE, 12, 120, ptrRdata(inst)),
    record(inst, 33, 120, srvRdata(port, host)),
    record(inst, 16, 120, txtRdata()),
    record(host, 1, 120, ipv4Parts(ip)),
  ].filter(Boolean);
  const header = Buffer.alloc(12);
  header.writeUInt16BE((opt && opt.id) || 0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(records.length, 6);
  return Buffer.concat([header].concat(records));
}

module.exports = { SERVICE, encodeName, readName, questions, answer, announce, instanceName };
