'use strict';
/* MilkDrop sprite dosyaları (#577): `milk_img.ini` ve resimleri.
 *
 * Ana süreçten ayrı bir dosyada, çünkü yol kurallarını testin gerçekten
 * çalıştırabildiği yer burası (milkdrop-textures.js ile aynı gerekçe).
 *
 * Doku klasöründen farkı: dokunun adı PRESETTEN geliyor, burada resmin
 * yolunu kullanıcının kendi seçtiği ini yazıyor. MilkDrop'un kuralları:
 *   img=logo.jpg          ini'nin klasörüne göre (MilkDrop'ta eklenti
 *   img=..\logo.jpg       klasörü; ini de orada)
 *   img=resimler\logo.jpg
 *   img=c:\bir\logo.jpg   tam yol
 *   img=c:logo.jpg        HAYIR — sürücüye göreli
 *   img=\logo.jpg         HAYIR — sürücüsüz kök
 * Ağ yolu (`\\sunucu\pay`) da reddediliyor: bir ini dosyası uygulamaya
 * ağdan dosya çektirmemeli.
 *
 * Oluşturucular (pencereler, web çıkışı) resmi YOLLA değil, burada
 * üretilen bir KİMLİKLE istiyor; yol hiçbir zaman sayfaya gitmiyor. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tex = require('./milkdrop-textures');

const INI_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 16 * 1024 * 1024;

/* MilkDrop JPG, PNG, BMP, TGA, DDS, PPM ve DIB okuyordu. Tarayıcı son
   dördünü çözemiyor; onlar "desteklenmeyen biçim" diye bildiriliyor. */
const LEGACY_EXT = ['.tga', '.dds', '.ppm', '.dib'];

function readIni(file) {
  if (!file || typeof file !== 'string') return { ok: false, error: 'NO_FILE' };
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, error: 'NOT_FILE' };
    if (st.size > INI_MAX_BYTES) return { ok: false, error: 'TOO_LARGE' };
    return { ok: true, text: fs.readFileSync(file, 'latin1') };
  } catch {
    return { ok: false, error: 'READ_FAILED' };
  }
}

/* Resmin tam yolu ya da nedeniyle reddi: { file } | { error }.
   Hatalar: NO_IMG, BAD_PATH, UNSUPPORTED, NOT_FOUND, TOO_LARGE. */
function resolveImage(iniFile, img, platform) {
  const raw = typeof img === 'string' ? img.trim() : '';
  if (!raw) return { error: 'NO_IMG' };
  const win = (platform || process.platform) === 'win32';
  if (/^[\\/]{2}/.test(raw)) return { error: 'BAD_PATH' };           // ağ yolu
  if (/^[A-Za-z]:(?![\\/])/.test(raw)) return { error: 'BAD_PATH' }; // c:logo.jpg
  const drive = /^[A-Za-z]:[\\/]/.test(raw);
  /* Sürücüsüz kök: Windows'ta `\logo.jpg` da `/logo.jpg` da geçerli
     sürücüye göre — MilkDrop "sürücü belirtilmeli" diyor. macOS ve
     Linux'ta `/` ile başlayan yol ise gerçek bir tam yol. */
  if (!drive && (raw[0] === '\\' || (raw[0] === '/' && win))) return { error: 'BAD_PATH' };
  const absolute = drive || raw[0] === '/';
  // Windows'tan gelen ini'de ayırıcı ters eğik çizgi; her sistemde yol olsun
  const norm = raw.replace(/[\\/]+/g, path.sep);
  const abs = absolute ? path.resolve(norm) : path.resolve(path.dirname(String(iniFile || '')), norm);
  const ext = path.extname(abs).toLowerCase();
  if (LEGACY_EXT.indexOf(ext) >= 0 || !tex.isTextureFile(abs)) return { error: 'UNSUPPORTED', file: abs };
  let st;
  try { st = fs.statSync(abs); } catch { return { error: 'NOT_FOUND', file: abs }; }
  if (!st.isFile()) return { error: 'NOT_FOUND', file: abs };
  if (st.size > IMAGE_MAX_BYTES) return { error: 'TOO_LARGE', file: abs };
  return { file: abs, mime: tex.mimeFor(abs), size: st.size };
}

/* Resmin sayfaya giden kimliği: yolun kısa özeti. Aynı resmi kullanan
   sprite'lar aynı kimliği alıyor ve motor dokuyu paylaşıyor. */
function imageKey(file) {
  return 'spr_' + crypto.createHash('sha256').update(String(file)).digest('hex').slice(0, 16);
}

module.exports = { INI_MAX_BYTES, IMAGE_MAX_BYTES, LEGACY_EXT, readIni, resolveImage, imageKey };
