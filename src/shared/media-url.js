'use strict';
/* Medya dosyalarının özel protokol adresi.

   Yol, URL'in HOST kısmına KONULAMAZ. Windows yolları iki nokta ve ters bölü
   içerir; ikisi de host dilbilgisinde geçersizdir. Chromium böyle bir adresi
   düzeltmeye çalışmaz, isteği hiç kurmaz:

     sv-media://D%3A%5CVideos%5CKlip.mp4        -> Failed to parse URL
     sv-media://local/D%3A%5CVideos%5CKlip.mp4  -> 200, kodlama bozulmadan

   Yani protokol işleyicisine istek ULAŞMIYORDU bile; hata işleyicide değil,
   adresin biçimindeydi. Bu yüzden yol, sabit bir host'un ardından yol kısmına
   yazılıyor — orada yüzde kodlaması olduğu gibi korunuyor. */
(function () {
  const SCHEME = 'sv-media';
  const HOST = 'local';
  const PREFIX = SCHEME + '://' + HOST + '/';
  const OLD_PREFIX = SCHEME + '://';

  const isWin = typeof process !== 'undefined' && process.platform === 'win32';

  function toMediaUrl(filePath) {
    const p = String(filePath == null ? '' : filePath);
    return p ? PREFIX + encodeURIComponent(p) : '';
  }

  /* Adresten dosya yolunu çıkarır. Zaten düz bir yol verilmişse olduğu gibi
     döner, böylece çağıran tarafın hangi biçimde olduğunu bilmesi gerekmez. */
  function fromMediaUrl(u) {
    const s = String(u == null ? '' : u);
    if (!s) return '';
    let rest = null;
    if (s.startsWith(PREFIX)) rest = s.slice(PREFIX.length);
    // v3.0.0 öncesi biçim: yol host'taydı. Hiç çalışmıyordu ama kayıtlı
    // ayarlarda duruyor olabilir; en azından okunabilsin.
    else if (s.startsWith(OLD_PREFIX)) rest = s.slice(OLD_PREFIX.length);
    if (rest === null) return s;
    rest = rest.split('?')[0].split('#')[0];
    try {
      return decodeURIComponent(rest);
    } catch {
      return '';
    }
  }

  // İki yolun aynı dosyayı gösterip göstermediği. Windows'ta büyük/küçük harf
  // ayrımı yoktur; 'D:\a.mp4' ile 'd:\a.mp4' aynı dosyadır.
  function samePath(a, b) {
    const x = String(a == null ? '' : a);
    const y = String(b == null ? '' : b);
    if (!x || !y) return false;
    return isWin ? x.toLowerCase() === y.toLowerCase() : x === y;
  }

  const api = { SCHEME, HOST, PREFIX, toMediaUrl, fromMediaUrl, samePath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMediaUrl = api;
})();
