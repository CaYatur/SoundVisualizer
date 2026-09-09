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

  /* MILKDROP'UN KENDI TAYFI.

     NEDEN: `spectrum = 1` yazan bir ozel dalga MilkDrop'ta
     `0,15 * scaling * wave_scale` ile carpilan bir tayf degeri goruyor.
     O deger MilkDrop'un kendi FFT'sinden geliyor ve BIZIMKIYLE AYNI
     OLCEKTE DEGIL: bizim `freq` dizimiz 0..1'e normallestirilmis, MilkDrop
     ise normalize edilmemis bir FFT'nin buyuklugunu kullaniyor. Kaynak
     dogruydu ama BOYUT yaklasikti — dalga dogru bicimde, yanlis buyuklukte
     ciziliyordu.

     Cozum tek yol: MilkDrop'un boru hattini oldugu gibi kurmak. Adimlar
     kaynaktan (`pluginshell.cpp` AnalyzeNewSound + `fft.cpp`):

       1. Ornekler ISARETLI ±128 biriminde (Winamp verisi 8 bit isaretli;
          bizim `timeBytes` 128 merkezli isaretsiz, yani `b - 128`).
       2. Iki katsayili yumusatma: `t[i] = 0,5 * (w[i] + w[i-1])`, ilk
          ornek kendisiyle. Kaynakta gerekcesi "yuksek frekans gurultusunu
          azaltmak".
       3. 576 ornek, Hann penceresi: `0,5 + 0,5 * sin(i*2pi/576 - pi/2)`.
       4. 1024 noktali FFT, 576'dan sonrasi SIFIR (sifir doldurma).
          NORMALLESTIRME YOK — 1/N ile bolunmuyor, buyukluk bu yuzden
          orneklerin sayisiyla olcekleniyor ve MilkDrop'un 0,15 carpani
          tam da bu olcege gore secilmis.
       5. Cikis 512 goz, her biri esitleyiciyle carpiliyor:
          `eq[i] = -0,02 * ln((512 - i) / 512)`.

     `eq[0]` TAM OLARAK SIFIR: `ln(1) = 0`. Yani her tayf dalgasinin ilk
     ornegi sifirdir; bu bir hata degil, MilkDrop'un esitleyicisinin
     tanimindan cikiyor (dusuk frekanslari bastirip yuksekleri aciyor).

     BILEREK YAKLASIK KALAN: goz -> frekans EKSENI. MilkDrop'un 576 ornegi
     kendi kaynak hizinda, bizimki AudioContext hizinda (48 kHz) geliyor;
     ayni goz numarasi iki tarafta tam ayni frekansa denk gelmiyor. Olcek
     ve egrinin bicimi dogru, eksenin frekans karsiligi yaklasik.

     Saf aritmetik: GL ya da ses dugumu istemiyor, Node icinde sinaniyor. */
  const SPEC_IN = 576;   // NUM_AUDIO_BUFFER_SAMPLES
  const SPEC_N = 1024;   // NUM_FREQUENCIES * 2 — FFT'nin nokta sayisi
  const SPEC_OUT = 512;  // NUM_FREQUENCIES — cikis gozu

  class MilkdropSpectrum {
    constructor() {
      this.out = new Float32Array(SPEC_OUT);
      this._re = new Float32Array(SPEC_N);
      this._im = new Float32Array(SPEC_N);
      this._w = new Float32Array(SPEC_IN);
      // Hann penceresi (MilkDrop'ta envelopePower = 1)
      this._env = new Float32Array(SPEC_IN);
      for (let i = 0; i < SPEC_IN; i++) {
        this._env[i] = 0.5 + 0.5 * Math.sin(i * (2 * Math.PI / SPEC_IN) - Math.PI / 2);
      }
      // Esitleyici — dusuk gozde 0, en ust gozde ~0,125
      this._eq = new Float32Array(SPEC_OUT);
      for (let i = 0; i < SPEC_OUT; i++) {
        this._eq[i] = -0.02 * Math.log((SPEC_OUT - i) / SPEC_OUT);
      }
      // Bit ters cevirme dizini
      this._rev = new Uint16Array(SPEC_N);
      const bits = Math.log2(SPEC_N);
      for (let i = 0; i < SPEC_N; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
        this._rev[i] = r;
      }
    }

    /* timeBytes: 128 merkezli isaretsiz bayt dizisi (en az 576 uzunlukta).
       Donus: MilkDrop olceginde 512 gozluk buyukluk dizisi. */
    update(timeBytes) {
      const out = this.out;
      const n = timeBytes ? timeBytes.length : 0;
      if (n < 8) { out.fill(0); return out; }
      const w = this._w;
      /* Ikili yumusatma. `prev` ilk adimda ornegin KENDISI: MilkDrop'ta
         `old_i` sifirdan basliyor, yani ilk ornek kendisiyle ortalaniyor
         ve degismeden geciyor. */
      let prev = (timeBytes[0] | 0) - 128;
      for (let i = 0; i < SPEC_IN; i++) {
        const cur = (timeBytes[i % n] | 0) - 128;
        w[i] = 0.5 * (cur + prev);
        prev = cur;
      }
      const re = this._re, im = this._im, rev = this._rev, env = this._env;
      im.fill(0);
      for (let i = 0; i < SPEC_N; i++) {
        const k = rev[i];
        re[i] = k < SPEC_IN ? w[k] * env[k] : 0;
      }
      // Yerinde radix-2 kelebek dongusu
      for (let size = 2; size <= SPEC_N; size <<= 1) {
        const half = size >> 1;
        const ang = -2 * Math.PI / size;
        const wpr = Math.cos(ang), wpi = Math.sin(ang);
        let wr = 1, wi = 0;
        for (let m = 0; m < half; m++) {
          for (let i = m; i < SPEC_N; i += size) {
            const j = i + half;
            const tr = re[j] * wr - im[j] * wi;
            const ti = re[j] * wi + im[j] * wr;
            re[j] = re[i] - tr; im[j] = im[i] - ti;
            re[i] += tr; im[i] += ti;
          }
          const nwr = wr * wpr - wi * wpi;
          wi = wr * wpi + wi * wpr;
          wr = nwr;
        }
      }
      const eq = this._eq;
      for (let i = 0; i < SPEC_OUT; i++) {
        out[i] = eq[i] * Math.sqrt(re[i] * re[i] + im[i] * im[i]);
      }
      return out;
    }
  }

  const api = { MilkdropAudio, approach, TAU_LONG, TAU_ATT, FLOOR, MAX, MilkdropSpectrum, SPEC_IN, SPEC_N, SPEC_OUT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropAudio = api;
})();
