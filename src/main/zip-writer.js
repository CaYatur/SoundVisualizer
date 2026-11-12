/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ZIP YAZICI — tam yedek için, bağımlılıksız. Okuyucusu zip-reader.js.

   Videolar gigabayt olabilir: dosya girdileri belleğe alınmadan, parça
   parça ve SAKLANMIŞ (sıkıştırmasız; video zaten sıkışık) yazılır. CRC
   yazarken hesaplanır ve yerel başlığa sonradan, konumuyla yazılır (veri
   tanımlayıcısı gerekmez). Küçük girdiler (JSON) deflate ile.

   ZIP64: 4 GB'ı aşan girdi, 4 GB'tan sonra başlayan girdi ya da 65.535'ten
   fazla girdi (büyük MilkDrop kütüphanesi) için. Yalnız gereken alanlar
   0xFFFFFFFF olur ve ek alanda sırayla durur; okuyucu da böyle okuyor.

   Adlar UTF-8 (bayrak 0x800), ayırıcı "/", göreli; çağıran güvenli ad verir. */
const fs = require('fs');
const zlib = require('zlib');
const { crc32Update } = require('./zip-reader');

const MAX32 = 0xffffffff;
const COPY_CHUNK = 1024 * 1024;

function dosTime(d) {
  const t = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: t & 0xffff, date: day & 0xffff };
}

function zip64Extra(fields) {
  const b = Buffer.alloc(4 + fields.length * 8);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(fields.length * 8, 2);
  fields.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return b;
}

