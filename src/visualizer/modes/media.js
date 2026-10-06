/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Medya katmanı: web kamerası veya video dosyası sahneye katman olarak girer.

   Kendi <video> öğesini yönetir, kareyi verilen 2D bağlama çizer ve sese göre
   yakınlaşma/saydamlık nabzı, ayna, kaleydoskop, renk kayması uygular. Aynı
   <video> öğesi shader motoruna sv_media (iChannel3) olarak da bağlanabilir.

   Video dosyaları sv-media:// özel protokolü üzerinden okunur: sayfa file://
   veya http:// olsun fark etmez, CSP tek bir kaynağa izin vermekle yetinir. */
(function () {
  /* getUserMedia reddi çoğu zaman yalnızca konsola düşüyordu. Adı bilinen
     hatalar panele düz cümle olarak gider. */
  function cameraFaultText(err) {
    const name = (err && err.name) || '';
    const msg = err && err.message ? String(err.message) : (err ? String(err) : '');
    if (name === 'NotReadableError' || name === 'TrackStartError'
      || /could not start video source|device in use|in use|busy/i.test(msg)) {
      return 'Bu kamera başka bir uygulama tarafından kullanılıyor.';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Kamera izni verilmedi. Sistem ayarlarından izin verin.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return 'Seçilen kamera bulunamadı. Listeden başka bir kamera seçin.';
    }
    if (name === 'AbortError') return 'Kamera açılışı yarıda kesildi. Yeniden deneyin.';
    if (!msg) return 'Kamera açılamadı.';
    return 'Kamera açılamadı: ' + msg;
  }

  /* Video dosyası hatası. Uygulama videoyu varsayılan olarak yazılımla
     çözüyor (bkz. src/main/video-decode.js); Chromium HEVC/H.265'i yalnız
     donanımla oynattığı için o videolar "desteklenmeyen kaynak" verir.
     Kullanıcı nedenini ve çaresini görsün, ham Chromium iletisini değil. */
  function videoFaultText(err) {
    const code = err && typeof err.code === 'number' ? err.code : 0;
    const name = (err && err.name) || '';
    if (code === 4 || name === 'NotSupportedError') {
      return 'Bu video biçimi oynatılamıyor. HEVC/H.265 ise Ayarlar → Uygulama → Donanım Video Çözme\'yi açıp uygulamayı yeniden başlatın.';
    }
    const msg = err && err.message ? String(err.message) : String(err || '');
    return 'Video açılamadı: ' + msg;
  }

  // Metni verilen genişliğe sığan satırlara böler (sözcük sınırından)
  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function overlayMediaSrc(file, http, token) {
    const s = String(file || '');
    if (!http) return s;
    if (s.startsWith('/media-file') || /^https?:\/\//.test(s)) return s;
    const q = new URLSearchParams();
    q.set('v', s);
    if (token) q.set('token', token);
    return '/media-file?' + q.toString();
  }

  /* OBS kamerayı kendi tarayıcısından açmaz. Masaüstü akışı JPEG kare
     olarak yayınlar; yayın sayfası aynı cihaz anahtarıyla bu kareyi çizer. */
  const relaySlots = new Map();
  function relaySlot(key) {
    const id = String(key || '');
    let slot = relaySlots.get(id);
    if (!slot) {
      slot = { img: new Image(), pending: '', queued: '', at: 0, ready: false, remoteError: '' };
      relaySlots.set(id, slot);
    }
    return slot;
  }
  function paintRelaySlot(slot, b64) {
    slot.pending = b64;
    slot.img.onload = () => {
      slot.ready = true;
      slot.at = Date.now();
      slot.pending = '';
      const next = slot.queued;
      slot.queued = '';
      if (next) paintRelaySlot(slot, next);
    };
    slot.img.onerror = () => { slot.pending = ''; };
    slot.img.src = 'data:image/jpeg;base64,' + b64;
  }
  function noteCamFrame(key, b64) {
    if (!b64) return;
    const slot = relaySlot(key);
    if (slot.pending) { slot.queued = b64; return; }
    paintRelaySlot(slot, b64);
  }
  function noteCamStatus(key, error, ready) {
    const slot = relaySlot(key);
    if (ready) slot.remoteError = '';
    else if (error) slot.remoteError = String(error);
  }

  const mediaReports = new Map();

  function noteMediaStatus(st) {
    if (!st || !st.slot) return;
    mediaReports.set(st.slot, {
      source: st.source || 'webcam',
      deviceId: st.deviceId || '',
      error: st.error || '',
      ready: !!st.ready,
    });
    if (!window.SVPanel || typeof window.SVPanel.rerender !== 'function') return;
    if (window.__svMediaPoke) return;
    window.__svMediaPoke = true;
    const fire = () => {
      window.__svMediaPoke = false;
      try { window.SVPanel.rerender(); } catch { /* panel kapandı */ }
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(fire);
    else setTimeout(fire, 0);
  }

  /* Aynı aygıtta bir rapor hazırsa uyarı yok: önizleme açtıysa çıkış
     penceresinin "meşgul" hatası bizim kendi akışımızdır. */
  function mediaWarning(deviceId) {
    const id = deviceId || '';
    let err = '';
    let ready = false;
    for (const st of mediaReports.values()) {
      if (st.source === 'file') continue;
      if ((st.deviceId || '') !== id) continue;
      if (st.ready) ready = true;
      else if (st.error) err = st.error;
    }
    return ready ? '' : err;
  }

  class MediaLayer {
    constructor() {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.autoplay = true;
      /* anonymous şart: aksi halde tuval ve sv_media dokusu lekelenir.
         Şema corsEnabled olmadan Electron 43 bu isteği reddeder. */
      this.video.crossOrigin = 'anonymous';
      this.stream = null;
      this.key = '';
      this.ready = false;
      this.error = null;
      this._source = 'webcam';
      this._deviceId = '';
      this.scratch = null;
      this.sctx = null;
    }

    // Yapılandırma değiştiğinde kaynağı (yeniden) kurar. Aynı kaynak için
    // tekrar çağrılması ucuzdur: anahtar değişmediyse hiçbir şey yapmaz.
    apply(m) {
      const cfg = m || {};
      const key = [cfg.enabled ? '1' : '0', cfg.source, cfg.deviceId || '', cfg.deviceLabel || '', cfg.file || '', cfg.loop ? 1 : 0].join('|');
      if (key === this.key) return;
      this.key = key;
      this._source = cfg.source === 'file' ? 'file' : 'webcam';
      this._deviceId = this._source === 'file' ? (cfg.file || '') : (cfg.deviceId || '');
      this.stop();
      if (!cfg.enabled) return;

      this.video.loop = cfg.loop !== false;
      if (cfg.source === 'file') {
        if (!cfg.file) return;
        this.video.srcObject = null;
        /* Oynatma sırasında çıkan hata (bozuk dosya, çözülemeyen biçim)
           play() sözünden sonra gelir; dinlenmezse panel "hazır" kalırdı. */
        this.video.onerror = () => { this._fail(key, this.video.error); };
        this.video.src = this._sourceUrl(cfg.file);
        this.video.play().then(() => {
          if (this.key !== key) return;
          this.ready = true;
          this.error = null;
          this._publish();
        }).catch((e) => { this._fail(key, e); });
      } else if (this._webPage()) {
        this._relay = true;
        this._armRelay(key);
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          this.error = 'Kamera erişimi bu ortamda kullanılamıyor.';
          this._publish();
          return;
        }
        const constraints = { audio: false, video: cfg.deviceId ? { deviceId: { exact: cfg.deviceId } } : true };
        navigator.mediaDevices
          .getUserMedia(constraints)
          .then((stream) => {
            if (this.key !== key) {
              if (stream) stream.getTracks().forEach((t) => t.stop());
              return false;
            }
            this.stream = stream;
            this.video.src = '';
            this.video.srcObject = stream;
            return this.video.play().then(() => true);
          })
          .then((ok) => {
            if (!ok || this.key !== key) return;
            this.ready = true;
            this.error = null;
            this._publish();
            this._startRelayPump(key);
          })
          .catch((e) => { this._fail(key, e); });
      }
    }

    _webPage() {
      return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
    }

    /* Yayın sayfası getUserMedia çağırmaz. Kare uygulama penceresinden gelir. */
    _armRelay(key) {
      const pull = () => {
        if (this.key !== key) return;
        const slot = relaySlots.get(this._deviceId || '');
        const fresh = slot && slot.ready && slot.at && (Date.now() - slot.at) < 1500;
        if (fresh && slot.img.naturalWidth) {
          this._paintPlate(slot.img);
          if (!this.ready || this.error) {
            this.ready = true;
            this.error = null;
            this._publish();
          }
        } else {
          const err = (slot && slot.remoteError) || 'Kamera görüntüsü uygulamadan bekleniyor.';
          if (this.ready || this.error !== err) {
            this.ready = false;
            this.error = err;
            this._publish();
          }
        }
        this._relayTimer = setTimeout(pull, 80);
      };
      pull();
    }

    _paintPlate(img) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return;
      if (!this._plate) {
        this._plate = document.createElement('canvas');
        this._plateCtx = this._plate.getContext('2d', { alpha: false });
      }
      if (this._plate.width !== w || this._plate.height !== h) {
        this._plate.width = w;
        this._plate.height = h;
      }
      this._plateCtx.drawImage(img, 0, 0, w, h);
    }

    /* Aynı kamerayı hem önizleme hem çıkış penceresi açmış olabilir.
       Kareyi bir tanesi yollar; diğeri kısa aralıklarla sahipliği dener. */
    _startRelayPump(key) {
      const api = window.api;
      if (!api || typeof api.claimCamRelay !== 'function' || typeof api.sendCamFrame !== 'function') return;
      const tick = () => {
        if (this.key !== key || this._webPage()) return;
        const id = this._deviceId || '';
        api.claimCamRelay(id).then((ok) => {
          if (this.key !== key) {
            if (ok && api.releaseCamRelay) api.releaseCamRelay(id);
            return;
          }
          if (ok && !this._pump) {
            this._relayKey = id;
            this._pump = setInterval(() => this._sendCamFrame(), 80);
          } else if (!ok && this._pump) {
            /* Yayın katmanı ayrıldı ya da kareyi başka pencere yolluyor:
               kodlamayı bırak, sahipliği yeniden denemeye devam et. */
            clearInterval(this._pump);
            this._pump = null;
            if (this._relayKey != null && api.releaseCamRelay) api.releaseCamRelay(this._relayKey);
            this._relayKey = null;
          }
        }).catch(() => {});
        this._claimTimer = setTimeout(tick, this._pump ? 2000 : 400);
      };
      tick();
    }

    _sendCamFrame() {
      if (this._encoding || !this.hasFrame() || !window.api || !window.api.sendCamFrame) return;
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;
      if (!vw || !vh) return;
      const scale = Math.min(1, 960 / vw);
      const w = Math.max(2, Math.round(vw * scale));
      const h = Math.max(2, Math.round(vh * scale));
      if (!this._cap) {
        this._cap = document.createElement('canvas');
        this._capCtx = this._cap.getContext('2d', { alpha: false });
      }
      if (this._cap.width !== w || this._cap.height !== h) {
        this._cap.width = w;
        this._cap.height = h;
      }
      this._capCtx.drawImage(this.video, 0, 0, w, h);
      this._encoding = true;
      this._cap.toBlob((blob) => {
        this._encoding = false;
        if (!blob || !this._pump) return;
        blob.arrayBuffer().then((buf) => {
          if (!this._pump || !window.api || !window.api.sendCamFrame) return;
          window.api.sendCamFrame({ key: this._deviceId || '', jpeg: new Uint8Array(buf) });
        }).catch(() => {});
      }, 'image/jpeg', 0.72);
    }

    _stopRelay() {
      if (this._pump) { clearInterval(this._pump); this._pump = null; }
      if (this._claimTimer) { clearTimeout(this._claimTimer); this._claimTimer = null; }
      if (this._relayTimer) { clearTimeout(this._relayTimer); this._relayTimer = null; }
      this._encoding = false;
      this._relay = false;
      if (this._relayKey != null && window.api && typeof window.api.releaseCamRelay === 'function') {
        try { window.api.releaseCamRelay(this._relayKey); } catch { /* pencere kapanıyor */ }
      }
      this._relayKey = null;
    }

    _fail(key, err) {
      if (this.key !== key) return;
      this.ready = false;
      this.error = this._source === 'file' ? videoFaultText(err) : cameraFaultText(err);
      this._publish();
    }

    _publish() {
      const who = (typeof window.SV_DISPLAY_ID !== 'undefined' && window.SV_DISPLAY_ID != null)
        ? ('out:' + window.SV_DISPLAY_ID) : 'preview';
      const payload = {
        type: 'media-status',
        slot: who + '|' + (this._source || 'webcam') + '|' + (this._deviceId || ''),
        source: this._source || 'webcam',
        deviceId: this._deviceId || '',
        error: this.error || '',
        ready: !!this.ready,
      };
      if (typeof window.SVMediaStatus === 'function') window.SVMediaStatus(payload);
      try {
        if (window.api && typeof window.api.sendMessage === 'function') window.api.sendMessage(payload);
      } catch { /* yönetim penceresinde bu kanal yok */ }
      if (!this._webPage() && this._source !== 'file' && window.api && typeof window.api.sendCamStatus === 'function') {
        try {
          window.api.sendCamStatus({
            key: this._deviceId || '',
            error: this.error || '',
            ready: !!this.ready,
          });
        } catch { /* yayın kapalı */ }
      }
    }

    /* Aynı yapılandırma iki farklı ortamda açılıyor.

       Masaüstü penceresi sayfayı file:// üzerinden yükler ve videoyu
       sv-media:// özel protokolünden okur. OBS tarayıcı kaynağı ise sayfayı
       yayın sunucusundan http:// ile alır; orada özel protokol diye bir şey
       yoktur, dosyayı sunucunun /media-file yolu servis eder. */
    _sourceUrl(file) {
      const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
      let token = '';
      try { token = new URLSearchParams(location.search).get('token') || ''; } catch { /* */ }
      return overlayMediaSrc(file, http, token);
    }

    stop() {
      this._stopRelay();
      this.ready = false;
      this.error = null;
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      try {
        this.video.onerror = null;
        this.video.pause();
        this.video.srcObject = null;
        this.video.removeAttribute('src');
        this.video.load();
      } catch { /* öğe zaten temiz */ }
      this._publish();
    }

    hasFrame() {
      if (this._relay) return !!(this.ready && this._plate && this._plate.width > 0);
      return this.video.readyState >= 2 && this.video.videoWidth > 0;
    }

    /* Shader sv_media tuvali de video öğesini de örnekleyebilir.
       Yayın katmanında kaynak, uygulamanın yolladığı karenin tuvalidir. */
    drawable() {
      if (this._relay && this._plate && this._plate.width > 0) return this._plate;
      return this.video;
    }

    // Kareyi hedef bağlama çizer
    draw(ctx, audio, cfg, W, H, t) {
      const m = cfg.media || {};
      if (!m.enabled) return;
      if (!this.hasFrame()) {
        if (this.error && ctx && ctx.fillText) {
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#ffb4b4';
          ctx.font = Math.max(16, Math.round(Math.min(W, H) * 0.045)) + 'px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const shown = (typeof window !== 'undefined' && window.SVI18n && typeof window.SVI18n.t === 'function')
            ? window.SVI18n.t(this.error) : this.error;
          /* Uzun ileti (ör. HEVC çaresi) tek satırda tuvalin dışına
             taşıyordu; genişliğe göre satırlara bölünür. */
          const size = Math.max(16, Math.round(Math.min(W, H) * 0.045));
          const lines = wrapText(ctx, String(shown), W * 0.86);
          const y0 = H / 2 - ((lines.length - 1) * size * 1.3) / 2;
          lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + i * size * 1.3));
          ctx.restore();
        }
        return;
      }

      const pic = this.drawable();
      const vw = pic.videoWidth || pic.width;
      const vh = pic.videoHeight || pic.height;
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
      if (slices >= 3) this._drawKaleido(ctx, pic, W, H, vw, vh, slices, zoom, t);
      else this._drawFit(ctx, pic, W, H, vw, vh, m.fit, zoom, !!m.mirror);

      ctx.restore();
    }

    _drawFit(ctx, pic, W, H, vw, vh, fit, zoom, mirror) {
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
      ctx.drawImage(pic, dx, dy, dw, dh);
    }

    // Kaleydoskop: kaynağın bir dilimi merkez etrafında N kez aynalanır
    _drawKaleido(ctx, pic, W, H, vw, vh, slices, zoom, t) {
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
        ctx.drawImage(pic, -dw * 0.5, -dh * 0.5, dw, dh);
        ctx.restore();
      }
    }

    dispose() {
      this.stop();
      this.key = '';
    }
  }

  window.SVMedia = MediaLayer;
  window.SVMediaFault = cameraFaultText;
  window.SVVideoFault = videoFaultText;
  window.SVMediaWrap = wrapText;
  window.SVMediaStatus = noteMediaStatus;
  window.SVMediaWarning = mediaWarning;
  window.SVCamFrame = noteCamFrame;
  window.SVCamStatus = noteCamStatus;
  window.SVOverlayMediaSrc = overlayMediaSrc;
})();
