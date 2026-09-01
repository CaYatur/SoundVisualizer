'use strict';
/* Onset (vuruş) algılayıcı — art arda tetiklenebilir, kare hızından bağımsız.

   Neden ayrı bir modül:
   Modlar önceden ya "seviye eşiği aştı mı" mandalı (`high && !wasHigh`) ya da
   kendi kayan ortalamalı sezgisel yöntemleriyle tetikleniyordu. İkisi de aynı
   şekilde bozuluyordu: yoğun bir parçada bas eşiğin altına hiç inmediği için
   mandal bir daha kurulmuyor, ortalamalı yöntemde de taban vuruşların üstüne
   çıkıp sonraki vuruşları yutuyordu. Sonuç, kullanıcının bildirdiği davranış:
   bir kez tetikleniyor, arkası gelmiyor.

   Buradaki algılayıcı mutlak seviyeye değil ARTIŞ HIZINA (flux) bakar:

     1. flux      = seviyedeki pozitif değişimin saniyedeki hızı
     2. taban     = flux'ın uzun zaman sabitli ortalaması (uyarlanır)
     3. eşik      = taban * oran + zemin
     4. tetik     = flux > eşik  ve  son tetikten beri >= refrakter süre

   Mutlak seviye yerine artış hızına bakıldığı için sürekli yüksek bir bas
   sonraki vuruşları maskelemez; refrakter süre (varsayılan 110 ms) tek bir
   vuruşun iki kez sayılmasını engellerken 500 BPM'e kadar art arda tetiklemeye
   izin verir.

   Zaman sabitleri dt üzerinden üstel biçimde uygulanır (alpha = 1 - e^(-dt/tau)),
   bu yüzden 30 fps ile 144 fps aynı sonucu verir; çevrimdışı dışa aktarımda da
   kare kare belirlenimli kalır. */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // dt'ye göre üstel yumuşatma katsayısı
  function alphaFor(dt, tau) {
    if (!(tau > 0)) return 1;
    return 1 - Math.exp(-Math.max(0, dt) / tau);
  }

  class Onset {
    /* opts:
         refractory  — iki tetik arası en kısa süre (sn)
         tau         — flux tabanının zaman sabiti (sn)
         ratio       — eşik = taban * ratio + floor
         floor       — sessizlikte yanlış tetiklemeyi kesen alt sınır
         gate        — kaynağın kendisi bu değerin altındaysa hiç tetikleme */
    constructor(opts) {
      const o = opts || {};
      this.refractory = o.refractory == null ? 0.11 : o.refractory;
      this.tau = o.tau == null ? 0.55 : o.tau;
      this.ratio = o.ratio == null ? 1.35 : o.ratio;
      this.floor = o.floor == null ? 0.35 : o.floor;
      this.gate = o.gate == null ? 0.02 : o.gate;
      this.reset();
    }

    reset() {
      this.prev = 0;
      this.base = 0;
      this.since = this.refractory; // ilk vuruş beklemesin
      this.last = 0;      // son tetiğin şiddeti (0..1)
      this.energy = 0;    // tetikten sonra sönen zarf — görsel süreklilik için
      this.levelBase = 0; // seviyenin uzun vadeli tabanı (şiddet hesabı için)
      this.count = 0;     // toplam tetik sayısı (test ve arayüz için)
      this.started = false;
    }

    /* Tek bir skaler kaynaktan (ör. audio.bass) tetik üretir.
       Dönüş: tetik yoksa 0, varsa şiddet (0..1). */
    push(value, dt) {
      const step = clamp(dt || 0.016, 1 / 1000, 0.25);
      const v = clamp(+value || 0, 0, 8);

      // İlk karede önceki değer yok; artışı vuruş sanmayalım
      if (!this.started) {
        this.started = true;
        this.prev = v;
        this.since += step;
        return 0;
      }
      const flux = Math.max(0, v - this.prev) / step; // birim: 1/sn
      this.prev = v;
      return this.pushFlux(flux, step, v);
    }

    /* Spektrumdan (bar dizisi) tetik: bantlar arası pozitif farkların toplamı.
       Geniş bantlı vuruşları (davul, hi-hat) tek bir bandın seviyesinden çok
       daha güvenilir yakalar. */
    pushSpectrum(bars, dt) {
      const step = clamp(dt || 0.016, 1 / 1000, 0.25);
      if (!bars || !bars.length) { this.since += step; return 0; }
      if (!this._spec || this._spec.length !== bars.length) {
        this._spec = new Float32Array(bars.length);
        for (let i = 0; i < bars.length; i++) this._spec[i] = bars[i];
        this.since += step;
        return 0;
      }
      let flux = 0;
      let sum = 0;
      for (let i = 0; i < bars.length; i++) {
        const d = bars[i] - this._spec[i];
        if (d > 0) flux += d;
        this._spec[i] = bars[i];
        sum += bars[i];
      }
      return this.pushFlux(flux / step, step, sum / bars.length);
    }

    /* Ortak karar adımı: uyarlanır eşik + refrakter süre.
       flux birimi 1/sn, level yalnızca sessizlik kapısı için kullanılır. */
    pushFlux(flux, dt, level) {
      const step = clamp(dt || 0.016, 1 / 1000, 0.25);
      this.since += step;
      this.energy = Math.max(0, this.energy - step * 2.2);

      const a = alphaFor(step, this.tau);
      this.base += (flux - this.base) * a;
      // Seviyenin uzun vadeli tabanı yalnızca ŞİDDET hesabında kullanılır;
      // karar akıya bakar. Zaman sabiti uzun tutulur ki tek bir vuruş tabanı
      // kendi tepesine çekmesin.
      if (level != null) this.levelBase += (level - this.levelBase) * alphaFor(step, 1.6);

      if (level != null && level < this.gate) return 0;
      const thr = this.base * this.ratio + this.floor;
      if (flux <= thr || this.since < this.refractory) return 0;

      this.since = 0;
      this.count++;
      /* Şiddet iki bilgiden gelir:
           amp — vuruşun tabandan ne kadar yükseldiği (mutlak, kare hızından
                 bağımsız); güçlü vuruşu yumuşak vuruştan ayıran budur
           ovr — eşiğin ne kadar aşıldığı (bağıl); amp yoksa yine de bir
                 dereceleme kalsın diye küçük ağırlıkla katılır
         Akı eşiği katbekat aştığında bağıl terim doyuma gittiği için tek
         başına kullanılamaz — bu yüzden ağırlığı düşüktür. */
      const amp = level == null ? 0.5 : clamp(level - this.levelBase, 0, 1);
      const ovr = clamp((flux - thr) / (thr * 4 + 1e-6), 0, 1);
      const strength = clamp(0.12 + 0.76 * amp + 0.12 * ovr, 0, 1);
      this.last = strength;
      this.energy = Math.max(this.energy, strength);
      return strength;
    }
  }

  /* Sürekli tetik akışı üreten yardımcı: sahne uzun süre sessiz kalırsa
     görsel tamamen boşalmasın diye çok seyrek bir "nefes" tetiği verir.
     Sessizlikte değil, yalnızca ses varken çalışır. */
  class Pulse {
    constructor(period) {
      this.period = period == null ? 1.4 : period;
      this.acc = 0;
    }
    push(level, dt, quietFor) {
      this.acc += dt || 0;
      if (level > 0.05 && quietFor > this.period && this.acc >= this.period) {
        this.acc = 0;
        return Math.min(0.55, 0.2 + level * 0.6);
      }
      if (this.acc > this.period * 4) this.acc = 0;
      return 0;
    }
  }

  const api = { Onset, Pulse, alphaFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVOnset = api;
})();