/* `opts.forceZip64`: testler 4 GB'lık dosya yazmadan ZIP64 yolunu sınasın. */
function createWriter(file, opts) {
  const o = opts || {};
  const force = !!o.forceZip64;
  const fd = fs.openSync(file, 'w');
  let pos = 0;
  const central = [];
  const names = new Set();
  const now = dosTime(new Date());
  let closed = false;

  function write(buf, at) {
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(fd, buf, off, buf.length - off, at == null ? pos + off : at + off);
      off += n;
    }
    if (at == null) pos += buf.length;
  }

  function checkName(name) {
    if (closed) throw new Error('CLOSED');
    if (typeof name !== 'string' || !name || name.length > 400 || /^\/|\\|(^|\/)\.\.(\/|$)/.test(name)) throw new Error('BAD_NAME');
    if (names.has(name)) throw new Error('DUPLICATE_NAME');
    names.add(name);
  }

  /* Yerel başlık. Boyutlar biliniyor; CRC sonradan yazılabilir (crcAt). */
  function localHeader(nameBuf, method, crc, comp, size, big) {
    const extra = big ? zip64Extra([size, comp]) : Buffer.alloc(0);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(big ? 45 : 20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(now.time, 10);
    h.writeUInt16LE(now.date, 12);
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(big ? MAX32 : comp, 18);
    h.writeUInt32LE(big ? MAX32 : size, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(extra.length, 28);
    return Buffer.concat([h, nameBuf, extra]);
  }

  function record(nameBuf, method, crc, comp, size, offset) {
    central.push({ nameBuf, method, crc: crc >>> 0, comp, size, offset });
  }

  /* Bellekteki veri; `deflate` false ise saklanmış. */
  function addBuffer(name, data, o2) {
    checkName(name);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const deflate = !(o2 && o2.deflate === false);
    const body = deflate ? zlib.deflateRawSync(buf, { level: 6 }) : buf;
    const method = deflate ? 8 : 0;
    const crc = crc32Update(buf, 0);
    const nameBuf = Buffer.from(name, 'utf8');
    const offset = pos;
    const big = force || buf.length >= MAX32 || body.length >= MAX32;
    write(localHeader(nameBuf, method, crc, body.length, buf.length, big));
    write(body);
    record(nameBuf, method, crc, body.length, buf.length, offset);
  }

  /* Diskteki dosya, akışla ve saklanmış. `onBytes(n)` ilerleme için. Dosya
     yazarken değişirse (boyut tutmazsa) hata: yarım girdi bırakılmaz. */
  async function addFile(name, src, o2) {
    checkName(name);
    const onBytes = o2 && typeof o2.onBytes === 'function' ? o2.onBytes : null;
    const st = await fs.promises.stat(src);
    if (!st.isFile()) throw new Error('NOT_FILE');
    const size = st.size;
    const nameBuf = Buffer.from(name, 'utf8');
    const offset = pos;
    const big = force || size >= MAX32;
    write(localHeader(nameBuf, 0, 0, size, size, big));
    const fh = await fs.promises.open(src, 'r');
    let crc = 0;
    let done = 0;
    try {
      const buf = Buffer.alloc(COPY_CHUNK);
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, buf.length, done);
        if (!bytesRead) break;
        const part = buf.subarray(0, bytesRead);
        crc = crc32Update(part, crc);
        write(part);
        done += bytesRead;
        if (onBytes) onBytes(bytesRead);
        if (done > size) break;
      }
    } finally {
      await fh.close();
    }
    if (done !== size) throw new Error('CHANGED');
    // CRC yerel başlıkta 14. baytta
    const c = Buffer.alloc(4);
    c.writeUInt32LE(crc >>> 0, 0);
    write(c, offset + 14);
    record(nameBuf, 0, crc, size, size, offset);
  }

  /* Merkezi dizin ve arşiv sonu. */
  function close() {
    if (closed) return;
    const cdStart = pos;
    for (const e of central) {
      const needSize = force || e.size >= MAX32;
      const needComp = force || e.comp >= MAX32;
      const needOff = force || e.offset >= MAX32;
      const fields = [];
      if (needSize) fields.push(e.size);
      if (needComp) fields.push(e.comp);
      if (needOff) fields.push(e.offset);
      const extra = fields.length ? zip64Extra(fields) : Buffer.alloc(0);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE((3 << 8) | 45, 4);
      h.writeUInt16LE(fields.length ? 45 : 20, 6);
      h.writeUInt16LE(0x800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(now.time, 12);
      h.writeUInt16LE(now.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(needComp ? MAX32 : e.comp, 20);
      h.writeUInt32LE(needSize ? MAX32 : e.size, 24);
      h.writeUInt16LE(e.nameBuf.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      h.writeUInt32LE(needOff ? MAX32 : e.offset, 42);
      write(Buffer.concat([h, e.nameBuf, extra]));
    }
    const cdSize = pos - cdStart;
    const big = force || central.length >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32;
    if (big) {
      const recPos = pos;
      const r = Buffer.alloc(56);
      r.writeUInt32LE(0x06064b50, 0);
      r.writeBigUInt64LE(44n, 4);
      r.writeUInt16LE(45, 12);
      r.writeUInt16LE(45, 14);
      r.writeBigUInt64LE(BigInt(central.length), 24);
      r.writeBigUInt64LE(BigInt(central.length), 32);
      r.writeBigUInt64LE(BigInt(cdSize), 40);
      r.writeBigUInt64LE(BigInt(cdStart), 48);
      write(r);
      const l = Buffer.alloc(20);
      l.writeUInt32LE(0x07064b50, 0);
      l.writeBigUInt64LE(BigInt(recPos), 8);
      l.writeUInt32LE(1, 16);
      write(l);
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(big ? 0xffff : central.length, 8);
    e.writeUInt16LE(big ? 0xffff : central.length, 10);
    e.writeUInt32LE(big ? MAX32 : cdSize, 12);
    e.writeUInt32LE(big ? MAX32 : cdStart, 16);
    write(e);
    closed = true;
    fs.closeSync(fd);
  }

  // Yarıda bırakılan arşiv: tanıtıcıyı kapat (çağıran dosyayı siler)
  function abort() {
    if (closed) return;
    closed = true;
    try { fs.closeSync(fd); } catch { /* kapanmış */ }
  }

  return { addBuffer, addFile, close, abort, get size() { return pos; }, get count() { return central.length; } };
}

module.exports = { createWriter };
