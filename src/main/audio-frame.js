'use strict';
/* SES KARESİNİN İKİLİ BİÇİMİ — yakalama yardımcısı ile ana süreç arasında.

   Yardımcı (loopback-helper.js) ayrı bir süreçte çalışıp kareleri stdout'a
   yazıyor, ana süreç (native-audio.js) okuyor. İkisi sabitleri ve yerleşimi
   buradan alıyor: biri değişip öbürü değişmeseydi kareler sessizce kayardı.

   Yerleşim (7174 bayt):
     0..1     işaret 0xAA 0x55
     2..5     örnekleme hızı, UInt32LE
     6        tayf baytları: 1024, dB ölçekli, 0..255
     1030     MONO zaman baytları: 2048, 128 merkezli, sol ve sağın ortalaması
     3078     SOL kanal: 2048
     5126     SAĞ kanal: 2048

   İKİ KANAL NEDEN (#566). Yardımcı işletim sisteminin verdiği iki kanalı
   halka tampona yazmadan ÖNCE ortalıyordu; ikinci kanalı atan bizdik.
   analysis.js stereo genişliğini ve korelasyonu hesaplayabiliyor ama hiç
   beslenmiyordu, gonyometre her şarkıda dikey bir çizgi çiziyordu.

   Mono dizi AYNEN kalıyor ve eskisi gibi hesaplanıyor: bugün onu okuyan her
   şey (bantlar, tayf, MilkDrop, dışa aktarım) aynı sayıları görüyor. İki
   kanal onun yanına ekleniyor. */

const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2; // 1024
const MARKER0 = 0xaa;
const MARKER1 = 0x55;
const OFFSET = Object.freeze({
  sampleRate: 2,
  freq: 6,
  time: 6 + BINS,
  left: 6 + BINS + FFT_SIZE,
  right: 6 + BINS + 2 * FFT_SIZE,
});
const FRAME_BYTES = 6 + BINS + 3 * FFT_SIZE;

/* Bir kaynağın (aygıt ya da uygulama) halka tamponları. Kronolojik: en yeni
   örnek sonda. Mono tampon eski yolun tamponunun kendisi — aynı ortalama,
   aynı sıra — ki mono okuyan hiçbir şeyin sayısı değişmesin. */
class SourceRings {
  constructor() {
    this.mono = new Float32Array(FFT_SIZE);
    this.left = new Float32Array(FFT_SIZE);
    this.right = new Float32Array(FFT_SIZE);
  }

  /* Yeni örnek yeri açar ve yazmaya başlanacak indisi döndürür.

     Parça tampondan UZUNSA yalnız EN YENİ 2048 örnek alınıyor. Eski yol
     burada kaydırmayı atlıyor ve parçanın EN ESKİ 2048 örneğini yazıyordu;
     aygıt geri çağrısı 512 örnek verdiği için yalnız uygulama yakalamasında,
     boru bir an tıkanıp büyük bir parça geldiğinde görülebilirdi. */
  _shift(n) {
    if (n < FFT_SIZE) {
      this.mono.copyWithin(0, n);
      this.left.copyWithin(0, n);
      this.right.copyWithin(0, n);
    }
    return FFT_SIZE - n;
  }

  /* Araya serpiştirilmiş float32 örnekler (aygıt geri çağrısı). Tek kanallı
     bir aygıtta sol ve sağ aynı örnek: mikrofon gerçekten tek kanal. */
  pushFloat32(f, nCh) {
    const ch = Math.max(1, nCh | 0);
    const samples = (f.length / ch) | 0;
    const n = Math.min(samples, FFT_SIZE);
    const w = this._shift(n);
    const skip = samples - n;
    const M = this.mono, L = this.left, R = this.right;
    for (let i = 0; i < n; i++) {
      const idx = (skip + i) * ch;
      const l = f[idx];
      if (ch > 1) {
        const r = f[idx + 1];
        M[w + i] = (l + r) * 0.5;
        L[w + i] = l;
        R[w + i] = r;
      } else {
        M[w + i] = l;
        L[w + i] = l;
        R[w + i] = l;
      }
    }
  }

  /* Uygulama yakalamasının ham akışı: float32 stereo, küçük endian. Okuma
     readFloatLE ile — Node'un havuzdan verdiği tamponun byteOffset'i 4'ün
     katı olmak zorunda değil ve hizalanmamış bir görünüm RangeError atardı. */
  pushStereoLE(buf, frames) {
    const n = Math.min(frames, FFT_SIZE);
    const w = this._shift(n);
    const skip = frames - n;
    const M = this.mono, L = this.left, R = this.right;
    for (let i = 0; i < n; i++) {
      const off = (skip + i) * 8;
      const l = buf.readFloatLE(off);
      const r = buf.readFloatLE(off + 4);
      M[w + i] = (l + r) * 0.5;
      L[w + i] = l;
      R[w + i] = r;
    }
  }

  reset() {
    this.mono.fill(0);
    this.left.fill(0);
    this.right.fill(0);
  }
}

/* Kaynakları karıştırır. Normalleştirme KARIŞTIRILAN kaynak sayısına göre
   (1/√n) ve bir kez hesaplanıyor; toplama sırası kaynak sırası — eski
   yoldaki mono karışımın birebir aynısı. */
function mixSources(out, sources, norm) {
  const count = sources.length;
  const k = typeof norm === 'number' ? norm : 1 / Math.sqrt(Math.max(1, count));
  const M = out.mono, L = out.left, R = out.right;
  for (let i = 0; i < FFT_SIZE; i++) {
    let m = 0, l = 0, r = 0;
    for (let s = 0; s < count; s++) {
      const src = sources[s];
      m += src.mono[i];
      l += src.left[i];
      r += src.right[i];
    }
    M[i] = m * k;
    L[i] = l * k;
    R[i] = r * k;
  }
}

/* -1..1 örnekleri 128 merkezli baytlara yazar. Kırpma ve yuvarlama eski
   yolunki: NaN olduğu gibi geçer ve 0 baytına düşer. */
function writeTime(buf, offset, ring) {
  for (let i = 0; i < FFT_SIZE; i++) {
    let s = ring[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    buf[offset + i] = (128 + s * 127) | 0;
  }
}

/* Bir karenin baytlarından okuyucuya giden nesne. Her dizi KOPYA: kaynak
   tampon bir sonraki kare için yeniden kullanılıyor. */
function parseFrame(frame) {
  const part = (at, n) => Uint8Array.prototype.slice.call(frame, at, at + n);
  return {
    sampleRate: frame.readUInt32LE(OFFSET.sampleRate),
    freq: part(OFFSET.freq, BINS),
    time: part(OFFSET.time, FFT_SIZE),
    left: part(OFFSET.left, FFT_SIZE),
    right: part(OFFSET.right, FFT_SIZE),
  };
}

module.exports = {
  FFT_SIZE, BINS, MARKER0, MARKER1, OFFSET, FRAME_BYTES,
  SourceRings, mixSources, writeTime, parseFrame,
};
