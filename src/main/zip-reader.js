'use strict';
/* ZIP OKUYUCU (#574) — preset paketleri için, bağımlılıksız.

   MilkDrop preset paketleri ZIP olarak dolaşıyor. Bu okuyucu yalnız ihtiyaç
   duyulanı yapıyor: arşivin MERKEZİ DİZİNİNİ okuyor (yerel başlıklar akışla
   yazılmış arşivlerde boyutları sıfır taşıyor, güvenilmez) ve istenen
   girdiyi açıyor. Arşiv belleğe bütün alınmıyor; girdiler dosyadaki
   konumlarından okunuyor.

   Desteklenen: saklanmış (0) ve deflate (8) girdiler, ZIP64 (65.535'ten
   fazla girdi ya da 4 GB'tan büyük arşiv — 73 binlik preset derlemeleri
   var), UTF-8 ve CP437 adlar. Desteklenmeyen her durum kendi adıyla bir
   hata: şifreli girdi, başka sıkıştırma yöntemi, bozuk arşiv.

   Girdi ADLARI güvenilmez. Bu modül adları yol olarak hiçbir yere yazmıyor;
   çağıran yalnız adın son parçasını (dosya adı) ve klasör adlarını etiket
   olarak kullanıyor.

   Güvenlik sınırları:
     - girdi sayısı (`MAX_ENTRIES`),
     - açılmış boyut, çağıranın verdiği sınırla; açma `maxOutputLength` ile
       BİLDİRİLEN boyuta kısılıyor — başlığı yalan söyleyen bir girdi o
       boyutun ötesine açılamıyor,
     - sıkıştırma oranı (`MAX_RATIO`): 1 MB'ı aşan ve bundan daha fazla
       sıkışmış bir girdi bomba sayılıyor,
     - CRC32 denetimi. */
const fs = require('fs');
const zlib = require('zlib');

const MAX_ENTRIES = 200000;
const MAX_RATIO = 200;
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

class ZipError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
  }
}

// CRC32 (IEEE). Node'un `zlib.crc32`si 20.15 ve 22.2'de geldi; CI 20'de de koşuyor.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// CP437: bayrak 11 kapalıyken adlar bu kod sayfasında (DOS'un ve eski araçların)
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function decodeName(buf, utf8) {
  if (utf8) return buf.toString('utf8');
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  }
  return s;
}

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = fs.readSync(fd, buf, off, len - off, pos + off);
    if (n <= 0) throw new ZipError('CORRUPT', 'kısa okuma');
    off += n;
  }
  return buf;
}

/* Arşivi aç ve merkezi dizini oku. Dönüş: { entries, close, read }.
   `entries[i]`: { name, dir, method, flags, encrypted, compSize, size,
   crc, offset, index }. */
function open(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    const total = st.size;
    if (total < 22) throw new ZipError('NOT_ZIP');
    // Arşiv sonu kaydı: sondaki yorum en çok 65.535 bayt
    const tailLen = Math.min(total, 22 + 65535);
    const tail = readAt(fd, total - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new ZipError('NOT_ZIP');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      // ZIP64: konum kaydı arşiv sonu kaydının hemen önünde
      const locPos = total - tailLen + eocd - 20;
      if (locPos < 0) throw new ZipError('CORRUPT', 'zip64 konum kaydı yok');
      const loc = readAt(fd, locPos, 20);
      if (loc.readUInt32LE(0) !== EOCD64_LOC_SIG) throw new ZipError('CORRUPT', 'zip64 konum kaydı yok');
      const recPos = Number(loc.readBigUInt64LE(8));
      if (recPos < 0 || recPos + 56 > total) throw new ZipError('CORRUPT', 'zip64 kaydı dışarıda');
      const rec = readAt(fd, recPos, 56);
      if (rec.readUInt32LE(0) !== EOCD64_SIG) throw new ZipError('CORRUPT', 'zip64 kaydı yok');
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (count > MAX_ENTRIES) throw new ZipError('TOO_MANY_ENTRIES', String(count));
    if (cdOffset + cdSize > total) throw new ZipError('CORRUPT', 'merkezi dizin dışarıda');
    const cd = readAt(fd, cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CDH_SIG) throw new ZipError('CORRUPT', 'merkezi dizin girdisi');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      let compSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const end = p + 46 + nameLen + extraLen + commentLen;
      if (end > cd.length) throw new ZipError('CORRUPT', 'merkezi dizin girdisi');
      const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
      // ZIP64 ek alanı: 0xFFFFFFFF olan alanlar sırayla burada
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          const qEnd = Math.min(eEnd, q + len);
          if (size === 0xffffffff && q + 8 <= qEnd) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compSize === 0xffffffff && q + 8 <= qEnd) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff && q + 8 <= qEnd) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        e += 4 + len;
      }
      entries.push({
        index: i, name, dir: /\/$/.test(name), method, flags, encrypted: (flags & 1) !== 0,
        compSize, size, crc, offset,
      });
      p = end;
    }
    let closed = false;
    return {
      entries,
      total,
      /* Girdinin içeriği. `maxBytes` açılmış boyutun üst sınırı. */
      read(entry, maxBytes) {
        if (closed) throw new ZipError('CLOSED');
        if (entry.dir) throw new ZipError('IS_DIR');
        if (entry.encrypted) throw new ZipError('ENCRYPTED', entry.name);
        if (entry.method !== 0 && entry.method !== 8) throw new ZipError('UNSUPPORTED_METHOD', String(entry.method));
        if (typeof maxBytes === 'number' && entry.size > maxBytes) throw new ZipError('TOO_LARGE', entry.name);
        if (entry.size > 1024 * 1024 && entry.compSize > 0 && entry.size / entry.compSize > MAX_RATIO) {
          throw new ZipError('SUSPICIOUS_RATIO', entry.name);
        }
        if (entry.offset + 30 > total) throw new ZipError('CORRUPT', 'yerel başlık dışarıda');
        const lh = readAt(fd, entry.offset, 30);
        if (lh.readUInt32LE(0) !== LFH_SIG) throw new ZipError('CORRUPT', 'yerel başlık');
        const start = entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        if (start + entry.compSize > total) throw new ZipError('CORRUPT', 'girdi dışarıda');
        const raw = readAt(fd, start, entry.compSize);
        let out;
        if (entry.method === 0) {
          if (entry.compSize !== entry.size) throw new ZipError('CORRUPT', 'saklanmış boyut');
          out = raw;
        } else {
          try {
            // Bildirilen boyutun ötesine açılamıyor: yalan söyleyen başlık hata veriyor
            out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
          } catch (err) {
            throw new ZipError('CORRUPT', 'açılamadı');
          }
          if (out.length !== entry.size) throw new ZipError('CORRUPT', 'boyut uyuşmuyor');
        }
        if (crc32(out) !== entry.crc) throw new ZipError('CRC', entry.name);
        return out;
      },
      close() {
        if (closed) return;
        closed = true;
        try { fs.closeSync(fd); } catch { /* kapanmış */ }
      },
    };
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* kapanmış */ }
    if (err instanceof ZipError) throw err;
    throw new ZipError('READ_FAILED', err && err.message);
  }
}

module.exports = { open, crc32, decodeName, ZipError, MAX_ENTRIES, MAX_RATIO };
