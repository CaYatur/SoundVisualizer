'use strict';
/* MilkDrop'un ses ölçeğine çevirici.

   NEDEN AYRI BİR DÖNÜŞÜM GEREKİYOR:
   Görselleştiricinin ses çözümleyicisi bantları MUTLAK genlik olarak veriyor
   (0..1 arası bir ortalama). MilkDrop presetleri ise bambaşka bir şey
   bekliyor: bandın UZUN DÖNEM ORTALAMASINA ORANI. Orada 1,0 "her zamanki
   ses düzeyi" demek; sessizde 0'a iner, vuruşta 2-3'e çıkar.

   Fark akademik değil. Mutlak genlik tipik müzikte 0,2-0,4 civarında geziyor;
   preset bunu "neredeyse sessiz" diye okuyup hiç kıpırdamıyor. Presetlerin
   ölü ya da patlamış görünmesinin sebebi buydu — shader'ların doğruluğuyla
   ilgisi yok, ve düzeltilmeden hiçbir görsel karşılaştırma anlam taşımıyor.

   İKİNCİ VE DAHA SİNSİ OLANI — `_att`:
   MilkDrop `bass` ile `bass_att`i AYRI şeyler olarak veriyor: ilki anlık,
   ikincisi yarım saniyelik yumuşatılmış hali. Presetler ikisini bilerek
   karşılaştırıyor (ani vuruş ile yavaş sürüklenme). Bizde ikisi birebir aynı
   değere ayarlanmıştı, yani bu karşıtlık tümden yok olmuştu.

   Saf ve durumlu: GL bağlamı ya da ses düğümü istemiyor, bu yüzden zaman
   sabitleri Node içinde sınanabiliyor. */
(function () {
  /* Kare hızından bağımsız üstel yumuşatma. dt saniye; tau, değerin
     hedefe yaklaşma zaman sabiti. 1 - exp(-dt/tau) kullanılıyor çünkü sabit
     bir katsayı 30 fps ile 144 fps arasında bambaşka davranırdı. */
  function approach(cur, target, dt, tau) {
    if (!(tau > 0)) return target;
    const k = 1 - Math.exp(-Math.max(0, dt) / tau);
    return cur + (target - cur) * k;
  }

  /* Uzun dönem ortalamanın zaman sabiti. Çok kısa olursa ortalama anlık
     değeri kovalar ve oran hep 1'e yapışır (preset yine kıpırdamaz); çok
     uzun olursa parça değişimlerine uyum saatler alır. */
  const TAU_LONG = 6.0;
  // `_att` için: MilkDrop'un yarım saniyelik yumuşatmasına yakın
  const TAU_ATT = 0.45;
  /* Bölmede taban. Gerçek sessizlikte hem anlık hem ortalama sıfıra gider;
     tabansız 0/0 NaN üretir ve NaN bir kez preset havuzuna girdiğinde bütün
     kare siyah kalır. */
  const FLOOR = 0.02;
  // Üst sınır: bir sessizlik-sonrası patlama presetin ölçeğini uçurmasın
  const MAX = 8;

  class MilkdropAudio {
    constructor() {
      this.avg = { bass: 0, mid: 0, treb: 0 };
      this.att = { bass: 1, mid: 1, treb: 1 };
      this.seeded = false;
    }

    /* imm: çözümleyicinin verdiği mutlak bant değerleri (0..1).
       Dönen nesne doğrudan Preset.frame()'e verilebilir. */
    update(dt, imm) {
      const b = num(imm && imm.bass);
      const m = num(imm && imm.mid);
      const t = num(imm && imm.treb !== undefined ? imm.treb : imm && imm.treble);

      /* İlk karede ortalama sıfırdan başlarsa oran tavan yapıyor ve preset
         açılışta bir kare boyunca patlamış görünüyor. Onun yerine ortalama
         ilk örnekle tohumlanıyor: ilk kare tam olarak "normal" sayılıyor. */
      if (!this.seeded) {
        this.avg.bass = b; this.avg.mid = m; this.avg.treb = t;
        this.seeded = true;
      } else {
        this.avg.bass = approach(this.avg.bass, b, dt, TAU_LONG);
        this.avg.mid = approach(this.avg.mid, m, dt, TAU_LONG);
        this.avg.treb = approach(this.avg.treb, t, dt, TAU_LONG);
      }

      const bass = ratio(b, this.avg.bass);
      const mid = ratio(m, this.avg.mid);
      const treb = ratio(t, this.avg.treb);

      this.att.bass = approach(this.att.bass, bass, dt, TAU_ATT);
      this.att.mid = approach(this.att.mid, mid, dt, TAU_ATT);
      this.att.treb = approach(this.att.treb, treb, dt, TAU_ATT);

      return {
        bass, mid, treb,
        bass_att: this.att.bass,
        mid_att: this.att.mid,
        treb_att: this.att.treb,
      };
    }
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
  }

  function ratio(cur, avg) {
    const r = cur / Math.max(avg, FLOOR);
    if (!isFinite(r)) return 0;
    return r < 0 ? 0 : r > MAX ? MAX : r;
  }

  const api = { MilkdropAudio, approach, TAU_LONG, TAU_ATT, FLOOR, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropAudio = api;
})();
