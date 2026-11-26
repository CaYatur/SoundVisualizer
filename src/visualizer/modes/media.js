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

  /* play() sözü pause() ya da yeni kaynak yüzünden yarıda kesilince AbortError ile
     reddedilir ("The play() request was interrupted by a call to pause()"). Bu bir
     hata değil, yarış: video yine oynatılabilir. Kullanıcıya hiç gösterilmez. */
  function isPlayAbort(err) {
    return !!err && (err.name === 'AbortError' || /play\(\) request was interrupted/i.test(String(err.message || '')));
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
    /* GERİ OYNATMA (#417, `reverse: true`): aynı bölüm sondan başa. İleri konumun bölüm
       içindeki payı (f) sondan çıkarılıyor; döngüsüzse ilk karede duruyor. */
    if (o.reverse === true) {
      const tail = 0.001;
      if (beats > 0 && bpm > 0) {
        const len = Math.min(span, (beats * 60 / bpm) * speed);
        return a + Math.max(0, len - tail - (s % len));
      }
      if (o.loop === false) return Math.max(a, b - tail - s);
      return a + Math.max(0, span - tail - (s % span));
    }
    if (beats > 0 && bpm > 0) return a + (s % Math.min(span, (beats * 60 / bpm) * speed));
    if (o.loop === false) return Math.min(a + s, b - 0.001);
    return a + (s % span);
  }
  // Taşıma ayarı açık mı (yoksa canlı oynatıcı eskisi gibi kendi başına oynuyor)
  function transportOn(m) {
    const o = m || {};
    return (Number(o.speed) > 0 && Number(o.speed) !== 1) || Number(o.inPoint) > 0 || Number(o.outPoint) > 0 || Number(o.loopBeats) > 0 || speedReactOn(o) || o.reverse === true;
  }
  /* SESE GÖRE HIZ: seçilen bandın şiddeti oynatma hızını en düşük ve en yüksek hız arasında
     sürer (speedReact, speedBand, speedMin 0,5, speedMax 2, speedSmooth 0,15 sn). Vuruşa kilitli döngü konumu tempo ızgarasından hesapladığı için onunla birlikte
     çalışmaz; döngü açıkken sabit Hız geçerlidir. */
  function speedReactOn(m) {
    return !!m && m.speedReact === true && !(Number(m.loopBeats) > 0);
  }
  const clampRate = (v, fb) => Math.max(0.1, Math.min(4, Number(v) > 0 ? Number(v) : fb));
  function audioRate(m, audio, prev, dt) {
    const o = m || {};
    const a = clampRate(o.speedMin, 0.5);
    const b = clampRate(o.speedMax, 2);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = o.speedBand === 'mid' || o.speedBand === 'treble' || o.speedBand === 'level' ? o.speedBand : 'bass';
    const level = Math.max(0, Math.min(1, Number(audio && audio[key]) || 0));
    const target = lo + (hi - lo) * level;
    if (!(prev > 0)) return target;
    const tau = o.speedSmooth == null ? 0.15 : Math.max(0, Number(o.speedSmooth) || 0);
    const k = tau > 0 ? 1 - Math.exp(-Math.max(0, Number(dt) || 0) / tau) : 1;
    return prev + (target - prev) * k;
  }
  const tempoOf = (cfg) => (cfg && cfg.modulation && cfg.modulation.bpm > 0 ? cfg.modulation.bpm : 120);

  /* KARE GECİKMESİ (#420): canlı kaynak (kamera, ekran) `media.delay` saniye geriden
     gösterilir. Kareler küçültülmüş tuvallere (en çok DELAY_W piksel genişlik), saniyede en
     çok DELAY_FPS kez yazılıyor; en çok DELAY_MAX saniye. 0 (varsayılan): halka hiç kurulmaz,
     katman eskisi gibi çizer. Video dosyasında konum zaten seçilebiliyor; orada yok. */
  const DELAY_MAX = 2;
  const DELAY_W = 480;
  const DELAY_FPS = 30;
  const delayOf = (m) => Math.max(0, Math.min(DELAY_MAX, Number(m && m.delay) || 0));
  /* Halkadan gösterilecek kare: `at` anına eşit ya da ondan önceki en yeni kare; halka henüz
     dolmadıysa en eski kare (gecikme dolana kadar o kare kalır). Saf: sınanabilir. */
  function pickDelayed(frames, at) {
    if (!frames || !frames.length) return null;
    let best = null;
    for (const f of frames) if (f.t <= at + 1e-6 && (!best || f.t > best.t)) best = f;
    return best || frames[0];
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
        /* Hazırlık ilk karenin çözülmesiyle (loadeddata) gelir, play() sözüyle değil:
           zaman çizelgesi videoyu duraklatılmış tutarken de kare çizilebilir. Kendiliğinden
           oynatma (autoplay) kapalı; oynatmayı tek yol (_play) yönetir, yoksa tarayıcının
           kendi play() çağrısı çizelgenin pause() çağrısıyla yarışırdı. */
        this.video.autoplay = false;
        this.video.preload = 'auto';
        this.video.onloadeddata = () => {
          if (this.key !== key) return;
          this.ready = true;
          this.error = null;
          this._publish();
        };
        this.video.src = this._sourceUrl(cfg.file);
        if (!this._tlDriven) this._play();
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
      // Yarıda kesilen play() sözü hata değil (bkz. isPlayAbort)
      if (isPlayAbort(err) && (this._source === 'file' || /play\(\)/.test(String(err.message || '')))) return;
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
      this._wantPlay = false;
      this._playing = null;
      this._heldOk = false;
      this._seekAt = 0;
      try {
        this.video.onloadeddata = null;
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
    /* TEK OYNATMA YOLU. play() bir söz döndürür; söz çözülmeden pause() çağrılırsa
       tarayıcı sözü AbortError ile reddeder ve eskiden bu ret "Video açılamadı: The
       play() request was interrupted by a call to pause()" diye tuvale yazılıyordu.
       Burada bekleyen söz varken duraklatma istenirse yalnız istek not edilir; söz
       çözülünce video duraklatılır. Ret AbortError ise sessizce yutulur. */
    _play() {
      const v = this.video;
      this._wantPlay = true;
      if (this._playing) return this._playing;
      if (!v.paused) return Promise.resolve(true);
      const key = this.key;
      let p;
      try { p = v.play(); } catch (e) { p = Promise.reject(e); }
      if (!p || typeof p.then !== 'function') return Promise.resolve(true);
      const pending = p.then(() => {
        if (this._playing === pending) this._playing = null;
        if (this.key !== key) return false;
        if (!this._wantPlay && !v.paused) v.pause();
        return true;
      }, (e) => {
        if (this._playing === pending) this._playing = null;
        if (!isPlayAbort(e)) this._fail(key, e);
        return false;
      });
      this._playing = pending;
      return pending;
    }

    _pause() {
      this._wantPlay = false;
      if (this._playing) return; // söz çözülünce _play duraklatır
      if (!this.video.paused) this.video.pause();
    }

    /* Timeline klibi: canlı video klibin yerel saatine bağlıdır.

       Çizelge OYNARKEN video kendi çözücüsüyle oynar (hız = klip hızı × katman hızı);
       konum yalnız kayma 0,25 sn'yi aşınca (sarma, döngü başı, takılma) düzeltilir.
       Eskiden her karede pause() + currentTime yazılıyordu: video hiç oynamıyor, yalnız
       sarmanın bittiği seyrek karelerde görüntü değişiyordu (anahtar karesi seyrek
       videolarda donmuş tek kare). Çizelge DURAKKEN video duraklatılır ve oynatma
       kafasının karesine sarılır. Geri oynatma (reverse) her zaman kare kare sarılır.
       `rate` eksiyse çizelge geri oynuyor (J): her sarma, bittiği ana göre önden (ölçülen
       sarma süresi × hız kadar geriden) hedeflenir; görüntü kafanın arkasında kalmaz.
       Sarma sürerken son kare tutulur (_hold), arada siyah kare görünmez. */
    seekTimeline(sec, playing, rate) {
      if (this.offline || this._source !== 'file') return;
      this._tlDriven = true;
      const v = this.video, d = v.duration;
      if (!(d > 0) || !isFinite(d) || v.readyState < 1) { this._pause(); return; }
      const target = transportTime(sec, d, Object.assign({}, this._m, { loop: v.loop }), this._bpm || 0);
      const m = this._m || {};
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // Son sarmanın süresi (ms, yumuşatılmış): geri oynatmanın önden hedeflemesi için
      if (this._seekAt && !v.seeking) {
        const ms = Math.min(1000, now - this._seekAt);
        this._seekLag = this._seekLag ? this._seekLag * 0.7 + ms * 0.3 : ms;
        this._seekAt = 0;
      }
      const back = Number(rate) < 0;
      const seek = (tol) => {
        if (v.seeking || !(Math.abs(v.currentTime - target) > tol)) return;
        const lead = back ? Math.min(0.5, Math.abs(Number(rate)) * (this._seekLag || 0) / 1000) : 0;
        this._hold();
        try { v.currentTime = Math.max(0, target - lead); this._seekAt = now; } catch { /* dosya henüz hazır değil */ }
      };
      if (!playing || back || m.reverse === true) {
        this._pause();
        seek(1 / 120);
        return;
      }
      const clipRate = Math.abs(Number(rate)) > 0 ? Math.abs(Number(rate)) : 1;
      const layerRate = speedReactOn(m) && this._rate > 0 ? this._rate : clampRate(m.speed, 1);
      const want = Math.max(0.0625, Math.min(16, clipRate * layerRate));
      if (Math.abs(v.playbackRate - want) > 1e-3) v.playbackRate = want;
      // Döngüsüz klipte son kare: video durur, sona sarılmaya çalışılmaz
      if (m.loop === false && target >= d - 0.02) { this._pause(); seek(0.05); return; }
      seek(0.25);
      this._play();
    }

    /* Dışa aktarımda sese göre hız: konum kare kare toplanır, aynı ses aynı videoyu verir.
       Dönen süre transportTime'ın sabit Hız çarpanıyla çarpılınca toplanan konumu verir. */
    _reactClock(sec) {
      const m = this._m || {};
      if (this._offT == null || sec < this._offT) this._offPos = 0;
      else this._offPos += (sec - this._offT) * (this._rate > 0 ? this._rate : clampRate(m.speedMin, 0.5));
      this._offT = sec;
      return this._offPos / clampRate(m.speed, 1);
    }

    async seekTo(sec) {
      // null: sarılacak bir şey yok (kamera, dosya seçilmemiş); false: kare okunamadı
      if (!this.offline || this._source !== 'file' || !this._loaded) return null;
      const ok = await this._loaded;
      if (!ok) return false;
      const v = this.video;
      const d = v.duration;
      if (!(d > 0) || !isFinite(d)) return false;
      if (speedReactOn(this._m)) sec = this._reactClock(sec);
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

    /* Sarmadan önce son kare: sarma sürerken öğenin karesi düşebilir (readyState < 2),
       çizelge videosu o arada bu kareyle çizilir. Kaynak değişince (stop) atılır. */
    _hold() {
      const v = this.video;
      if (typeof document === 'undefined' || !(v.readyState >= 2) || !(v.videoWidth > 0)) return;
      const c = this._held || (this._held = document.createElement('canvas'));
      if (c.width !== v.videoWidth) c.width = v.videoWidth;
      if (c.height !== v.videoHeight) c.height = v.videoHeight;
      try { c.getContext('2d').drawImage(v, 0, 0); this._heldOk = true; } catch { this._heldOk = false; }
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
      const react = speedReactOn(m) && this._rate > 0;
      const speed = react ? this._rate : Math.max(0.1, Math.min(4, Number(m.speed) > 0 ? Number(m.speed) : 1));
      /* Geri oynatma (#417): tarayıcının oynatıcısı geriye oynamıyor (negatif hız yok). Video
         durur, konum her karede saatten hesaplanıp sarılıyor; sarma sürerken yenisi beklenir.
         Sese göre hız açıksa saat o hızla toplanıyor. Anahtar karesi seyrek videolarda bu
         akış ileri oynatmadan daha az akıcıdır. */
      if (m.reverse === true) {
        this._pause();
        let want;
        if (react) {
          const dt = this._revT == null ? 0 : Math.max(0, Math.min(0.25, t - this._revT));
          this._revClock = (this._revClock || 0) + dt * this._rate;
          want = transportTime(this._revClock, d, Object.assign({}, m, { speed: 1, loopBeats: 0 }), 0);
        } else {
          this._revClock = 0;
          want = transportTime(t, d, m, this._bpm || 120);
        }
        this._revT = t;
        this._wasRev = true;
        if (!v.seeking && Math.abs(v.currentTime - want) > 1 / 120) { try { v.currentTime = want; } catch { /* hazır değil */ } }
        return;
      }
      this._revT = null;
      // Geri oynatmadan ileriye dönüldü: duraklatılan video yeniden oynasın
      if (this._wasRev) { this._wasRev = false; if (v.paused && !(m.loop === false && v.currentTime >= d - 0.02)) this._play(); }
      // Sese göre hız her karede oynar: küçük farklar oynatıcıya yazılmaz
      const settled = react && Math.abs(v.playbackRate - speed) <= 0.02;
      if (!settled) {
        if (Math.abs(v.playbackRate - speed) > 1e-3) v.playbackRate = speed;
      }
      if (Number(m.loopBeats) > 0) {
        const want = transportTime(t, d, m, this._bpm || 120);
        if (!v.seeking && Math.abs(v.currentTime - want) > 0.15) { try { v.currentTime = want; } catch { /* hazır değil */ } }
        if (v.paused) this._play();
        return;
      }
      let a = Math.max(0, Math.min(d, Number(m.inPoint) || 0));
      let b = Number(m.outPoint) > 0 ? Math.max(0, Math.min(d, Number(m.outPoint))) : d;
      if (b - a < 0.05) { a = 0; b = d; }
      if (v.seeking) return;
      if (v.currentTime < a - 0.05 || v.currentTime >= b - 0.02) {
        if (m.loop === false && v.currentTime >= b - 0.02) { this._pause(); return; }
        try { v.currentTime = a; } catch { /* hazır değil */ }
        if (v.paused && m.loop !== false) this._play();
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
      if (speedReactOn(m)) {
        const dt = this._rateT == null ? 0 : Math.max(0, Math.min(0.25, t - this._rateT));
        this._rateT = t;
        this._rate = audioRate(m, audio, this._rate, dt);
      } else {
        this._rate = 0;
        this._rateT = null;
      }
      if (this._source === 'file' && !this.offline && !this._relay && transportOn(m)) this._steer(m, t);
      else if (this._source === 'file' && !this.offline && !this._tlDriven) {
        // Çizelge klibinin hızına seekTimeline karar verir; burada yalnız serbest oynatıcı
        if (this.video.playbackRate !== 1) this.video.playbackRate = 1;
        // Geri oynatma kapatıldı ve başka taşıma ayarı yok: video kendi başına oynamaya döner
        if (this._wasRev) { this._wasRev = false; this._revT = null; if (this.video.paused) this._play(); }
        /* Serbest oynatıcı duraklamış kalmasın: yarıda kesilen ilk play() (kaynak değişimi,
           sekme arka planda) ya da döngüsü açık videonun durması kendiliğinden toparlanır. */
        else if (this.video.paused && this.video.loop && this.video.readyState >= 2 && !this._playing) this._play();
      }
      // Çizelge videosu sarılırken son tutulan kare (siyah kare yerine)
      const held = !this.hasFrame() && this._tlDriven && this._heldOk && !this.error ? this._held : null;
      if (!this.hasFrame() && !held) {
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

      const pic = held || this.drawable();
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

      // Kare gecikmesi (#420): kapalıyken (0) bu adım hiç bir şey yapmıyor
      const late = this._delayed(pic, vw, vh, m, t);
      const src = late ? late.canvas : pic;
      const sw = late ? late.w : vw;
      const sh = late ? late.h : vh;
      const frame = this._keyed(src, sw, sh, m) || src;
      const slices = Math.max(0, Math.min(12, m.kaleido | 0));
      if (slices >= 3) this._drawKaleido(ctx, frame, W, H, sw, sh, slices, zoom, t);
      else this._drawFit(ctx, frame, W, H, sw, sh, m.fit, zoom, !!m.mirror, kb.x * W, kb.y * H);

      ctx.restore();
    }

    /* Kare gecikmesi halkası. Dönen: { canvas, w, h } ya da null (kapalı, dosya, dışa aktarım). */
    _delayed(pic, vw, vh, m, t) {
      const sec = delayOf(m);
      if (!(sec > 0) || this._source === 'file' || this.offline || !(vw > 0) || !(vh > 0) || typeof document === 'undefined') {
        this._ring = null;
        return null;
      }
      const s = Math.min(1, DELAY_W / vw);
      const w = Math.max(2, Math.round(vw * s));
      const h = Math.max(2, Math.round(vh * s));
      let r = this._ring;
      // Boyut değişti ya da saat geri gitti (sahne yeniden başladı): halka baştan
      if (!r || r.w !== w || r.h !== h || t < r.last) r = this._ring = { w, h, frames: [], spare: [], last: -Infinity };
      if (t - r.last >= 1 / DELAY_FPS - 1e-3) {
        const c = r.spare.pop() || Object.assign(document.createElement('canvas'), { width: w, height: h });
        const cx = c.getContext('2d');
        if (cx) {
          cx.drawImage(pic, 0, 0, w, h);
          r.frames.push({ t, canvas: c });
          r.last = t;
        }
      }
      // Artık gerekmeyen kareler yedeğe (tuval yeniden kullanılıyor, bellek sabit kalıyor)
      const keepFrom = t - sec - 1 / DELAY_FPS;
      while (r.frames.length > 1 && r.frames[1].t <= keepFrom) r.spare.push(r.frames.shift().canvas);
      const f = pickDelayed(r.frames, t - sec);
      return f ? { canvas: f.canvas, w, h } : null;
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
  window.SVMediaTransport = { transportTime, transportOn, tempoOf, speedReactOn, audioRate, pickDelayed, delayOf, DELAY_MAX };
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
