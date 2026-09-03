'use strict';
/* Electron'un paylaşılan doku tanıtıcısını Spout/Syphon'un beklediği biçime
 * çevirir.
 *
 * Neden ayrı ve saf bir modül: iki taraf da bunu YANLIŞ belgeliyor ve şekil
 * platforma göre değişiyor. texture-bridge'in tür tanımı "handle: number"
 * diyor; Electron 43 ise şunu veriyor:
 *
 *   Windows : textureInfo.handle = { ntHandle: <Buffer 8 bayt, küçük-endian> }
 *   macOS   : textureInfo.handle = { ioSurface: <Buffer> }
 *
 * Yanlış çıkarım sessizce başarısız olur: gönderici ya hiçbir şey yayınlamaz
 * ya da çöp bir tanıtıcıyla çağrılır. Hiçbiri hata vermez, yalnızca alıcı
 * tarafta siyah bir kare görünür. macOS'u burada çalıştıramadığımız için de
 * tek doğrulama yolu bu.
 */
(function () {
  /* Bir tanıtıcı tamponunu sayıya çevirir. NT HANDLE değerleri küçüktür
     (bu makinede 0x0DDC gibi), ama yine de güvenli tamsayı sınırını
     denetliyoruz: sessizce yuvarlanmış bir tanıtıcı başka bir nesneyi
     gösterir. */
  function bufferToNumber(buf) {
    if (!buf || typeof buf.readBigUInt64LE !== 'function' || buf.length < 8) return null;
    const big = buf.readBigUInt64LE(0);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(big);
  }

  /* JSON'a çevrilmiş Buffer da kabul edilir ({type:'Buffer',data:[...]}):
     IPC üzerinden geçmiş bir tanıtıcı bu biçimde görünür. */
  function asBuffer(v) {
    if (!v) return null;
    if (typeof v.readBigUInt64LE === 'function') return v;
    if (Array.isArray(v.data) && typeof Buffer !== 'undefined') return Buffer.from(v.data);
    if (Array.isArray(v) && typeof Buffer !== 'undefined') return Buffer.from(v);
    return null;
  }

  /* textureInfo -> gönderilebilir tanıtıcı.
     Dönen: { kind, ntHandle|surface, width, height } ya da { error }. */
  function extractHandle(textureInfo, platform) {
    const ti = textureInfo || {};
    const size = ti.codedSize || ti.visibleRect || {};
    const width = Number(size.width) || 0;
    const height = Number(size.height) || 0;
    if (!width || !height) return { error: 'NO_SIZE' };

    const h = ti.handle;
    if (!h) return { error: 'NO_HANDLE' };

    const p = platform || process.platform;
    if (p === 'darwin') {
      /* macOS: IOSurface işaretçisi tampon olarak geçer; texture-bridge'in
         sendSurface() çağrısı tam olarak bunu ister. */
      const surface = asBuffer(h.ioSurface || h.IOSurface || h);
      if (!surface) return { error: 'NO_IOSURFACE' };
      return { kind: 'iosurface', surface, width, height };
    }

    /* Windows: NT HANDLE. Eski Electron sürümleri düz sayı veriyordu,
       43 ise { ntHandle: Buffer }. İkisi de kabul edilir ki bir yükseltme
       sessizce bozmasın. */
    if (typeof h === 'number') return { kind: 'nt', ntHandle: h, width, height };
    if (typeof h === 'bigint') {
      if (h > BigInt(Number.MAX_SAFE_INTEGER)) return { error: 'HANDLE_TOO_LARGE' };
      return { kind: 'nt', ntHandle: Number(h), width, height };
    }
    const buf = asBuffer(h.ntHandle || h.sharedTextureHandle || h);
    if (!buf) return { error: 'NO_NT_HANDLE' };
    const num = bufferToNumber(buf);
    if (num === null) return { error: 'HANDLE_TOO_LARGE' };
    return { kind: 'nt', ntHandle: num, width, height };
  }

  /* Piksel biçimi gönderici için uygun mu? Spout ve Syphon BGRA/RGBA bekler;
     yüzen nokta biçimleri (HDR) desteklenmiyor ve sessizce bozuk renk
     üretmektense reddetmek gerekir. */
  function formatSupported(pixelFormat) {
    return /^(bgra|rgba)$/i.test(String(pixelFormat || ''));
  }

  const api = { extractHandle, formatSupported, bufferToNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSharedTexture = api;
})();
