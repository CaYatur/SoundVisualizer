'use strict';
/* MilkDrop doku paketinin dosya çözümü.
 *
 * Ana süreçten ayrı bir dosyada, çünkü kapsam denetiminin testin gerçekten
 * çalıştırabildiği tek yer burası; main.js Electron olmadan yüklenemez.
 * (Aynı gerekçe media-file.js için de geçerli.)
 *
 * Denetimin işi şu: istenen ad renderer'dan geliyor ve PRESET METNİNDEN
 * türüyor — kullanıcının yazmadığı bir dize. Bir preset `sampler_worms`
 * yerine yol ayırıcısı içeren bir ad yazabilir. Bu yüzden çözülmüş yol,
 * çözülmüş klasörle karşılaştırılıyor; dize birleştirmesiyle değil. */
const path = require('path');

/* MilkDrop'un doku klasöründe gerçekten bulunan biçimler. Liste dar
   tutuluyor: kabul edilen her uzantı ana süreçte okunup renderer'a
   gönderilecek bir dosya demek. */
const TEXTURE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

const TEXTURE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
};

function isTextureFile(name) {
  return TEXTURE_EXT.indexOf(path.extname(String(name || '')).toLowerCase()) >= 0;
}

function mimeFor(name) {
  return TEXTURE_MIME[path.extname(String(name || '')).toLowerCase()] || '';
}

/* İstenen adın klasör içindeki tam yolu, ya da kabul edilmiyorsa boş dize.
 *
 * Reddedilenler:
 *   - klasör ayarlanmamış
 *   - ad boş, `.` ya da `..`
 *   - ad yol ayırıcısı içeriyor (alt klasör de dahil: doku klasörü düz)
 *   - uzantı görsel değil
 *   - çözülmüş yol klasörün dışına çıkıyor
 */
function resolveTexture(dir, name) {
  if (!dir || typeof dir !== 'string') return '';
  if (typeof name !== 'string' || !name) return '';
  if (name === '.' || name === '..') return '';
  if (/[\\/]/.test(name)) return '';
  /* Windows'ta `C:foo.png` sürücüye GÖRECELİ bir yoldur ve ayırıcı
     içermez; path.resolve onu klasörün dışına taşıyabilir. Aşağıdaki
     relative denetimi bunu da yakalıyor, ama ayrıca eleyip niyeti
     belirginleştiriyoruz. */
  if (/^[A-Za-z]:/.test(name)) return '';
  if (!isTextureFile(name)) return '';
  const root = path.resolve(dir);
  const file = path.resolve(root, name);
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return file;
}

module.exports = { TEXTURE_EXT, TEXTURE_MIME, isTextureFile, mimeFor, resolveTexture };
