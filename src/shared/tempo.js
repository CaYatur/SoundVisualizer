'use strict';
/* Tempo motoru — vuruş algılama, BPM kestirimi ve ölçü sayacı.

   Yaklaşım: spektral akı (spectral flux) → uyarlanabilir eşik → vuruş
   damgaları → aralık histogramı → BPM.

   Neden histogram: ardışık iki vuruş arasındaki süreyi doğrudan BPM'e
   çevirmek gürültüye çok açık; tek bir kaçırılan vuruş tempoyu yarıya
   düşürür. Son ~8 saniyenin TÜM aralık çiftleri bir histograma yazılır ve
   en yoğun kova seçilir; böylece tek tek hatalar oy çokluğunda erir.

   Oktav düzeltmesi: 60–180 BPM insan müziğinin ezici çoğunluğunu kapsar;
   bulunan değer bu aralığa iki katlanarak/yarılanarak çekilir (aksi halde
   aynı parça bazen 75 bazen 150 BPM görünür).

   Tamamen çevrimdışıdır ve dış bir tempo kaynağına (Ableton Link gibi)
   bağlanmaz — o protokol ayrı bir ağ yığını ister. Elle "tap tempo" ve
   BPM kilidi bu boşluğu kapatır. */
(function () {
  const HISTORY = 8; // saniye — aralık histogramının penceresi
  const MIN_BPM = 60;
  const MAX_BPM = 180;
  const MIN_GAP = 0.22; // s — bundan yakın iki vuruş tek sayılır (~270 BPM tavanı)
  const BUCKET = 0.005; // s — periyot histogramının kova genişliği (5 ms)

  class Tempo {
    constructor() {
      this.prevSpectrum = null;
      this.fluxAvg = 0;
      this.fluxVar = 0;
      this.beats = []; // son vuruşların zaman damgaları (saniye)
      this.bpm = 0;
      this.confidence = 0;
      this.phase = 0; // 0..1 — son vuruştan bu yana geçen oran
      this.beatCount = 0;
      this.barPosition = 0; // 0..beatsPerBar-1
      this.beatsPerBar = 4;
      this.lastBeat = -999;
      this.energy = 0; // vuruş enerjisi (0..1), her vuruşta sıçrar
      this.locked = 0; // >0 ise BPM elle sabitlenmiş
      this.taps = [];
      this._justFired = false;
    }

    setLock(bpm) {
      this.locked = bpm > 0 ? bpm : 0;
      if (this.locked) this.bpm = this.locked;
    }

    /* Elle tempo: kullanıcı düğmeye ritimle basar. Son 6 vuruşun ortalama
       aralığı alınır; 2 saniyeden uzun boşluk yeni bir seri başlatır. */
    tap(now) {
      const t = now == null ? performance.now() / 1000 : now;
      if (this.taps.length && t - this.taps[this.taps.length - 1] > 2) this.taps = [];
      this.taps.push(t);
      if (this.taps.length > 6) this.taps.shift();
      if (this.taps.length >= 2) {
        let sum = 0;
        for (let i = 1; i < this.taps.length; i++) sum += this.taps[i] - this.taps[i - 1];
        const avg = sum / (this.taps.length - 1);
        if (avg > 0.2 && avg < 2) {
          this.setLock(octaveFold(60 / avg));
          this.confidence = 1;
        }
      }
      return this.bpm;
    }

    /* Her karede çağrılır. audio: SVAudio örneği, t: saniye.
       Dönüş: bu karede vuruş olduysa true. */
    update(audio, t, dt) {
      this._justFired = false;
      if (!audio || !audio.ready) return false;

      // --- spektral akı: yalnızca ARTAN kovalar sayılır (onset göstergesi) ---
      const n = 96; // düşük/orta bantlar ritmi taşır
      const bars = audio.getBars(n, 30, 6000);
      if (!this.prevSpectrum || this.prevSpectrum.length !== n) {
        this.prevSpectrum = new Float32Array(n);
        this.prevSpectrum.set(bars);
        return false;
      }
      let flux = 0;
      for (let i = 0; i < n; i++) {
        const d = bars[i] - this.prevSpectrum[i];
        if (d > 0) flux += d;
        this.prevSpectrum[i] = bars[i];
      }
      flux /= n;

      // --- uyarlanabilir eşik: kayan ortalama + standart sapma ---
      const a = 0.06;
      const diff = flux - this.fluxAvg;
      this.fluxAvg += a * diff;
      this.fluxVar += a * (diff * diff - this.fluxVar);
      const sd = Math.sqrt(Math.max(1e-9, this.fluxVar));
      const threshold = this.fluxAvg + sd * 1.5 + 0.002;

      this.energy = Math.max(0, this.energy - (dt || 0.016) * 3.2);

      let fired = false;
      if (flux > threshold && t - this.lastBeat > MIN_GAP) {
        this.lastBeat = t;
        this.beats.push(t);
        this.beatCount++;
        this.barPosition = this.beatCount % this.beatsPerBar;
        this.energy = Math.min(1, 0.55 + (flux - threshold) * 12);
        fired = true;
        this._justFired = true;
        while (this.beats.length && t - this.beats[0] > HISTORY) this.beats.shift();
        if (!this.locked) this._estimate();
      }

      // --- faz: son vuruştan bu yana beklenen vuruş süresinin oranı ---
      if (this.bpm > 0) {
        const period = 60 / this.bpm;
        this.phase = Math.min(1, (t - this.lastBeat) / period);
      }
      return fired;
    }

    /* Aralık histogramından BPM.

       Histogram BPM uzayında değil, PERİYOT (saniye) uzayında tutulur.
       Sebebi ölçümle bulundu: kare kuantizasyonu (60 FPS'te ±17 ms) sabit
       bir ZAMAN sapması yaratır, ama bu sapma BPM'e çevrildiğinde temponun
       karesiyle büyür. Sabit genişlikli BPM kovalarında 128 BPM'in oyları
       124–129 arasına yayılırken 64 BPM'inkiler tek kovada toplanıyor ve
       yarım tempo kazanıyordu. Periyot uzayında yayılma her tempoda aynı.

       Tüm vuruş ÇİFTLERİ katkı verir (yalnız ardışık olanlar değil); bir
       vuruş kaçsa bile ikili/üçlü aralıklar doğru tempoyu destekler. */
    _estimate() {
      const b = this.beats;
      if (b.length < 4) return;

      const minP = 60 / MAX_BPM; // en kısa periyot (en hızlı tempo)
      const maxP = 60 / MIN_BPM;
      const nB = Math.ceil((maxP - minP) / BUCKET) + 1;
      const buckets = new Float64Array(nB);

      // Kare kuantizasyonunu tolere eden simetrik yayma çekirdeği (±15 ms)
      const KERNEL = [0.25, 0.5, 0.85, 1, 0.85, 0.5, 0.25];
      const KMID = 3;

      for (let i = 0; i < b.length; i++) {
        for (let j = i + 1; j < b.length; j++) {
          const gap = b[j] - b[i];
          if (gap < minP * 0.9 || gap > 4) continue;
          // Bu aralığın 1, 2, 3, 4 vuruşa denk gelme olasılıklarını dene
          for (let mult = 1; mult <= 4; mult++) {
            const period = gap / mult;
            if (period < minP || period > maxP) continue;
            const idx = Math.round((period - minP) / BUCKET);
            for (let k = 0; k < KERNEL.length; k++) {
              const q = idx + k - KMID;
              if (q >= 0 && q < nB) buckets[q] += KERNEL[k];
            }
          }
        }
      }

      let best = -1;
      let bestVal = 0;
      let total = 0;
      for (let i = 0; i < nB; i++) {
        total += buckets[i];
        if (buckets[i] > bestVal) { bestVal = buckets[i]; best = i; }
      }
      if (best < 0 || !bestVal) return;

      // Tepe noktasının çevresinden ağırlıklı merkez: kova genişliğinin
      // altında çözünürlük verir (aksi halde BPM 5 ms adımlarla zıplar).
      let wsum = 0;
      let psum = 0;
      for (let k = -3; k <= 3; k++) {
        const q = best + k;
        if (q < 0 || q >= nB) continue;
        wsum += buckets[q];
        psum += buckets[q] * (minP + q * BUCKET);
      }
      const period = wsum > 0 ? psum / wsum : minP + best * BUCKET;
      const found = 60 / period;

      // Yeni kestirimi yumuşat: tempo aniden zıplamasın
      this.bpm = this.bpm ? this.bpm * 0.7 + found * 0.3 : found;
      this.confidence = Math.max(0, Math.min(1, (bestVal / Math.max(1, total)) * 12));
    }

    // Bu karede vuruş oldu mu (sahne geçişleri bunu okur)
    justFired() {
      return this._justFired;
    }

    // Ölçünün başında mıyız (1. vuruş)
    onBar() {
      return this._justFired && this.barPosition === 0;
    }

    reset() {
      this.beats = [];
      this.bpm = this.locked || 0;
      this.confidence = 0;
      this.beatCount = 0;
      this.taps = [];
    }
  }

  // BPM'i 60–180 aralığına katlar (aynı parçanın 75/150 arası salınmasını önler)
  function octaveFold(bpm) {
    if (!isFinite(bpm) || bpm <= 0) return 0;
    let v = bpm;
    let guard = 0;
    while (v < MIN_BPM && guard++ < 8) v *= 2;
    guard = 0;
    while (v > MAX_BPM && guard++ < 8) v /= 2;
    return v;
  }

  const api = { Tempo, octaveFold, MIN_BPM, MAX_BPM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTempo = api;
})();
