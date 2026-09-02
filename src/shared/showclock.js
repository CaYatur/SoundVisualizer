'use strict';
/* Gösteri saati — oynatma kafasının konumunu TÜM pencerelerde aynı yapar.
 *
 * SORUN: zaman çizelgesi paneldeki taşımada yaşıyor, ama görselleştirici
 * pencereleri ayrı süreçler. Panel her karede zamanı IPC ile yollasaydı hem
 * trafik ağır olurdu hem de pencereler mesajlar arasında birbirinden kayardı.
 *
 * ÇÖZÜM: panel yalnızca DURUM DEĞİŞTİĞİNDE bir çıpa yollar
 * ({ playing, time, epoch, rate, loop }). Her pencere o çıpadan zamanı
 * KAPALI FORMÜLLE hesaplar. İki pencere aynı `Date.now()` değerini gördüğü
 * için aynı sonucu bulur; kayma imkânsızdır, periyodik mesaj gerekmez.
 *
 * DİKKAT — bu duvar saatidir ve YALNIZCA CANLI yol içindir.
 * Çevrimdışı dışa aktarım bunu KULLANMAZ: orada `Transport.advance(1/fps)`
 * kare indeksinden ilerler, çünkü aynı gösteri iki kez işlendiğinde aynı
 * kareleri üretmek zorundadır. Duvar saatiyle bu mümkün olmazdı.
 * (bkz. tests/timeline.test.js — "taşıma duvar saatini değil verilen dt'yi
 * kullanır" ve "çevrimdışı işleme iki koşuda aynı" testleri.)
 */
(function () {
  function num(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
  }

  /* Duran bir gösterinin çıpası. */
  function idle() {
    return { playing: false, time: 0, epoch: 0, rate: 1, loop: null };
  }

  /* Paneldeki taşımadan çıpa üret. `nowMs` çağıranın saat okuması —
     test edilebilirlik için dışarıdan alınır. */
  function anchorFrom(transport, nowMs, loop) {
    return {
      playing: !!(transport && transport.playing),
      time: Math.max(0, num(transport && transport.time, 0)),
      epoch: num(nowMs, 0),
      rate: num(transport && transport.rate, 1) || 1,
      loop:
        loop && loop.enabled && loop.end > loop.start
          ? { enabled: true, start: num(loop.start, 0), end: num(loop.end, 0) }
          : null,
    };
  }

  /* Döngü sarması. `advance()` ile AYNI modülo mantığı: tek bir adımda döngü
     boyundan fazla ilerlense bile doğru yere düşer, döngü başına saplanmaz.
     İki yerde iki farklı sarma olsaydı panel ile pencere ayrışırdı. */
  function wrap(t, loop) {
    if (!loop || !loop.enabled) return Math.max(0, t);
    const span = loop.end - loop.start;
    if (!(span > 0)) return Math.max(0, t);
    if (t >= loop.end) return loop.start + ((t - loop.start) % span);
    if (t < loop.start) return loop.end - ((loop.start - t) % span);
    return t;
  }

  /* Çıpadan o andaki zaman. Duruyorsa çıpanın zamanı; oynuyorsa çıpadan bu
     yana geçen gerçek süre kadar ileri. */
  function resolve(anchor, nowMs) {
    if (!anchor) return 0;
    if (!anchor.playing) return Math.max(0, num(anchor.time, 0));
    const elapsed = Math.max(0, (num(nowMs, 0) - num(anchor.epoch, 0)) / 1000);
    return wrap(num(anchor.time, 0) + elapsed * (num(anchor.rate, 1) || 1), anchor.loop);
  }

  const api = { idle, anchorFrom, resolve, wrap };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVShowClock = api;
})();
