/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* QR KODLAYICI (ISO/IEC 18004). Telefon bağlantısının eşleşme kodu için (#1054). Dış
   kütüphane yok: bayt kipi, L ya da M hata düzeltmesi, sürüm 1–15, sekiz maske ve ceza
   puanıyla en uygun maske. Saf; panel (window.SVQr) ve Node (sınama) kullanır.

   encode(metin, { ecc: 'L'|'M' }) → { size, version, mask, modules: [[bool]] } ya da null. */
(function () {
  const ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24],
  };
  const BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10],
  };
  const FORMAT_ECC = { L: 1, M: 0 };
  const MAX_VER = 15;

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (ver, ecc) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver] * BLOCKS[ecc][ver];

  // GF(256), indirgeyici 0x11D
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function divisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        r[j] = mul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = mul(root, 0x02);
    }
    return r;
  }
  function remainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < div.length; i++) r[i] ^= mul(div[i], f);
    }
    return r;
  }

  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(Buffer.from(text, 'utf8'));
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function encode(text, opts) {
    const ecc = opts && opts.ecc === 'M' ? 'M' : 'L';
    const bytes = utf8(String(text));
    let ver = 1;
    for (; ver <= MAX_VER; ver++) {
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, ecc) * 8) break;
    }
    if (ver > MAX_VER) return null;
    const cap = dataCodewords(ver, ecc);

    // Bit akışı
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0x4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, cap * 8 - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }
    for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);

    // Bloklar ve hata düzeltme, araya serpme
    const nBlocks = BLOCKS[ecc][ver];
    const eccLen = ECC_PER_BLOCK[ecc][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks);
    const shortLen = Math.floor(raw / nBlocks);
    const div = divisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const e = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(e));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= nShort) words.push(blocks[j][i]);
      }
    }

    // Işlev desenleri
    const size = ver * 4 + 17;
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mods[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPositions(ver);
    for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const d = (FORMAT_ECC[ecc] << 3) | mask;
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412;
      const bit = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0); // yerleri işlev olarak ayrılsın
    if (ver >= 7) {
      let r = ver;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (ver << 12) | r;
      for (let i = 0; i < 18; i++) {
        const dark = ((b >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3), c = Math.floor(i / 3);
        set(a, c, dark); set(c, a, dark);
      }
    }

    // Veri: sağdan sola iki sütunluk zikzak
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - v : v;
          if (!fn[y][x] && bi < words.length * 8) {
            mods[y][x] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0;
            bi++;
          }
        }
      }
    }

    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mods[y][x] = !mods[y][x];
    };
    /* Ceza puanı (ISO/IEC 18004 §7.8.3; Nayuki'nin başvuru uygulamasıyla aynı hesap): aynı renkli
       diziler (N1), 2x2 bloklar (N2), bulucuya benzeyen 1:1:3:1:1 desenler (N3), koyu oranı (N4).
       N3'te simgenin dışı açık renk sayılır: kenara bitişik sahte bulucu da cezalanır. Eskiden
       yalnız simgenin içindeki 11'lik pencereler sayılıyordu; seçilen maske bazen sahte bulucu
       bırakıyor, çözücüler (ZXing, OpenCV) kusursuz görüntüde bile %1-3 kodu okuyamıyordu. Bit
       düzeyindeki veri her maskede doğruydu (ZXing'in bit çözücüsüyle 4800 durum). */
    const penalty = () => {
      let p = 0;
      const countPatterns = (h) => {
        const n = h[1];
        const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
        return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
      };
      const addHistory = (run, h) => {
        if (h[0] === 0) run += size; // ilk dizinin önündeki açık kenar
        h.pop();
        h.unshift(run);
      };
      const terminate = (color, run, h) => {
        if (color) { addHistory(run, h); run = 0; }
        run += size; // sondaki açık kenar
        addHistory(run, h);
        return countPatterns(h);
      };
      const line = (get) => {
        let color = false;
        let run = 0;
        const h = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < size; i++) {
          if (get(i) === color) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else {
            addHistory(run, h);
            if (!color) p += countPatterns(h) * 40;
            color = get(i);
            run = 1;
          }
        }
        p += terminate(color, run, h) * 40;
      };
      for (let y = 0; y < size; y++) line((i) => mods[y][i]);
      for (let x = 0; x < size; x++) line((i) => mods[i][x]);
      let dark = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (mods[y][x]) dark++;
        if (x + 1 < size && y + 1 < size) {
          const c = mods[y][x];
          if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) p += 3;
        }
      }
      const total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty();
      if (p < bestP) { bestP = p; best = m; }
      applyMask(m);
    }
    // Sınama: belirli bir maskeyle (0–7) kur
    if (opts && Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask < 8) best = opts.mask;
    applyMask(best); drawFormat(best);
    return { size, version: ver, mask: best, modules: mods };
  }

  /** SVG metni (sessiz bölge 4 modül). Renkler çağırandan; varsayılan siyah-beyaz. */
  function svg(text, opts) {
    const q = encode(text, opts);
    if (!q) return '';
    const o = opts || {};
    const quiet = 4, n = q.size + quiet * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' + String(o.label || 'QR').replace(/[<>&"]/g, '') + '">'
      + '<rect width="' + n + '" height="' + n + '" fill="' + (o.light || '#fff') + '"/><path fill="' + (o.dark || '#000') + '" d="' + d + '"/></svg>';
  }

  const api = { encode, svg, MAX_VER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVQr = api;
})();
