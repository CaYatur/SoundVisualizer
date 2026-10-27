/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Canlı kayıt — ekranda ne varsa onu yakalar.

   Çevrimdışı dışa aktarıcı (exporter) sahneyi baştan, kare kare, deterministik
   olarak yeniden çizer; bir ses dosyasının tamamını işlemek için doğru yol
   odur. Buradaki iş farklı: ŞU AN görünen şeyi, olduğu gibi, tek tuşla
   kaydetmek. Bir sahne ayarını beğendiğiniz anda onu yakalamanın başka yolu
   yok — çevrimdışı dışa aktarım o anki canlı ses girdisini yeniden üretemez.

   MediaRecorder tuvalin akışını doğrudan alır, yani kayıt ekranda görünenin
   birebir aynısıdır: modülasyon, geçişler, efektler ve haritalama dahil.

   WebM üretilir; MP4 ve GIF'e dönüştürmeyi ana süreçteki ffmpeg yapar.
   Tarayıcı MP4 kodlayamıyor, ama zaten ffmpeg paketin içinde. */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Tarayıcının desteklediği en iyi kodlayıcıyı seç
  function pickMime() {
    const wanted = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of wanted) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* yoksay */ }
    }
    return null;
  }

  class Recorder {
    constructor() {
      this.rec = null;
      this.chunks = [];
      this.startedAt = 0;
      this.limit = 0;
      this.onStop = null;
      this.error = '';
    }

    get recording() { return !!this.rec; }
    get elapsed() { return this.rec ? (performance.now() - this.startedAt) / 1000 : 0; }

    /* canvas: kaydedilecek tuval
       opts: { fps, bitrate, limit (sn), onStop(blob, mime) } */
    start(canvas, opts) {
      const o = opts || {};
      this.error = '';
      if (this.rec) return { ok: false, error: 'zaten kaydediyor' };
      if (!canvas || !canvas.captureStream) {
        this.error = 'tuval akışı desteklenmiyor';
        return { ok: false, error: this.error };
      }
      const mime = pickMime();
      if (!mime) {
        this.error = 'MediaRecorder yok';
        return { ok: false, error: this.error };
      }
      let stream;
      try {
        stream = canvas.captureStream(clamp(o.fps || 60, 5, 120));
      } catch (e) {
        this.error = String(e.message || e);
        return { ok: false, error: this.error };
      }
      try {
        this.rec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: clamp(o.bitrate || 16000000, 1000000, 80000000),
        });
      } catch (e) {
        this.rec = null;
        this.error = String(e.message || e);
        return { ok: false, error: this.error };
      }
      this.chunks = [];
      this.mime = mime;
      this.onStop = o.onStop || null;
      this.limit = o.limit || 0;
      this.startedAt = performance.now();

      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: mime });
        this.chunks = [];
        this.rec = null;
        if (this.onStop) this.onStop(blob, mime);
      };
      // Parça parça topla: uzun kayıtta tek büyük tampon tutmaktan iyi
      this.rec.start(500);
      return { ok: true, mime };
    }

    // Süre sınırı dolduysa kendiliğinden durur
    tick() {
      if (this.rec && this.limit > 0 && this.elapsed >= this.limit) this.stop();
    }

    stop() {
      if (!this.rec) return false;
      try { this.rec.stop(); } catch (e) { this.rec = null; }
      return true;
    }
  }

  /* Anlık görüntü. Tuvali PNG'ye çevirir; ölçek çarpanı verilirse önce
     büyütülür (ince ayrıntı için değil, baskı/paylaşım boyutu için). */
  function snapshot(canvas, scale) {
    if (!canvas) return null;
    const k = clamp(scale || 1, 1, 4);
    if (k === 1) return canvas.toDataURL('image/png');
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k);
    c.height = Math.round(canvas.height * k);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  /* YouTube küçük resmi (#839): 1280×720 JPEG, YouTube'un 2 MB sınırının
     altında. Kaynak 16:9 değilse ortadan kırpılıyor (küçük resim kutusunu
     doldursun, siyah bant kalmasın). Kalite 0,92'den başlayıp dosya sığana
     dek iniyor; en düşük denemede de sığmazsa o sonuç dönüyor. */
  const THUMB = { w: 1280, h: 720, maxBytes: 2 * 1024 * 1024, qualities: [0.92, 0.85, 0.75, 0.6, 0.45] };

  // data URL'nin taşıdığı bayt sayısı (base64 → ikili)
  function dataUrlBytes(url) {
    const s = String(url || '');
    const i = s.indexOf(',');
    const b64 = i >= 0 ? s.slice(i + 1) : s;
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - pad;
  }

  // Sınırın altına inen ilk kalite; encode(q) → data URL. Saf: testte sahte kodlayıcıyla.
  function pickJpeg(encode, maxBytes, qualities) {
    const qs = qualities || THUMB.qualities;
    let last = null;
    for (const q of qs) {
      last = { url: encode(q), quality: q };
      last.bytes = dataUrlBytes(last.url);
      if (last.bytes <= (maxBytes || THUMB.maxBytes)) return last;
    }
    return last;
  }

  // Kaynağı 16:9'a ortadan kırpan kaynak dikdörtgeni
  function coverRect(sw, sh, dw, dh) {
    const k = Math.max(dw / sw, dh / sh);
    const w = dw / k;
    const h = dh / k;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
  }

  function thumbnail(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const c = document.createElement('canvas');
    c.width = THUMB.w;
    c.height = THUMB.h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    const r = coverRect(canvas.width, canvas.height, THUMB.w, THUMB.h);
    x.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, THUMB.w, THUMB.h);
    return pickJpeg((q) => c.toDataURL('image/jpeg', q)).url;
  }

  /* Dışa aktarım en-boy oranı ön ayarları. Aynı sahneyi YouTube'a, Reels'e ve
     kare bir gönderiye göndermek arasındaki tek fark bu; her seferinde
     çözünürlük yazmak yerine seçilir. */
  const ASPECTS = [
    { id: '16:9', label: '16:9 (YouTube)', w: 1920, h: 1080 },
    { id: '9:16', label: '9:16 (Reels / Shorts)', w: 1080, h: 1920 },
    { id: '1:1', label: '1:1 (Kare)', w: 1080, h: 1080 },
    { id: '4:5', label: '4:5 (Gönderi)', w: 1080, h: 1350 },
    { id: '21:9', label: '21:9 (Sinemaskop)', w: 2560, h: 1080 },
    { id: '4:3', label: '4:3 (Klasik)', w: 1440, h: 1080 },
  ];

  const api = { Recorder, snapshot, thumbnail, THUMB, dataUrlBytes, pickJpeg, coverRect, pickMime, ASPECTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVRecorder = api;
})();
