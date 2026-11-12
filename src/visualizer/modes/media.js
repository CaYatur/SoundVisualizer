/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Medya katmanı: web kamerası, ekran veya video dosyası sahneye katman olarak girer.

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

  /* Ekran kaynağının cümleleri src/shared/screen-capture.js ile aynıdır.
     Sayfa o modülü yüklemediyse (dışa aktarım, test, yayın sayfası) yine
     de fırlatmadan aynı metin yazılır. */
  function screenFaultText(reason) {
    const M = typeof window !== 'undefined' ? window.SVScreenCapture : null;
    if (M && typeof M.faultText === 'function') {
      try { return M.faultText(reason); } catch { /* metin yedeği */ }
    }
    if (reason === 'wayland') {
      return 'Bu oturum Wayland ve X11 ekranı yok. Ekran yakalama yalnız X11 ekranında çalışır.';
    }
    if (reason === 'permission') {
      return 'Ekran kaydı izni verilmedi. Sistem ayarlarından izin verin.';
    }
    return 'Bu ortamda ekran yakalama çalışmıyor.';
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

  /* Chromium, kaynak 404 döndüğünde de "desteklenmeyen kaynak" (kod 4)
     veriyor; dosyası silinmiş bir katman HEVC çaresini gösteriyordu ve
     kullanıcı çözücü ayarıyla uğraşıyordu. Bu iki durum yalnız sunucunun
     yanıtıyla ayrılır. */
  function isFormatFault(err) {
    const code = err && typeof err.code === 'number' ? err.code : 0;
    return code === 4 || ((err && err.name) || '') === 'NotSupportedError';
  }

  // Ayardaki adresten (sv-media://local/..., /media-file?v=..., düz yol) dosya adı
  function videoName(file) {
    let s = String(file || '');
    if (s.startsWith('/media-file')) {
      try { s = new URLSearchParams(s.split('?')[1] || '').get('v') || ''; } catch { s = ''; }
    }
    const U = typeof window !== 'undefined' ? window.SVMediaUrl : null;
    if (U && typeof U.fromMediaUrl === 'function') s = U.fromMediaUrl(s);
    else if (/^sv-media:\/\//.test(s)) {
      s = s.replace(/^sv-media:\/\/(local\/)?/, '').split('?')[0].split('#')[0];
      try { s = decodeURIComponent(s); } catch { /* adı ham bırak */ }
    }
    return s.split(/[\\/]/).filter(Boolean).pop() || '';
  }

  function missingVideoText(file) {
    const name = videoName(file);
    return name ? 'Video dosyası bulunamadı: ' + name : 'Video dosyası bulunamadı.';
  }

  /* Kaynağın bir baytını ister. Yalnız 404 "dosya yok" sayılır: 403 seçili
     olmayan yol (ayar değişirken), 415/500 ya da ağ hatası biçim sorunundan
     ayrılamaz; o durumlarda eski ileti kalır. */
  function probeMissing(url) {
    if (!url || typeof fetch !== 'function') return Promise.resolve(false);
    return fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' })
      .then((res) => {
        try { if (res.body && typeof res.body.cancel === 'function') res.body.cancel(); } catch { /* */ }
        return res.status === 404;
      })
      .catch(() => false);
  }

  // Metni verilen genişliğe sığan satırlara böler (sözcük sınırından)
  /* KEN BURNS (#841): durağan bir görüntüde yavaş yakınlaşma ve kayma. Bir
     döngü `kenBurnsPeriod` saniye; yakınlaşma %0–12, kayma büyütmenin
     bıraktığı payla sınırlı (bkz. _drawFit). Yalnız çizim saatine (t)
     bağlı: aynı an canlıda da dışa aktarımda da aynı kare. Kayma kadrana
     oran olarak: { zoom, x, y }. */
  function kenBurns(m, t) {
    const amt = Math.max(0, Math.min(1, Number(m && m.kenBurns) || 0));
    if (!(amt > 0)) return { zoom: 1, x: 0, y: 0 };
    const period = Math.max(4, Number(m.kenBurnsPeriod) || 20);
    const ph = ((Number(t) || 0) / period) * Math.PI * 2;
    return {
      zoom: 1 + amt * 0.12 * (0.5 - 0.5 * Math.cos(ph)),
      x: amt * 0.05 * Math.sin(ph * 0.5 + 0.6),
      y: amt * 0.035 * Math.sin(ph * 0.5 + 2.2),
    };
  }

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
      if (st.source === 'file' || st.source === 'screen') continue;
      if ((st.deviceId || '') !== id) continue;
      if (st.ready) ready = true;
      else if (st.error) err = st.error;
    }
    return ready ? '' : err;
  }

  /* VİDEO TAŞIMA (#905): hız, giriş/çıkış noktası ve vuruşa kilitli döngü. Saatten (saniye)
     videonun konumunu veren saf işlev; canlı oynatıcı, zaman çizelgesi klibi ve dışa aktarım
     aynı formülü kullanıyor. Varsayılanlarla (hız 1, bölge yok, vuruş döngüsü yok) eski formülün
     aynısı: döngüde `s % süre`, değilse son kare. Vuruş döngüsü N vuruşluk bölümü uygulamanın
     tempo ızgarasına (cfg.modulation.bpm, yoksa 120; LFO'larla aynı) kilitliyor: bölüm her N
     vuruşta baştan başlıyor. */
  function transportTime(sec, dur, m, bpm) {
    const d = dur > 0 && isFinite(dur) ? dur : 0;
    if (!d) return 0;
    const o = m || {};
    const speed = Math.max(0.1, Math.min(4, Number(o.speed) > 0 ? Number(o.speed) : 1));
    let a = Math.max(0, Math.min(d, Number(o.inPoint) || 0));
    let b = Number(o.outPoint) > 0 ? Math.max(0, Math.min(d, Number(o.outPoint))) : d;
    if (b - a < 0.05) { a = 0; b = d; }
    const span = b - a;
    const s = Math.max(0, Number(sec) || 0) * speed;
    const beats = Math.max(0, Math.round(Number(o.loopBeats) || 0));
    if (beats > 0 && bpm > 0) return a + (s % Math.min(span, (beats * 60 / bpm) * speed));
    if (o.loop === false) return Math.min(a + s, b - 0.001);
    return a + (s % span);
  }
  // Taşıma ayarı açık mı (yoksa canlı oynatıcı eskisi gibi kendi başına oynuyor)
  function transportOn(m) {
    const o = m || {};
    return (Number(o.speed) > 0 && Number(o.speed) !== 1) || Number(o.inPoint) > 0 || Number(o.outPoint) > 0 || Number(o.loopBeats) > 0;
  }
  const tempoOf = (cfg) => (cfg && cfg.modulation && cfg.modulation.bpm > 0 ? cfg.modulation.bpm : 120);

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
      /* Çevrimdışı (dışa aktarım, #539): video kendiliğinden OYNAMAZ, her
         kareden önce kare saatine sarılır (seekTo). Oynayan video işleme
         hızına göre ilerlerdi; aynı iş iki kez farklı video verirdi.
         Kamera canlı bir kaynak: çevrimdışında açılmaz, katman boş kalır. */
      this.offline = typeof window !== 'undefined' && window.SV_OFFLINE === true;
      this._loaded = null;
    }

    // Yapılandırma değiştiğinde kaynağı (yeniden) kurar. Aynı kaynak için
    // tekrar çağrılması ucuzdur: anahtar değişmediyse hiçbir şey yapmaz.
    apply(m) {
      const cfg = m || {};
      this._m = cfg;
      const key = [cfg.enabled ? '1' : '0', cfg.source, cfg.deviceId || '', cfg.deviceLabel || '', cfg.file || '', cfg.screenId || '', cfg.screenFps || '', cfg.loop ? 1 : 0].join('|');
      if (key === this.key) return;
      this.key = key;
      this._source = cfg.source === 'file' ? 'file' : (cfg.source === 'screen' ? 'screen' : 'webcam');
      this._deviceId = this._source === 'file' ? (cfg.file || '') : (this._source === 'screen' ? (cfg.screenId || '') : (cfg.deviceId || ''));
      this.stop();
      if (!cfg.enabled) return;

      this.video.loop = cfg.loop !== false;
      if (cfg.source === 'file' && this.offline) {
        if (!cfg.file) return;
        this.video.autoplay = false;
        this.video.preload = 'auto';
        this.video.srcObject = null;
        this._loaded = new Promise((resolve) => {
          const done = (ok) => { this.video.onloadeddata = null; this.video.onerror = null; resolve(ok); };
          this.video.onloadeddata = () => {
            if (this.key !== key) return done(false);
            this.ready = true;
            this.error = null;
            done(true);
          };
          this.video.onerror = () => { this._fail(key, this.video.error); done(false); };
        });
        this.video.src = this._sourceUrl(cfg.file);
        return;
      }
      if (cfg.source === 'screen') {
        /* Yayın sayfası ekranı kendisi yakalayamaz: kare, kamerada olduğu gibi
           uygulama penceresinden gelir (#421). */
        if (!this.offline && this._webPage()) {
          this._relay = true;
          this._armRelay(key);
        } else {
          this._openScreen(key, cfg);
        }
        return;
      }
      if (this.offline) return;
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
        userMedia(constraints)
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

    /* Ekran veya pencere. Web kamerasının getUserMedia({ video: true })
       yolu buradan geçmez. API yoksa (dışa aktarım, test, yayın sayfası)
       hata metni yazılır, fırlatılmaz. */
    _openScreen(key, cfg) {
      const api = typeof window !== 'undefined' ? window.api : null;
      const fail = (reason) => {
        if (this.key !== key) return;
        this.ready = false;
        this.error = screenFaultText(reason);
        this._publish();
      };
      if (this.offline || !api || typeof api.screenSources !== 'function') {
        fail('platform');
        return;
      }
      let pending;
      try { pending = api.screenSources(); } catch { fail('permission'); return; }
      Promise.resolve(pending).then((res) => {
        if (this.key !== key) return null;
        if (!res || res.ok === false) {
          fail((res && res.reason) || 'permission');
          return null;
        }
        const want = String((cfg && cfg.screenId) || '');
        if (!want) {
          this.ready = false;
          this.error = 'Bir ekran veya pencere seçin.';
          this._publish();
          return null;
        }
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          fail('platform');
          return null;
        }
        const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: want };
        /* Yenileme hızı (#421): sınır verilmezse Chromium 30 fps yakalar (ölçüldü); 60 istenebilir.
           Düşük sınır yakalama ve kopyalama yükünü azaltır (slayt, belge, sohbet penceresi). */
        const fps = screenFps(cfg && cfg.screenFps);
        if (fps) mandatory.maxFrameRate = fps;
        const desktop = { audio: false, video: { mandatory } };
        return userMedia(desktop).then((stream) => {
          if (this.key !== key) {
            if (stream && stream.getTracks) stream.getTracks().forEach((t) => t.stop());
            return false;
          }
          this.stream = stream;
          this.video.src = '';
          this.video.srcObject = stream;
          return this.video.play().then(() => true);
        });
      }).then((ok) => {
        if (!ok || this.key !== key) return;
        this.ready = true;
        this.error = null;
        this._publish();
        this._startRelayPump(key);
      }).catch(() => { fail('permission'); });
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
          const err = (slot && slot.remoteError) ||
            (this._source === 'screen' ? 'Ekran görüntüsü uygulamadan bekleniyor.' : 'Kamera görüntüsü uygulamadan bekleniyor.');
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
      if (this._source === 'file' && isFormatFault(err)) {
        /* onerror ve play() reddi aynı hatayı iki kez getirir: anahtar
           başına tek yoklama. Yanıt gelene kadar ileti boş kalır; önce
           çözücü çaresini gösterip sonra değiştirmek yanıltıcı olurdu. */
        if (this._probeKey === key) return;
        this._probeKey = key;
        this.error = null;
        const file = this._deviceId;
        probeMissing(this._sourceUrl(file)).then((missing) => {
          if (this.key !== key) return;
          this.ready = false;
          this.error = missing ? missingVideoText(file) : videoFaultText(err);
          this._publish();
        });
        return;
      }
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
      /* Dışa aktarımda ana süreç her video için her karesi anahtar kare bir
         ara kopya hazırlıyor (#539, main/export-media.js): kare başı sarma
         ucuz. Kopya yoksa özgün dosya. */
      const map = this.offline && typeof window !== 'undefined' ? window.SVExportMediaMap : null;
      if (map && typeof map[file] === 'string' && map[file]) return map[file];
      const http = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
      let token = '';
      try { token = new URLSearchParams(location.search).get('token') || ''; } catch { /* */ }
      return overlayMediaSrc(file, http, token);
    }

    stop() {
      this._stopRelay();
      this.ready = false;
      this._loaded = null;
      this.error = null;
      this._probeKey = null;
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

    /* Çevrimdışı: videoyu `sec` saniyesinin karesine getirir (döngüdeyse
       süresine göre sarar, değilse son karede durur) ve kare çözülene kadar
       bekler. Canlı oynatıcıda katman göründüğü anda başlıyor; dışa
       aktarımda o an t = 0. */
    /* Timeline klibi: canlı video da klibin yerel saatine bağlıdır.
       Sarma/duraklatma videoyu serbest duvar saatinde bırakmaz. */
    seekTimeline(sec) {
      if (this.offline || this._source !== 'file') return;
      this._tlDriven = true;
      const v = this.video, d = v.duration;
      if (!(d > 0) || !isFinite(d)) return;
      v.pause();
      const target = transportTime(sec, d, Object.assign({}, this._m, { loop: v.loop }), this._bpm || 0);
      if (!v.seeking && Math.abs(v.currentTime - target) > 1 / 120) {
        try { v.currentTime = target; } catch { /* dosya henüz hazır değil */ }
      }
    }

    async seekTo(sec) {
      // null: sarılacak bir şey yok (kamera, dosya seçilmemiş); false: kare okunamadı
      if (!this.offline || this._source !== 'file' || !this._loaded) return null;
      const ok = await this._loaded;
      if (!ok) return false;
      const v = this.video;
      const d = v.duration;
      if (!(d > 0) || !isFinite(d)) return false;
      const target = transportTime(sec, d, Object.assign({}, this._m, { loop: v.loop }), this._bpm || 0);
      if (Math.abs(v.currentTime - target) < 1e-6 && !v.seeking && v.readyState >= 2) return true;
      return new Promise((resolve) => {
        let timer = null;
        const fin = (r) => { clearTimeout(timer); v.removeEventListener('seeked', onSeek); resolve(r); };
        const onSeek = () => fin(true);
        v.addEventListener('seeked', onSeek);
        timer = setTimeout(() => fin(false), 5000);
        v.currentTime = target;
      });
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
    /* Canlı oynatıcıyı taşıma ayarına göre sürer: hız oynatma hızına yazılıyor, bölge dışına
       çıkınca başa (döngü) ya da sona (döngü yok) alınıyor. Vuruş döngüsünde konum saatten
       hesaplanıyor ve kayma 0,15 sn'yi geçince düzeltiliyor; aradaki kareler video kendi
       hızında akıyor (her karede sarmak takılırdı). Zaman çizelgesi klibi kendi saatini veriyor
       (seekTimeline); o zaman burası karışmıyor. */
    _steer(m, t) {
      const v = this.video;
      const d = v.duration;
      if (!(d > 0) || !isFinite(d) || v.readyState < 2 || this._tlDriven) return;
      const speed = Math.max(0.1, Math.min(4, Number(m.speed) > 0 ? Number(m.speed) : 1));
      if (Math.abs(v.playbackRate - speed) > 1e-3) v.playbackRate = speed;
      if (Number(m.loopBeats) > 0) {
        const want = transportTime(t, d, m, this._bpm || 120);
        if (!v.seeking && Math.abs(v.currentTime - want) > 0.15) { try { v.currentTime = want; } catch { /* hazır değil */ } }
        if (v.paused) v.play().catch(() => {});
        return;
      }
      let a = Math.max(0, Math.min(d, Number(m.inPoint) || 0));
      let b = Number(m.outPoint) > 0 ? Math.max(0, Math.min(d, Number(m.outPoint))) : d;
      if (b - a < 0.05) { a = 0; b = d; }
      if (v.seeking) return;
      if (v.currentTime < a - 0.05 || v.currentTime >= b - 0.02) {
        if (m.loop === false && v.currentTime >= b - 0.02) { if (!v.paused) v.pause(); return; }
        try { v.currentTime = a; } catch { /* hazır değil */ }
        if (v.paused && m.loop !== false) v.play().catch(() => {});
      }
    }

    // Panelden elle sarma (konum kaydırıcısı): oranla, 0..1
    scrub(frac) {
      if (this.offline || this._source !== 'file') return;
      const v = this.video;
      const d = v.duration;
      if (!(d > 0) || !isFinite(d)) return;
      const m = this._m || {};
      let a = Math.max(0, Math.min(d, Number(m.inPoint) || 0));
      let b = Number(m.outPoint) > 0 ? Math.max(0, Math.min(d, Number(m.outPoint))) : d;
      if (b - a < 0.05) { a = 0; b = d; }
      try { v.currentTime = a + Math.max(0, Math.min(1, Number(frac) || 0)) * (b - a - 0.001); } catch { /* hazır değil */ }
    }

    draw(ctx, audio, cfg, W, H, t) {
      const m = cfg.media || {};
      if (!m.enabled) return;
      this._bpm = tempoOf(cfg);
      if (this._source === 'file' && !this.offline && !this._relay && transportOn(m)) this._steer(m, t);
      else if (this._source === 'file' && !this.offline && this.video.playbackRate !== 1) this.video.playbackRate = 1;
      if (!this.hasFrame()) {
        /* Hata yazısı yalnız yönetici panelinin önizlemesinde. Çıkış,
           yüzen pencere ve yayın sayfası seyirciye gider: kamera yokken
           "Seçilen kamera bulunamadı" ve %55 karartma projeksiyonda
           görünüyordu. Çıkışta katman boş kalır. Canlı kayıt önizleme
           yüzeyini kaydeder; kayıt sürerken panelde de çizilmez. */
        const R = typeof window !== 'undefined' ? window.SVRecordPanel : null;
        const recording = !!(R && typeof R.isRecording === 'function' && R.isRecording());
        const operator = typeof window !== 'undefined' && !!window.SVPanel && !recording;
        if (operator && this.error && ctx && ctx.fillText) {
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
      const kb = kenBurns(m, t);
      const zoom = (1 + (audio ? audio.bass : 0) * (m.audioZoom || 0)) * kb.zoom * (1 + this._beatPulse(m, audio, t));
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

      const frame = this._keyed(pic, vw, vh, m) || pic;
      const slices = Math.max(0, Math.min(12, m.kaleido | 0));
      if (slices >= 3) this._drawKaleido(ctx, frame, W, H, vw, vh, slices, zoom, t);
      else this._drawFit(ctx, frame, W, H, vw, vh, m.fit, zoom, !!m.mirror, kb.x * W, kb.y * H);

      ctx.restore();
    }

    /* Vuruşta nabız (#841): basın yavaş ortalamasını belirgin aşan bir yükseliş
       kısa bir yakınlaşma tepesi başlatır, tepe ~0,3 sn'de söner. Zaman çizim
       saatinden (t), duvar saatinden değil: dışa aktarım kare kare aynı.
       Dönen: ek yakınlaşma oranı (0..beatPulse*0.08). */
    _beatPulse(m, audio, t) {
      const amt = Math.max(0, Math.min(1, Number(m.beatPulse) || 0));
      if (!(amt > 0) || !audio) { this._bp = null; return 0; }
      const s = this._bp || (this._bp = { t, avg: audio.bass || 0, env: 0, last: -1 });
      const dt = Math.max(0, Math.min(0.25, t - s.t));
      s.t = t;
      const b = audio.bass || 0;
      s.avg += (b - s.avg) * Math.min(1, dt * 2);
      s.env *= Math.exp(-dt * 10);
      if (b > s.avg * 1.25 + 0.08 && t - s.last > 0.18) { s.env = 1; s.last = t; }
      return amt * 0.08 * s.env;
    }

    _drawFit(ctx, pic, W, H, vw, vh, fit, zoom, mirror, panX, panY) {
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
      /* Ken Burns kaydırması (#841): görüntü kenarı kadranın içine
         girmesin diye kayma, büyütmenin bıraktığı payla sınırlı. */
      const px = Math.max(-Math.abs(dw - W) / 2, Math.min(Math.abs(dw - W) / 2, panX || 0));
      const py = Math.max(-Math.abs(dh - H) / 2, Math.min(Math.abs(dh - H) / 2, panY || 0));
      const dx = (W - dw) / 2 + px;
      const dy = (H - dh) / 2 + py;
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

    /* Renk / parlaklık anahtarı. Kaynak karesinin üstünde, renk filtresinden
       ve sığdırmadan önce: delik kaynak alfası olarak kalır, alttaki katman
       görünür. Kapalıyken tuval açılmaz. Uzun kenar 960 ile sınırlı; 4K
       karenin tamamı her kare okunmaz. Kaynak karesi ve ayarlar aynıysa
       (duran video) önceki sonuç yeniden kullanılır; aktarım tuvali (plaka)
       her kare yeniden işlenir, çünkü kimliği aynı kalırken içeriği değişir. */
    _keyed(pic, vw, vh, m) {
      const K = typeof window !== 'undefined' && window.SVMediaKey;
      if (!K || !K.active(m) || !vw || !vh) return null;
      if (typeof document === 'undefined') return null;
      let c = this._keyCanvas;
      if (!c) {
        try { c = this._keyCanvas = document.createElement('canvas'); } catch { return null; }
      }
      const MAX = 960;
      let dw = vw;
      let dh = vh;
      const long = Math.max(vw, vh);
      if (long > MAX) {
        const s = MAX / long;
        dw = Math.max(1, Math.round(vw * s));
        dh = Math.max(1, Math.round(vh * s));
      }
      const stamp = pic === this.video && typeof pic.currentTime === 'number' ? pic.currentTime : NaN;
      const sig = this.key + '|' + m.keyMode + '|' + (m.keyColor || '') + '|' + m.keyAmount + '|' + m.keySoft + '|' +
        !!m.keyInvert + '|' + (m.keySpill || 0) + '|' + (m.keyFeather || 0) + '|' + dw + 'x' + dh;
      if (stamp === this._keyStamp && sig === this._keySig) return c;
      if (c.width !== dw || c.height !== dh) { c.width = dw; c.height = dh; }
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
      g.clearRect(0, 0, dw, dh);
      g.drawImage(pic, 0, 0, dw, dh);
      let img;
      try { img = g.getImageData(0, 0, dw, dh); } catch { return null; }
      K.apply(img.data, {
        mode: m.keyMode,
        color: m.keyColor || '#00ff00',
        threshold: m.keyAmount == null ? 0.3 : m.keyAmount,
        softness: m.keySoft == null ? 0.08 : m.keySoft,
        invert: !!m.keyInvert,
        spill: m.keySpill || 0,
        /* Yumuşatma yarıçapı 960 piksellik uzun kenara göre verilir; küçük karede
           aynı görünsün diye ölçeklenir. */
        feather: (m.keyFeather || 0) * Math.max(dw, dh) / MAX,
        width: dw,
        height: dh,
      });
      g.putImageData(img, 0, 0);
      this._keyStamp = stamp;
      this._keySig = sig;
      return c;
    }

    dispose() {
      this.stop();
      this._keyCanvas = null;
      this._keySig = '';
      this.key = '';
    }
  }

  function userMedia(constraints) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  // Ekran kaynağının kare hızı sınırı: 0 (Chromium varsayılanı, 30 fps) ya da 5..60
  function screenFps(v) {
    const n = Math.round(Number(v));
    if (!(n > 0)) return 0;
    return Math.max(5, Math.min(60, n));
  }

  const KEY_MAX = 255 * Math.sqrt(3);
  function keyClamp(v) {
    const n = Number(v);
    if (!(n > 0)) return 0;
    return n > 1 ? 1 : n;
  }
  function keyRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    const n = m ? parseInt(m[1], 16) : 0x00ff00;
    return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  function keyActive(m) {
    const mode = m && m.keyMode;
    return mode === 'chroma' || mode === 'luma';
  }
  /* Anahtar renginin baskın kanalı (0 kırmızı, 1 yeşil, 2 mavi). Renk belirgin değilse -1:
     gri ya da iki kanalı birbirine yakın bir anahtarda hangi kanalın kısılacağı belli olmaz. */
  function keySpillChannel(rgb) {
    let k = 0;
    if (rgb[1] > rgb[k]) k = 1;
    if (rgb[2] > rgb[k]) k = 2;
    const others = Math.max(rgb[(k + 1) % 3], rgb[(k + 2) % 3]);
    return rgb[k] - others >= 48 ? k : -1;
  }

  /* KENAR YUMUŞATMA (#419): alfa kanalı `radius` piksellik kutu ortalamasıyla (yatay, sonra
     dikey) bulanıklaştırılır ve sonuç özgün alfayı AŞAMAZ. Kenar içe doğru yumuşar; dışarıda
     saydam kalmış pikseller yeniden görünür olmaz, yani perdenin rengi kenara geri gelmez.
     Tamponlar çağrılar arasında yeniden kullanılır. */
  let featherA = null;
  let featherB = null;
  function keyFeather(data, w, h, radius) {
    const r = Math.max(0, Math.min(12, Math.round(Number(radius) || 0)));
    const n = w * h;
    if (!r || !(n > 0) || !data || data.length < n * 4) return false;
    if (!featherA || featherA.length < n) {
      featherA = new Uint8Array(n);
      featherB = new Uint8Array(n);
    }
    const a = featherA;
    const b = featherB;
    for (let i = 0, p = 3; i < n; i++, p += 4) a[i] = data[p];
    const win = 2 * r + 1;
    const half = win >> 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + (k < 0 ? 0 : k >= w ? w - 1 : k)];
      for (let x = 0; x < w; x++) {
        b[row + x] = ((sum + half) / win) | 0;
        const add = x + r + 1;
        const sub = x - r;
        sum += a[row + (add < w ? add : w - 1)] - a[row + (sub > 0 ? sub : 0)];
      }
    }
    // Dikey geçiş sütun toplamlarıyla satır satır ilerler: bellek sırayla okunur
    if (!keyFeather.col || keyFeather.col.length < w) keyFeather.col = new Uint32Array(w);
    const col = keyFeather.col;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += b[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x];
      col[x] = sum;
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const add = (y + r + 1 < h ? y + r + 1 : h - 1) * w;
      const sub = (y - r > 0 ? y - r : 0) * w;
      for (let x = 0; x < w; x++) {
        const v = ((col[x] + half) / win) | 0;
        const p = (row + x) * 4 + 3;
        if (v < data[p]) data[p] = v;
        col[x] += b[add + x] - b[sub + x];
      }
    }
    return true;
  }

  /* data: RGBA. Renkte eşik, anahtara olan uzaklığın tam ölçeğe oranıdır
     (0 yalnız aynı renk, 1 neredeyse her şey). Parlaklıkta eşik 0..1
     kesittir; invert aydınlık tarafı saydam yapar, değilse karanlık tarafı.
     Yumuşaklık o kesitten sonraki geçiş payıdır. Var olan alfa çarpılır.
     Hız: uzaklık karesiyle karşılaştırılıyor, karekök yalnız geçiş payındaki
     piksellerde alınıyor. 960x540 karede renk 7,0 -> 1,6 ms, parlaklık 2,2 -> 1,2 ms
     (Node, aynı makine); çıktı birebir aynı.
     Taşma bastırma (spill, 0..1, yalnız renk anahtarı): görünür kalan pikselde anahtarın
     baskın kanalı öteki iki kanalın büyüğünü aşıyorsa aşan pay bu oranda kısılır (yeşil
     perdede saçta ve omuzda kalan yeşil yansıma). Uzaklık, kısılmadan önceki renkten ölçülür.
     Yumuşatma (feather, piksel) için width ve height verilmelidir; bkz. keyFeather. */
  function keyApply(data, opts) {
    const o = opts || {};
    const mode = o.mode;
    if ((mode !== 'chroma' && mode !== 'luma') || !data || !data.length) return 0;
    const thr = keyClamp(o.threshold == null ? 0.3 : o.threshold);
    const soft = keyClamp(o.softness == null ? 0.08 : o.softness);
    let n = 0;
    if (mode === 'chroma') {
      const rgb = keyRgb(o.color);
      const r0 = rgb[0];
      const g0 = rgb[1];
      const b0 = rgb[2];
      const cut = thr * KEY_MAX;
      const fade = soft * KEY_MAX;
      const cut2 = cut * cut;
      const end2 = fade > 0 ? (cut + fade) * (cut + fade) : cut2;
      const sp = keyClamp(o.spill);
      const kc = sp > 0 ? keySpillChannel(rgb) : -1;
      const ka = (kc + 1) % 3;
      const kb2 = (kc + 2) % 3;
      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - r0;
        const dg = data[i + 1] - g0;
        const db = data[i + 2] - b0;
        const d2 = dr * dr + dg * dg + db * db;
        if (d2 > cut2 && d2 >= end2) {
          if (kc < 0) continue;
        } else {
          const keep = d2 <= cut2 ? 0 : (Math.sqrt(d2) - cut) / fade;
          data[i + 3] = Math.round(data[i + 3] * keep);
          n++;
          if (kc < 0 || keep === 0) continue;
        }
        const v = data[i + kc];
        const lim = data[i + ka] > data[i + kb2] ? data[i + ka] : data[i + kb2];
        if (v > lim) data[i + kc] = Math.round(v - (v - lim) * sp);
      }
      if (o.feather > 0 && o.width > 0 && o.height > 0) keyFeather(data, o.width, o.height, o.feather);
      return n;
    }
    const sign = o.invert ? 1 : -1;
    const kr = 0.2126 / 255;
    const kg = 0.7152 / 255;
    const kb = 0.0722 / 255;
    for (let i = 0; i < data.length; i += 4) {
      const side = sign * (kr * data[i] + kg * data[i + 1] + kb * data[i + 2] - thr);
      if (!(side > 0)) continue;
      const keep = soft === 0 || side >= soft ? 0 : 1 - side / soft;
      data[i + 3] = Math.round(data[i + 3] * keep);
      n++;
    }
    if (o.feather > 0 && o.width > 0 && o.height > 0) keyFeather(data, o.width, o.height, o.feather);
    return n;
  }

  window.SVMedia = MediaLayer;
  window.SVMediaKey = { active: keyActive, apply: keyApply, feather: keyFeather, spillChannel: keySpillChannel };
  window.SVScreenFps = screenFps;
  window.SVMediaTransport = { transportTime, transportOn, tempoOf };
  window.SVMediaFault = cameraFaultText;
  window.SVVideoFault = videoFaultText;
  window.SVMissingVideo = missingVideoText;
  window.SVMediaWrap = wrapText;
  window.SVMediaKenBurns = kenBurns;
  window.SVMediaStatus = noteMediaStatus;
  window.SVMediaWarning = mediaWarning;
  window.SVCamFrame = noteCamFrame;
  window.SVCamStatus = noteCamStatus;
  // Dış kaynak katmanları (modes/source.js) aynı aktarma yuvalarını okur
  window.SVRelaySlot = (key) => relaySlots.get(String(key || '')) || null;
  window.SVOverlayMediaSrc = overlayMediaSrc;
})();
