'use strict';
/* MilkDrop otomatik preset geçişi — ne zaman, hangisine.
 *
 * NEDEN VARDI AMA ÇALIŞMIYORDU
 * `milkdrop.autoNext` ayarı ilk MilkDrop commit'inden beri duruyor: panel
 * yazıyor, ayar dosyasına kaydediliyor, varsayılanlarda tanımlı — ve HİÇBİR
 * YER OKUMUYORDU. Kullanıcı "2 saniye" diyor, hiçbir şey olmuyor, ortada
 * hata da yok. Ölçüldü: `autoNext=2` ile dokuz saniye sonra motorun preset
 * anahtarı değişmemiş.
 *
 * NEDEN MOTOR TARAFINDA
 * İlk akla gelen yer panel: preset listesi orada, `load()` orada. İki sebeple
 * olmaz.
 *
 *   1. Her yapılandırma gönderimi settings.json'ı SENKRON yeniden yazıyor
 *      (main.js `saveSettings`, debounce yok) ve `.milk` kaynağı onlarca
 *      kilobayt. İki saniyede bir geçiş, dakikada otuz kez tam dosya yazımı
 *      demek olurdu.
 *   2. Panelin döngüsü requestAnimationFrame; görselleştirici tam ekranda
 *      paneli ÖRTÜYOR ve örtülü pencerede rAF çalışmıyor. Yani tam da
 *      kullanıcının izlediği anda sayaç duruyordu.
 *
 * Motorun elinde ikisi de var: preset listesi görselleştiriciye zaten
 * gönderiliyor (`SVPresets.setUser`) ve çizim döngüsü zaten koşuyor.
 *
 * SAAT ÇİZİM SAATİ, DUVAR SAATİ DEĞİL
 * Sayaç `dt` ile ilerliyor. Sonucu: çevrimdışı dışa aktarımda geçişler
 * VİDEO zamanında oluyor — kullanıcının "8 saniyede bir" dediği video da
 * sekiz saniyede bir değişiyor, render'ın ne kadar sürdüğünden bağımsız.
 *
 * Saf ve durumlu: GL ya da DOM istemiyor, Node içinde sınanıyor. */
(function () {
  const ORDERS = ['sequential', 'random'];
  /* Üst sınır yalnızca ayar dosyası elle düzenlenirse diye: negatif ya da
     devasa bir sayı sayaç aritmetiğini bozmamalı. */
  const MAX_SECONDS = 600;

  function normalize(md) {
    const m = md || {};
    const s = Number(m.autoNext);
    return {
      seconds: isFinite(s) && s > 0 ? Math.min(MAX_SECONDS, s) : 0,
      order: ORDERS.indexOf(m.autoOrder) >= 0 ? m.autoOrder : 'sequential',
    };
  }

  /* Sıradaki preset. `currentId` listede yoksa (yerleşik varsayılan
     çiziliyorsa) sıradaki ilk presettir. */
  function pick(list, currentId, order, rnd) {
    const n = Array.isArray(list) ? list.length : 0;
    if (!n) return null;
    const i = list.findIndex((p) => p && p.id === currentId);
    if (order === 'random') {
      /* O an çizilen preset ELENİYOR. n taneden düzgün seçim 1/n olasılıkla
         aynı preseti veriyor ve o geçişte ekranda hiçbir şey değişmiyor:
         kullanıcı "atladı" diye değil "çalışmıyor" diye okur. Üç presetlik
         bir seçimde her üç geçişten biri böyle olurdu. */
      const others = i < 0 ? list : list.slice(0, i).concat(list.slice(i + 1));
      if (!others.length) return null;
      let k = Math.floor(rnd() * others.length);
      if (!(k >= 0)) k = 0;
      // rnd() tam olarak 1 dönerse indis taşardı; üreteç sözleşmesine güvenilmiyor
      if (k >= others.length) k = others.length - 1;
      return others[k];
    }
    return list[((i < 0 ? -1 : i) + 1 + n) % n];
  }

  class Cycle {
    constructor(rnd) {
      this.elapsed = 0;
      this.rnd = typeof rnd === 'function' ? rnd : Math.random;
      /* Son sonucun sebebi. Sayı değil kod: panelin ve testin "neden
         değişmedi" sorusunu cevaplayabilmesi için. Otomatik VJ'de aynı
         desen var ve sebebi aynı — sessiz başarısızlık en pahalı hata. */
      this.reason = 'OFF';
    }

    reset() {
      this.elapsed = 0;
    }

    /* Bir kare ilerlet. Dönüş: geçilecek preset ya da null.
       `list` MilkDrop presetleri, `currentId` o an çizilenin kimliği. */
    step(dt, md, list, currentId) {
      const o = normalize(md);
      const n = Array.isArray(list) ? list.length : 0;
      /* Kapalıyken, liste boşken ve tek presetliyken sayaç SIFIRLANIYOR:
         aksi hâlde ayar açılır açılmaz birikmiş süre yüzünden anında bir
         geçiş olurdu ve kullanıcı aralığı hiç görmezdi. */
      if (!o.seconds) { this.elapsed = 0; this.reason = 'OFF'; return null; }
      if (!n) { this.elapsed = 0; this.reason = 'EMPTY'; return null; }
      /* Tek preset: kendine geçmek preseti baştan başlatır, yani ekranda
         geçiş değil takılma görünür. */
      if (n === 1) { this.elapsed = 0; this.reason = 'ALONE'; return null; }
      this.elapsed += Math.max(0, Number(dt) || 0);
      if (this.elapsed < o.seconds) { this.reason = 'WAIT'; return null; }
      this.elapsed = 0;
      const p = pick(list, currentId, o.order, this.rnd);
      this.reason = p ? 'OK' : 'EMPTY';
      return p;
    }

    // Sıradaki geçişe kalan saniye (panelin durum satırı için)
    remaining(md) {
      const o = normalize(md);
      if (!o.seconds) return 0;
      return Math.max(0, o.seconds - this.elapsed);
    }
  }

  const api = { normalize, pick, Cycle, ORDERS, MAX_SECONDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropCycle = api;
})();
