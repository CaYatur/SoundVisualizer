'use strict';
/* Pioneer `.lkd` OEL animasyon çözücüsü (araç ses sistemlerindeki yunus /
   Dolphin animasyonları bu biçimde saklanır).

   Biçim (tersine mühendislikle, bkz. github.com/youxufkhan/carozerra):
     0x00  "zLKD" sihirli imza (4 bayt)
     0x04  uint32 LE  sürüm            (=3)
     0x08  uint32 LE  (=1)
     0x0C  uint32 LE  (=7)
     0x10  uint32 LE  kare sayısı      (ör. 60)
     0x14  gzip akışı -> TAR -> ilk üye: tek bir 24-bit BMP
           (256 x 64*kare, alttan-üste). Dikey olarak kare sayısı kadar
           256x64'lük kareye bölünür.

   Çözücü BİLEREK oynatıcıdan ayrık: yalnızca baytları normalize edilmiş bir
   {width, height, frameCount, frames:[{rgba}]} yapısına çevirir. gzip açma
   ortama göre seçilir (Node -> zlib, tarayıcı -> DecompressionStream) ya da
   `opts.gunzip` ile dışarıdan verilebilir; böylece çözücü saf ve test
   edilebilir kalır. Bozuk/eksik dosyalar çökme yerine açıklayıcı Error atar. */
