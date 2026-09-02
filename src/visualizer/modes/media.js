'use strict';
/* Medya katmanı: web kamerası veya video dosyası sahneye katman olarak girer.

   Kendi <video> öğesini yönetir, kareyi verilen 2D bağlama çizer ve sese göre
   yakınlaşma/saydamlık nabzı, ayna, kaleydoskop, renk kayması uygular. Aynı
   <video> öğesi shader motoruna sv_media (iChannel3) olarak da bağlanabilir.

   Video dosyaları sv-media:// özel protokolü üzerinden okunur: sayfa file://
   veya http:// olsun fark etmez, CSP tek bir kaynağa izin vermekle yetinir. */
(function () {
  class MediaLayer {
    constructor() {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.autoplay = true;
      this.video.crossOrigin = 'anonymous';
      this.stream = null;
      this.key = '';
      this.ready = false;
      this.error = null;
      this.scratch = null;
      this.sctx = null;
    }

    // Yapılandırma değiştiğinde kaynağı (yeniden) kurar. Aynı kaynak için
    // tekrar çağrılması ucuzdur: anahtar değişmediyse hiçbir şey yapmaz.
    apply(m) {
      const cfg = m || {};
      const key = [cfg.enabled ? '1' : '0', cfg.source, cfg.deviceId || '', cfg.file || '', cfg.loop ? 1 : 0].join('|');
      if (key === this.key) return;
      this.key = key;
      this.stop();
      if (!cfg.enabled) return;

      this.video.loop = cfg.loop !== false;
      if (cfg.source === 'file') {
        if (!cfg.file) return;
        this.video.srcObject = null;
        this.video.src = this._sourceUrl(cfg.file);
        this.video.play().then(() => { this.ready = true; }).catch((e) => { this.error = e.message; });
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          this.error = 'Kamera erişimi bu ortamda kullanılamıyor.';
          return;
        }
        const constraints = { audio: false, video: cfg.deviceId ? { deviceId: { exact: cfg.deviceId } } : true };
        navigator.mediaDevices
          .getUserMedia(constraints)
          .then((stream) => {
            if (this.key !== key) { stream.getTracks().forEach((t) => t.stop()); return; }
            this.stream = stream;
            this.video.src = '';
            this.video.srcObject = stream;
            return this.video.play();
          })
          .then(() => { this.ready = true; })
          .catch((e) => { this.error = e && e.message ? e.message : String(e); });
      }
    }

    /* Aynı yapılandırma iki farklı ortamda açılıyor.

       Masaüstü penceresi sayfayı file:// üzerinden yükler ve videoyu
       sv-media:// özel protokolünden okur. OBS tarayıcı kaynağı ise sayfayı
       yayın sunucusundan http:// ile alır; orada özel protokol diye bir şey
       yoktur, dosyayı sunucunun /media-file yolu servis eder. */
    _sourceUrl(file) {
      const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
      if (http) return '/media-file?v=' + encodeURIComponent(file);
      return file;
    }

    stop() {
      this.ready = false;
      this.error = null;
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      try {
        this.video.pause();
        this.video.srcObject = null;
        this.video.removeAttribute('src');
        this.video.load();
      } catch { /* öğe zaten temiz */ }
    }

    hasFrame() {
      return this.video.readyState >= 2 && this.video.videoWidth > 0;
    }

    // Kareyi hedef bağlama çizer
    draw(ctx, audio, cfg, W, H, t) {
      const m = cfg.media || {};
      if (!m.enabled || !this.hasFrame()) return;

      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      const zoom = 1 + (audio ? audio.bass : 0) * (m.audioZoom || 0);
      let alpha = m.opacity == null ? 1 : m.opacity;
      if (m.audioOpacity) alpha = Math.max(0, Math.min(1, alpha * (1 - m.audioOpacity) + alpha * m.audioOpacity * (audio ? audio.bass : 0) * 2));

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.globalCompositeOperation =
        m.blend === 'screen' ? 'screen' : m.blend === 'add' ? 'lighter' : m.blend === 'multiply' ? 'multiply' : 'source-over';

      const filters = [];
      if (m.hue) filters.push(`hue-rotate(${Math.round(m.hue * 360)}deg)`);
      if (m.saturate != null && m.saturate !== 1) filters.push(`saturate(${m.saturate})`);
      if (filters.length) ctx.filter = filters.join(' ');

      const slices = Math.max(0, Math.min(12, m.kaleido | 0));
      if (slices >= 3) this._drawKaleido(ctx, W, H, vw, vh, slices, zoom, t);
      else this._drawFit(ctx, W, H, vw, vh, m.fit, zoom, !!m.mirror);

      ctx.restore();
    }

    _drawFit(ctx, W, H, vw, vh, fit, zoom, mirror) {
      let dw;
      let dh;
      if (fit === 'stretch') {
        dw = W; dh = H;
      } else {
        const scale = fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh);
        dw = vw * scale;
        dh = vh * scale;
      }
      dw *= zoom;
      dh *= zoom;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2;
      if (mirror) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, dx, dy, dw, dh);
    }

    // Kaleydoskop: kaynağın bir dilimi merkez etrafında N kez aynalanır
    _drawKaleido(ctx, W, H, vw, vh, slices, zoom, t) {
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.hypot(W, H) * 0.6;
      const wedge = (Math.PI * 2) / slices;
      const scale = (Math.max(W, H) / Math.min(vw, vh)) * zoom * 0.9;
      const dw = vw * scale;
      const dh = vh * scale;

      ctx.translate(cx, cy);
      ctx.rotate(t * 0.08);
      for (let i = 0; i < slices; i++) {
        ctx.save();
        ctx.rotate(i * wedge);
        if (i % 2 === 1) ctx.scale(1, -1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, -wedge / 2, wedge / 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(this.video, -dw * 0.5, -dh * 0.5, dw, dh);
        ctx.restore();
      }
    }

    dispose() {
      this.stop();
      this.key = '';
    }
  }

  window.SVMedia = MediaLayer;
})();
