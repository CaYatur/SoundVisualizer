/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Bağımlılıksız küçük OSC 1.0 kodlayıcı/çözücü (i, f, s, T, F). Companion
   modülü ile SoundVisualizer'ın testleri aynı dosyayı kullanır. */

function pad4(n) { return (n + 3) & ~3; }

function str(s) {
  const raw = Buffer.from(String(s), 'utf8');
  const out = Buffer.alloc(pad4(raw.length + 1));
  raw.copy(out);
  return out;
}

/* args: [{type:'i'|'f'|'s'|'T'|'F', value}] */
function encode(address, args) {
  const list = Array.isArray(args) ? args : [];
  let tags = ',';
  const parts = [];
  for (const a of list) {
    if (a.type === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(Math.trunc(Number(a.value)) | 0); parts.push(b); tags += 'i'; }
    else if (a.type === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(Number(a.value) || 0); parts.push(b); tags += 'f'; }
    else if (a.type === 's') { parts.push(str(a.value)); tags += 's'; }
    else if (a.type === 'T' || a.type === 'F') { tags += a.type; }
  }
  return Buffer.concat([str(address), str(tags)].concat(parts));
}

function readStr(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  return { value: buf.toString('utf8', off, end), next: pad4(end + 1) };
}

/* Tek mesaj ya da #bundle; mesaj listesi döner. Bozuk paket: boş liste. */
function decode(buf, depth) {
  const out = [];
  if (!Buffer.isBuffer(buf) || buf.length < 4 || (depth || 0) > 4) return out;
  try {
    const head = readStr(buf, 0);
    if (!head) return out;
    if (head.value === '#bundle') {
      let off = 16;
      while (off + 4 <= buf.length) {
        const n = buf.readInt32BE(off);
        off += 4;
        if (n <= 0 || off + n > buf.length) break;
        out.push(...decode(buf.subarray(off, off + n), (depth || 0) + 1));
        off += n;
      }
      return out;
    }
    const tags = readStr(buf, head.next);
    if (!tags || tags.value[0] !== ',') return [{ address: head.value, args: [] }];
    let off = tags.next;
    const args = [];
    for (const t of tags.value.slice(1)) {
      if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
      else if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
      else if (t === 's') { const s = readStr(buf, off); if (!s) break; args.push(s.value); off = s.next; }
      else if (t === 'T') args.push(true);
      else if (t === 'F') args.push(false);
      else break;
    }
    out.push({ address: head.value, args });
  } catch (e) { return out; }
  return out;
}

module.exports = { encode, decode };