(function () {
  const MAGIC = [0x7a, 0x4c, 0x4b, 0x44]; // "zLKD"
  const NATIVE_FRAME_H = 64;
  const DEFAULT_DELAY_MS = 60; // referans 60 kare @ ~16.7fps

  function toU8(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    if (typeof input === 'string') {
      // base64
      if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(input, 'base64'));
      const bin = atob(input);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    throw new Error('LKD: unsupported input type');
  }

  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const i32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
  const u16 = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;

  function isLkd(input) {
    try {
      const b = toU8(input);
      return b.length >= 4 && b[0] === MAGIC[0] && b[1] === MAGIC[1] && b[2] === MAGIC[2] && b[3] === MAGIC[3];
    } catch { return false; }
  }

  function parseHeader(bytes) {
    if (bytes.length < 20) throw new Error('LKD: file too small for header (' + bytes.length + ' bytes)');
    for (let i = 0; i < 4; i++) {
      if (bytes[i] !== MAGIC[i]) {
        throw new Error('LKD: bad magic ' + JSON.stringify(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])) + ' (expected "zLKD")');
      }
    }
    return {
      version: u32(bytes, 4),
      field1: u32(bytes, 8),
      field2: u32(bytes, 12),
      frameCount: u32(bytes, 16),
      payloadOffset: 20,
    };
  }

  /* TAR arşivinin ilk normal dosya üyesi. USTAR olması gerekmez; yalnızca
     512 baytlık başlık + sekizlik boyut alanı yeterli. */
  function readFirstTarEntry(buf) {
    if (buf.length < 512) throw new Error('LKD: tar payload too small');
    // İsim ilk boş bayta kadar
    let end = 0;
    while (end < 100 && buf[end] !== 0) end++;
    let name = '';
    for (let i = 0; i < end; i++) name += String.fromCharCode(buf[i]);
    // Boyut: 124..135 sekizlik ASCII
    let sizeStr = '';
    for (let i = 124; i < 136; i++) {
      const c = buf[i];
      if (c === 0 || c === 0x20) continue;
      sizeStr += String.fromCharCode(c);
    }
    const size = parseInt(sizeStr || '0', 8);
    if (!(size > 0)) throw new Error('LKD: tar member has no size');
    if (512 + size > buf.length) throw new Error('LKD: tar member truncated (need ' + size + ' bytes)');
    return { name: name, data: buf.subarray(512, 512 + size) };
  }

  /* 24-bit (opsiyonel 32-bit) Windows BMP. Alttan-üste ya da üstten-aşağı.
     Dönüş: top-down RGBA. */
  function parseBmp(buf) {
    if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('LKD: not a BMP payload');
    const dataOffset = u32(buf, 10);
    const width = i32(buf, 18);
    const heightRaw = i32(buf, 22);
    const bpp = u16(buf, 28);
    const compression = u32(buf, 30);
    if (compression !== 0) throw new Error('LKD: compressed BMP not supported (BI_' + compression + ')');
    if (bpp !== 24 && bpp !== 32) throw new Error('LKD: unsupported BMP depth ' + bpp + ' (expected 24/32)');
    if (width <= 0 || heightRaw === 0) throw new Error('LKD: bad BMP dimensions');
    const topDown = heightRaw < 0;
    const height = Math.abs(heightRaw);
    const bytesPP = bpp / 8;
    const rowSize = ((width * bytesPP + 3) & ~3) >>> 0;
    if (dataOffset + rowSize * height > buf.length) throw new Error('LKD: BMP pixel data truncated');
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = topDown ? y : (height - 1 - y);
      let s = dataOffset + srcRow * rowSize;
      let d = y * width * 4;
      for (let x = 0; x < width; x++) {
        rgba[d] = buf[s + 2];       // R
        rgba[d + 1] = buf[s + 1];   // G
        rgba[d + 2] = buf[s];       // B
        rgba[d + 3] = 255;          // A (24-bit opak; 32-bit'te aşağıda düzeltilir)
        if (bytesPP === 4) rgba[d + 3] = buf[s + 3];
        s += bytesPP;
        d += 4;
      }
    }
    return { width: width, height: height, rgba: rgba };
  }

  async function gunzip(gz, custom) {
    if (custom) return toU8(await custom(gz));
    // Node
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        const zlib = require('zlib');
        return new Uint8Array(zlib.gunzipSync(Buffer.from(gz.buffer, gz.byteOffset, gz.byteLength)));
      } catch (e) { /* tarayıcıya düş */ }
    }
    // Tarayıcı / Electron renderer
    if (typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined') {
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([gz]).stream().pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error('LKD: no gzip decompressor available in this environment');
  }

  /* Açılmış (gzip'siz) BMP şeridini normalize edilmiş karelere böler.
     gzip'ten bağımsız test edilebilsin diye ayrı. */
  function framesFromStrip(bmp, frameCountHint) {
    const strip = parseBmp(bmp);
    let frameCount = frameCountHint | 0;
    if (!(frameCount > 0)) frameCount = Math.max(1, Math.round(strip.height / NATIVE_FRAME_H));
    if (frameCount > strip.height) frameCount = strip.height;
    const fh = Math.floor(strip.height / frameCount);
    if (fh <= 0) throw new Error('LKD: frame height resolves to 0');
    const W = strip.width;
    const frames = [];
    const rowBytes = W * 4;
    for (let i = 0; i < frameCount; i++) {
      const rgba = new Uint8ClampedArray(W * fh * 4);
      rgba.set(strip.rgba.subarray(i * fh * rowBytes, (i * fh + fh) * rowBytes));
      frames.push({ width: W, height: fh, rgba: rgba });
    }
    return { width: W, frameHeight: fh, frameCount: frameCount, frames: frames, strip: strip };
  }

  /* Kümülatif süreye göre kare indeksi (döngülü). Oynatıcı da bu saf
     yardımcıyı kullanır; böylece döngü/zamanlama davranışı Node'da test
     edilebilir. `ms` negatifse ve toplam süre pozitifse başa sarılır. */
  function frameIndexAt(durations, ms) {
    if (!durations || !durations.length) return 0;
    let total = 0;
    for (let i = 0; i < durations.length; i++) total += durations[i];
    if (!(total > 0)) return 0;
    let p = ms % total;
    if (p < 0) p += total;
    for (let i = 0; i < durations.length; i++) {
      if (p < durations[i]) return i;
      p -= durations[i];
    }
    return durations.length - 1;
  }

  /* Ana giriş: ham `.lkd` baytları -> normalize animasyon. */
  async function decode(input, opts) {
    opts = opts || {};
    const bytes = toU8(input);
    const header = parseHeader(bytes);
    const gz = bytes.subarray(header.payloadOffset);
    let tar;
    try {
      tar = await gunzip(gz, opts.gunzip);
    } catch (e) {
      throw new Error('LKD: gzip decompression failed (' + (e && e.message ? e.message : e) + ')');
    }
    const entry = readFirstTarEntry(tar);
    const sliced = framesFromStrip(entry.data, header.frameCount);
    const delayMs = opts.delayMs > 0 ? opts.delayMs : DEFAULT_DELAY_MS;
    return {
      magic: 'zLKD',
      version: header.version,
      width: sliced.width,
      frameHeight: sliced.frameHeight,
      frameCount: sliced.frameCount,
      delayMs: delayMs,
      loop: true,
      member: entry.name,
      frames: sliced.frames,
    };
  }

  const mod = {
    MAGIC: 'zLKD',
    NATIVE_FRAME_H: NATIVE_FRAME_H,
    DEFAULT_DELAY_MS: DEFAULT_DELAY_MS,
    isLkd: isLkd,
    parseHeader: parseHeader,
    readFirstTarEntry: readFirstTarEntry,
    parseBmp: parseBmp,
    framesFromStrip: framesFromStrip,
    frameIndexAt: frameIndexAt,
    decode: decode,
    _toU8: toU8,
  };

  // Klasik betik (tarayıcı) VE CommonJS (Node testi) olarak da kullanılabilir.
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.SVLkd = mod;
})();
