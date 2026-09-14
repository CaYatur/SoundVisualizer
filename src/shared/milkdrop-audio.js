'use strict';
/* MilkDrop'un ses ölçeği — İKİ YOL.

   `MilkdropBands` (dosyanın sonunda): "MilkDrop uyumu" açıkken. MilkDrop'un
   kendi zinciri: ham dalga biçimi, kendi FFT'si, kendi bantları ve
   ortalamaları.

   `MilkdropAudio` (hemen aşağıda): uyum kapalıyken ya da zaman verisi
   yokken. Görselleştiricinin bantlarından bir YAKLAŞIM; aşağıdaki metin
   onun gerekçesi.

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
   ikincisi yumuşatılmış hali (MilkDrop'ta ~21 ms'de yükselip ~48 ms'de
   düşen bir ortalama; bu yaklaşım 0,45 sn kullanıyor). Presetler ikisini bilerek
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

  /* FFT'nin sabit tabloları. Tayf dalgaları da bantlar da MilkDrop'ta AYNI
     kurulumu kullanıyor, `FFT(576, 512, equalize = true, envelopePower = 1)`:
       - bantlar (plugin.h): `mdfft{NUM_AUDIO_BUFFER_SAMPLES, NUM_FFT_SAMPLES, true, 1.0f}`
       - tayf dalgaları (pluginshell.h): `m_fftobj{NUM_AUDIO_BUFFER_SAMPLES, NUM_FREQUENCIES}`,
         yani varsayılanlar — ve fft.h:60'taki bildirimde varsayılan `1.0f`.
     Aynı başlıktaki yorum "varsayılan -1,0" (pencere yok) diyor; derleyicinin
     kullandığı bildirim, yorum değil. İkisinde de Hann penceresi ve
     eşitleyici var. */
  function fftTables() {
    // Hann penceresi (envelopePower = 1)
    const env = new Float32Array(SPEC_IN);
    for (let i = 0; i < SPEC_IN; i++) {
      env[i] = 0.5 + 0.5 * Math.sin(i * (2 * Math.PI / SPEC_IN) - Math.PI / 2);
    }
    // Esitleyici — dusuk gozde 0, en ust gozde ~0,125
    const eq = new Float32Array(SPEC_OUT);
    for (let i = 0; i < SPEC_OUT; i++) {
      eq[i] = -0.02 * Math.log((SPEC_OUT - i) / SPEC_OUT);
    }
    // Bit ters cevirme dizini
    const rev = new Uint16Array(SPEC_N);
    const bits = Math.log2(SPEC_N);
    for (let i = 0; i < SPEC_N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    return { env, eq, rev };
  }

  /* 576 örneklik girdiden MilkDrop ölçeğinde 512 göz: pencere, 576'dan
     sonrası sıfır 1024 noktalı FFT (1/N YOK), büyüklük, eşitleyici. İki
     yolun farkı burada değil GİRDİDE: tayf dalgalarına yumuşatılmış,
     bantlara ham örnek giriyor. */
  function transform(src, t, re, im, out) {
    const rev = t.rev, env = t.env, eq = t.eq;
    im.fill(0);
    for (let i = 0; i < SPEC_N; i++) {
      const k = rev[i];
      re[i] = k < SPEC_IN ? src[k] * env[k] : 0;
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
    for (let i = 0; i < SPEC_OUT; i++) {
      out[i] = eq[i] * Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    return out;
  }

  class MilkdropSpectrum {
    constructor() {
      this.out = new Float32Array(SPEC_OUT);
      this._re = new Float32Array(SPEC_N);
      this._im = new Float32Array(SPEC_N);
      this._w = new Float32Array(SPEC_IN);
      this._t = fftTables();
      this._env = this._t.env;
      this._eq = this._t.eq;
      this._rev = this._t.rev;
    }

    /* timeBytes: 128 merkezli isaretsiz bayt dizisi, kronolojik (en yeni
       ornek sonda). Donus: MilkDrop olceginde 512 gozluk buyukluk dizisi.

       EN YENI 576 ORNEK. MilkDrop'un `fWaveform`i o anki son 576 ornek;
       burada 2048'lik tamponun BASINDAN, yani en eski 576 ornekten
       okunuyordu — sesin ~30 ms (48 kHz'de 1472 ornek) gerisinden. 576'dan
       kisa bir tampon, onceki gibi basa sararak okunuyor. */
    update(timeBytes) {
      const out = this.out;
      const n = timeBytes ? timeBytes.length : 0;
      if (n < 8) { out.fill(0); return out; }
      const w = this._w;
      const off = n > SPEC_IN ? n - SPEC_IN : 0;
      /* Ikili yumusatma. `prev` ilk adimda ornegin KENDISI: MilkDrop'ta
         `old_i` sifirdan basliyor, yani ilk ornek kendisiyle ortalaniyor
         ve degismeden geciyor. */
      let prev = (timeBytes[off] | 0) - 128;
      for (let i = 0; i < SPEC_IN; i++) {
        const cur = (timeBytes[(off + i) % n] | 0) - 128;
        w[i] = 0.5 * (cur + prev);
        prev = cur;
      }
      return transform(w, this._t, this._re, this._im, out);
    }
  }

  /* MILKDROP'UN KENDİ BANTLARI — `bass`, `mid`, `treb` ve `_att`leri.

     NEDEN: MilkDrop bu altı değeri kendi zincirinden üretiyor ve presetler
     o zincirin DAVRANIŞINA göre yazılmış. Motor ise görselleştiricinin
     bantlarını (20-160 / 160-2000 / 2000-9000 Hz; duyarlılık, bas vurgusu,
     1'de kırpma, iki yumuşatma) `MilkdropAudio` ile orana çeviriyordu.
     Aynı sentetik parça iki zincirden geçirilip ölçüldü (varsayılan ses
     ayarları, görselleştirici duyarlılığı 0,9): kick'ten sonraki 50 ms'de
     `bass` vuruşlar arasındakinden DÜŞÜKTÜ (0,93 kat; MilkDrop 2,45),
     `_att`ler vuruşta hiç yükselmiyordu (0,84-1,02 kat; MilkDrop 1,9-5,9)
     ve `above(bass, 2)` yazan bir preset hiç tetiklenmiyordu (karelerin
     %0,0'ı; MilkDrop %6,7).

     Zincir (plugin.cpp DoCustomSoundAnalysis, milkdropfs.cpp:465-470):
       1. En yeni 576 örnek, ±128 biriminde, YUMUŞATMASIZ (`fWaveform[0]`
          — tayf dalgalarının aksine).
       2. Hann penceresi, 1024 noktalı FFT, eşitleyici: `transform`.
       3. Üç bant, tayfın ALT YARISININ üçte birleri: 512 gözün [0, 85),
          [85, 170), [170, 256) aralıkları, gözler TOPLANIYOR. 48 kHz'de
          ~0-4, ~4-8, ~8-12 kHz. Eşitleyici alçak gözleri neredeyse
          sıfırlıyor — ~94 Hz'lik bir bileşen ~2 kHz'likten ~22 kat hafif
          sayılıyor — yani `bass` bas davulunun gövdesinden çok vuruşunun
          tınısını okuyor. MilkDrop'ta da öyle.
       4. `avg` (-> `_att`): yükselişte 0,2, düşüşte 0,5 katsayılı ortalama,
          30 fps için yazılmış (~21 ms'de yükselir, ~48 ms'de düşer).
       5. `long_avg`: 0,992 (~4,15 sn), ilk 50 karede 0,9.
       6. `bass = imm / long_avg`, `bass_att = avg / long_avg`;
          |long_avg| < 0,001 ise 1.
     Katsayılar MilkDrop'un `AdjustRateToFPS(r, 30, fps)` dönüşümüyle kare
     hızına uyarlanıyor: `r ^ (30 * dt)`.

     BİLEREK FARKLI OLANLAR:
       - Kanal: MilkDrop sol kanalı okuyor; bizim zaman verimiz iki kanalın
         ortalaması.
       - Örnekleme hızı: 576 örnek MilkDrop'ta 44,1 kHz'de 13 ms, bizde
         48 kHz'de 12 ms; bant sınırları frekansta ~%9 yukarıda.
       - Hizalama: MilkDrop dalga biçimini çizim için hizaladıktan SONRA
         çözümlüyor (en fazla 96 örnek kaydırma, kalan kuyruk sıfır); bu,
         pencerenin zaten sıfıra inen ucunda kalıyor.
       - Tohumlama: MilkDrop ortalamaları sıfırdan başlatıyor ve açılışta
         oranlar bir an 10-20 katına fırlıyor. Burada ortalamalar İLK SESLİ
         karede o karenin değeriyle başlıyor ve 50 karelik hızlı evre
         oradan sayılıyor — katman ses gelmeden kurulduysa müzik
         başladığında da. Sabit bir tampon ses sayılmıyor.
       - Tavan: `BAND_MAX`, aşağıda. MilkDrop'ta yok. */
  const BAND_EDGES = [0, 85, 170, 256]; // NUM_FFT_SAMPLES * i / 6, tam sayı bölmesi
  const RATE_ATT_UP = 0.2;
  const RATE_ATT_DOWN = 0.5;
  const RATE_LONG_FAST = 0.9;
  const RATE_LONG = 0.992;
  const FAST_FRAMES = 50;
  const BAND_GUARD = 0.001;
  /* TAVAN. MilkDrop'ta yok, ve gereği müzikten değil sessizlikten geliyor:
     sessizlikte `long_avg` ~4 sn'lik zaman sabitiyle sıfıra iniyor ve ses
     döndüğünde oran, o anki sesin sıfıra yakın bir ortalamaya bölümü.
     Tek bir sentetik davul parçasıyla, 60 fps'te, MilkDrop'un zinciri
     birebir koşturularak ölçüldü:
       - parçanın en büyük değeri 11,2 (treb, snare vuruşunda);
       - 8 sn'lik breakdown'dan sonraki drop'ta 18,6;
       - 10 sn sessizlikten dönüşte 55, 30 sn'den dönüşte 234;
       - katman sessizken kurulursa müzik başladığında 250 (burada
         tohumlama sayesinde parçanın kendi değerleri, en çok 11,0).
     Tavan müziğin ulaştığı en yüksek değerin ~1,6 katında: müziğe
     dokunmuyor, yalnız sessizlikten dönüşün ilk karelerini kesiyor —
     30 sn'lik sessizlikten sonra 12 kare (0,2 sn), 10 sn'likten sonra 2.
     Dönüşten sonraki ~6 sn'lik "sıcak" dönem (oranların olağanın üstünde
     kalması) MilkDrop'ta da aynı ve olduğu gibi bırakıldı. */
  const BAND_MAX = 30;

  class MilkdropBands {
    constructor() {
      this._t = fftTables();
      this._re = new Float32Array(SPEC_N);
      this._im = new Float32Array(SPEC_N);
      this._x = new Float32Array(SPEC_IN);
      this._spec = new Float32Array(SPEC_OUT);
      this.imm = [0, 0, 0];
      this.avg = [0, 0, 0];
      this.long = [0, 0, 0];
      this.frames = 0;
      this.seeded = false;
    }

    /* timeBytes: 128 merkezli işaretsiz bayt dizisi, kronolojik (en yeni
       örnek sonda). dt saniye. Dönen nesne `MilkdropAudio`nunkiyle aynı
       biçimde. */
    update(dt, timeBytes) {
      const imm = this.imm, avg = this.avg, long = this.long;
      this._analyze(timeBytes);
      if (!this.seeded) {
        if (imm[0] + imm[1] + imm[2] <= BAND_GUARD) return neutral();
        for (let b = 0; b < 3; b++) { avg[b] = imm[b]; long[b] = imm[b]; }
        this.seeded = true;
        this.frames = 0;
      } else {
        const k = 30 * (dt > 0 ? dt : 0);
        const rl = Math.pow(this.frames < FAST_FRAMES ? RATE_LONG_FAST : RATE_LONG, k);
        for (let b = 0; b < 3; b++) {
          const ra = Math.pow(imm[b] > avg[b] ? RATE_ATT_UP : RATE_ATT_DOWN, k);
          avg[b] = avg[b] * ra + imm[b] * (1 - ra);
          long[b] = long[b] * rl + imm[b] * (1 - rl);
        }
      }
      this.frames++;
      return {
        bass: rel(imm[0], long[0]), mid: rel(imm[1], long[1]), treb: rel(imm[2], long[2]),
        bass_att: rel(avg[0], long[0]), mid_att: rel(avg[1], long[1]), treb_att: rel(avg[2], long[2]),
      };
    }

    /* Üç bandın o anki toplamı (`imm`). Tampon yoksa, kısaysa ya da sabitse
       sıfır. Sabit tampon ses değil: AudioEngine ilk kare gelene kadar
       SIFIRLARLA dolu (128 değil), ±128 biriminde bu -128'lik bir doğru
       akım demek ve pencerelenmiş doğru akım alt gözlere sızıp sahte bir
       "ilk ses" tohumlardı. */
    _analyze(tb) {
      const imm = this.imm;
      imm[0] = imm[1] = imm[2] = 0;
      const n = tb ? tb.length : 0;
      if (n < SPEC_IN) return;
      const x = this._x, off = n - SPEC_IN;
      let lo = 255, hi = 0;
      for (let i = 0; i < SPEC_IN; i++) {
        const v = tb[off + i] | 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        x[i] = v - 128;
      }
      if (hi === lo) return;
      const s = transform(x, this._t, this._re, this._im, this._spec);
      for (let b = 0; b < 3; b++) {
        let sum = 0;
        for (let j = BAND_EDGES[b]; j < BAND_EDGES[b + 1]; j++) sum += s[j];
        imm[b] = sum;
      }
    }
  }

  function neutral() {
    return { bass: 1, mid: 1, treb: 1, bass_att: 1, mid_att: 1, treb_att: 1 };
  }

  function rel(v, l) {
    if (!(Math.abs(l) >= BAND_GUARD)) return 1;
    const r = v / l;
    if (!isFinite(r)) return 1;
    return r < 0 ? 0 : r > BAND_MAX ? BAND_MAX : r;
  }

  const api = {
    MilkdropAudio, approach, TAU_LONG, TAU_ATT, FLOOR, MAX,
    MilkdropSpectrum, SPEC_IN, SPEC_N, SPEC_OUT,
    MilkdropBands, BAND_EDGES, BAND_MAX, BAND_GUARD, FAST_FRAMES,
    RATE_ATT_UP, RATE_ATT_DOWN, RATE_LONG_FAST, RATE_LONG,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVMilkdropAudio = api;
})();
