/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* 3B LUT (.cube) okuyucu.

   Renk düzeltme yazılımlarının (DaVinci Resolve, Premiere, OBS) ortak
   dışa aktarım biçimi Adobe/Resolve .cube. Bu modül dosyayı okur, tabloyu
   en fazla MAX_SIZE noktaya indirger ve efekt zincirinin saklayabileceği
   küçük bir biçime paketler: 8 bit RGB, base64. Çıkış zaten 8 bit
   olduğu için bu hassasiyet görüntüde kayıp yaratmaz.

   Neden en fazla 33 nokta: tablo sahne yapılandırmasında duruyor ve her
   değişiklikte çıkış pencerelerine gidiyor. 33³ tablo ~144 KB base64; 65³
   bunun sekiz katı olurdu. 65'lik dosyalar üç doğrusal örneklemeyle 33'e
   indirilir (çoğu donanım LUT'u da 17 ya da 33 noktalıdır).

   Saf modül: DOM'a ya da GL'e bağlı değil; tests/lut.test.js okur. */
(function () {
  const MAX_SIZE = 33;
  const MIN_SIZE = 2;
  const MAX_TEXT = 8 * 1024 * 1024; // 65³ tablo ~6 MB metin

  /* .cube metnini oku. Hata atmaz; { ok:false, error } döndürür. error
     arayüzün çevirdiği sabit bir koddur. */
  function parseCube(text) {
    if (typeof text !== 'string' || !text.length) return { ok: false, error: 'empty' };
    if (text.length > MAX_TEXT) return { ok: false, error: 'tooLarge' };
    let size = 0;
    let title = '';
    let dmin = [0, 0, 0];
    let dmax = [1, 1, 1];
    let table = null;
    let n = 0;
    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim();
      if (!line || line[0] === '#') continue;
      const c = line.charCodeAt(0);
      // Sayıyla başlayan satır veri satırıdır
      if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
        if (!table) return { ok: false, error: 'noSize' };
        const parts = line.split(/\s+/);
        if (parts.length < 3) return { ok: false, error: 'badRow' };
        if (n >= table.length) return { ok: false, error: 'tooManyRows' };
        for (let k = 0; k < 3; k++) {
          const v = parseFloat(parts[k]);
          if (!isFinite(v)) return { ok: false, error: 'badRow' };
          table[n++] = v;
        }
        continue;
      }
      const sp = line.search(/\s/);
      const key = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
      const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
      if (key === 'TITLE') {
        title = rest.replace(/^"|"$/g, '').slice(0, 120);
      } else if (key === 'LUT_3D_SIZE') {
        size = parseInt(rest, 10);
        if (!(size >= MIN_SIZE && size <= 65)) return { ok: false, error: 'badSize' };
        table = new Float32Array(size * size * size * 3);
      } else if (key === 'LUT_1D_SIZE') {
        return { ok: false, error: 'lut1d' };
      } else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
        const v = rest.split(/\s+/).map(parseFloat);
        if (v.length < 3 || !v.every(isFinite)) return { ok: false, error: 'badDomain' };
        if (key === 'DOMAIN_MIN') dmin = v.slice(0, 3); else dmax = v.slice(0, 3);
      } else if (key === 'LUT_3D_INPUT_RANGE') {
        const v = rest.split(/\s+/).map(parseFloat);
        if (v.length < 2 || !v.every(isFinite)) return { ok: false, error: 'badDomain' };
        dmin = [v[0], v[0], v[0]];
        dmax = [v[1], v[1], v[1]];
      }
      // Bilinmeyen anahtar sözcükler (LUT_IN_VIDEO_RANGE vb.) yok sayılır
    }
    if (!table) return { ok: false, error: 'noSize' };
    if (n !== table.length) return { ok: false, error: 'tooFewRows' };
    for (let k = 0; k < 3; k++) {
      if (!(dmax[k] > dmin[k])) return { ok: false, error: 'badDomain' };
    }
    // Giriş aralığı 0..1 değilse desteklenmez: görüntü zaten 0..1
    if (dmin.some((v) => Math.abs(v) > 1e-6) || dmax.some((v) => Math.abs(v - 1) > 1e-6)) {
      return { ok: false, error: 'domain' };
    }
    return { ok: true, title, size, table };
  }

  // Tablodan (r, g, b) 0..1 girişinde üç doğrusal örnek; R en hızlı değişen eksen
  function sampleTable(table, size, r, g, b, out) {
    const o = out || [0, 0, 0];
    const s = size - 1;
    const fx = Math.min(s, Math.max(0, r * s));
    const fy = Math.min(s, Math.max(0, g * s));
    const fz = Math.min(s, Math.max(0, b * s));
    const x0 = Math.floor(fx); const y0 = Math.floor(fy); const z0 = Math.floor(fz);
    const x1 = Math.min(s, x0 + 1); const y1 = Math.min(s, y0 + 1); const z1 = Math.min(s, z0 + 1);
    const tx = fx - x0; const ty = fy - y0; const tz = fz - z0;
    const at = (x, y, z, k) => table[((z * size + y) * size + x) * 3 + k];
    for (let k = 0; k < 3; k++) {
      const c00 = at(x0, y0, z0, k) * (1 - tx) + at(x1, y0, z0, k) * tx;
      const c10 = at(x0, y1, z0, k) * (1 - tx) + at(x1, y1, z0, k) * tx;
      const c01 = at(x0, y0, z1, k) * (1 - tx) + at(x1, y0, z1, k) * tx;
      const c11 = at(x0, y1, z1, k) * (1 - tx) + at(x1, y1, z1, k) * tx;
      const c0 = c00 * (1 - ty) + c10 * ty;
      const c1 = c01 * (1 - ty) + c11 * ty;
      o[k] = c0 * (1 - tz) + c1 * tz;
    }
    return o;
  }

  // Tabloyu n noktaya yeniden örnekle
  function resample(table, size, n) {
    if (n === size) return table;
    const out = new Float32Array(n * n * n * 3);
    const tmp = [0, 0, 0];
    let i = 0;
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          sampleTable(table, size, x / (n - 1), y / (n - 1), z / (n - 1), tmp);
          out[i++] = tmp[0]; out[i++] = tmp[1]; out[i++] = tmp[2];
        }
      }
    }
    return out;
  }

  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function fromBase64(str) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Okunmuş LUT'u efekt girdisinin `lut` alanına paketle:
     { name, size, data } — data 8 bit RGB base64, R en hızlı eksen. */
  function pack(parsed, name) {
    const size = Math.min(MAX_SIZE, parsed.size);
    const table = resample(parsed.table, parsed.size, size);
    const bytes = new Uint8Array(table.length);
    for (let i = 0; i < table.length; i++) {
      const v = table[i];
      bytes[i] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
    }
    return { name: String(name || parsed.title || '').slice(0, 120), size, data: toBase64(bytes) };
  }

  // Paketlenmiş LUT geçerli mi (boyut ve veri uzunluğu tutarlı)
  function validPacked(lut) {
    if (!lut || typeof lut.data !== 'string') return false;
    const s = lut.size;
    if (!(Number.isInteger(s) && s >= MIN_SIZE && s <= MAX_SIZE)) return false;
    // base64 uzunluğu: 4 * ceil(bayt / 3)
    return lut.data.length === 4 * Math.ceil((s * s * s * 3) / 3) && /^[A-Za-z0-9+/]*$/.test(lut.data);
  }

  // Birim tablo (giriş = çıkış); test ve önizleme için
  function identity(n) {
    const t = new Float32Array(n * n * n * 3);
    let i = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      t[i++] = x / (n - 1); t[i++] = y / (n - 1); t[i++] = z / (n - 1);
    }
    return t;
  }

  const api = { MAX_SIZE, MAX_TEXT, parseCube, sampleTable, resample, pack, validPacked, identity, toBase64, fromBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLut = api;
})();
