'use strict';
/* Görselleştirici penceresi kontrolcüsü.
   Katmanlar: [WebGL gradyan arkaplan] -> [2D ön görselleştirici] -> [logo] */
(function () {
  const glCanvas = document.getElementById('gl');
  const bg2d = document.getElementById('bg2d');
  const bg2dCtx = bg2d.getContext('2d');
  const c2d = document.getElementById('c2d');
  const fxBack = document.getElementById('fxBack');
  const fxFront = document.getElementById('fxFront');
  const fxBackCtx = fxBack.getContext('2d');
  const fxFrontCtx = fxFront.getContext('2d');
  const mediaCanvas = document.getElementById('media');
  const mediaCtx = mediaCanvas.getContext('2d');
  const logoImg = document.getElementById('logo');
  const hint = document.getElementById('hint');
  const errBox = document.getElementById('error');

  let cfg = window.SV.defaultConfig();
  const audio = new window.SVAudio();
  const sprites = new window.SVSprites(); // ek görsel nesneler / partiküller
  const media = new window.SVMedia(); // web kamerası / video katmanı
  let imagesOn = false;
  let mediaOn = false;

  let gradient = null; // WebGL modu
  let bgMode = null; // 2D arkaplan modu örneği
  let bgType = null;
  let foreground = null; // 2D modu örneği
  let foreType = null;
  let raf = 0;
  let lastDraw = 0;
  let lastRaf = 0;
  let frameAcc = 0; // kare hızı sınırı için birikim sayacı
  let dpr = window.devicePixelRatio || 1;
  let meterT = 0;

  // --------------------------------------------------------------------------
  // Boyutlandırma
  // --------------------------------------------------------------------------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // 2D ön katman tam çözünürlük
    c2d.width = Math.round(w * dpr);
    c2d.height = Math.round(h * dpr);
    c2d.style.width = w + 'px';
    c2d.style.height = h + 'px';

    // Ek görsel nesne (partikül) katmanları ve 2D arkaplan — ön katmanla aynı çözünürlük
    for (const cv of [fxBack, fxFront, bg2d, mediaCanvas]) {
      cv.width = c2d.width;
      cv.height = c2d.height;
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    }

    // WebGL arkaplan: performans için renderScale
    if (gradient) {
      const rs = clamp(cfg.power.renderScale, 0.4, 1);
      gradient.resize(Math.round(w * dpr * rs), Math.round(h * dpr * rs));
    }
    glCanvas.style.width = w + 'px';
    glCanvas.style.height = h + 'px';

    layoutLogo();
  }

  // --------------------------------------------------------------------------
  // Arkaplan (gradyan / düz renk)
  // --------------------------------------------------------------------------
  function ensureGradient() {
    if (!gradient) {
      try {
        gradient = new window.SVModes.gradient(glCanvas);
        resize();
      } catch (e) {
        showError('WebGL başlatılamadı: ' + e.message);
      }
    }
  }

  function applyBackground() {
    const type = cfg.background.type;
    const is2d = !!(window.SVBackgrounds && window.SVBackgrounds[type]);

    if (bgType !== type) {
      bgType = type;
      bgMode = is2d ? new window.SVBackgrounds[type]() : null;
    }

    glCanvas.style.display = type === 'gradient' ? 'block' : 'none';
    bg2d.style.display = is2d ? 'block' : 'none';

    if (type === 'gradient') {
      document.body.style.background = '#000';
      ensureGradient();
    } else if (is2d) {
      document.body.style.background = '#000';
    } else {
      document.body.style.background = cfg.background.solidColor;
    }
  }

  // --------------------------------------------------------------------------
  // Ön görselleştirici (bars / wave / circular / none)
  // --------------------------------------------------------------------------
  function applyForeground() {
    const type = cfg.visualizer.type;
    if (type === foreType) return;
    if (foreground && foreground.dispose) foreground.dispose();
    foreground = null;
    foreType = type;
    if (type && type !== 'none' && window.SVModes[type]) {
      foreground = new window.SVModes[type](c2d);
    } else {
      c2d.getContext('2d').clearRect(0, 0, c2d.width, c2d.height);
    }
  }

  // --------------------------------------------------------------------------
  // Ek görsel nesneler / partiküller
  // --------------------------------------------------------------------------
  function applyImages() {
    imagesOn = !!(cfg.images && cfg.images.enabled);
    sprites.setItems(imagesOn ? cfg.images.items : []);
    fxBack.style.display = imagesOn ? 'block' : 'none';
    fxFront.style.display = imagesOn ? 'block' : 'none';
    if (!imagesOn) {
      fxBackCtx.clearRect(0, 0, fxBack.width, fxBack.height);
      fxFrontCtx.clearRect(0, 0, fxFront.width, fxFront.height);
    }
  }

  // --------------------------------------------------------------------------
  // Medya katmanı (web kamerası / video dosyası)
  // --------------------------------------------------------------------------
  function applyMedia() {
    mediaOn = !!(cfg.media && cfg.media.enabled);
    media.apply(cfg.media);
    mediaCanvas.style.display = mediaOn ? 'block' : 'none';
    mediaCanvas.classList.toggle('front', !!(cfg.media && cfg.media.layer === 'front'));
    if (!mediaOn) mediaCtx.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height);
    bindMediaToShaders();
  }

  // Shader tabanlı modlar medyayı sv_media (iChannel3) olarak okuyabilir
  function bindMediaToShaders() {
    const el = mediaOn ? media.video : null;
    if (foreground && foreground.host && foreground.host.setMedia) foreground.host.setMedia(el);
    if (bgMode && bgMode.host && bgMode.host.setMedia) bgMode.host.setMedia(el);
  }

  // --------------------------------------------------------------------------
  // Logo
  // --------------------------------------------------------------------------
  function applyLogo() {
    const l = cfg.logo;
    if (l.enabled && l.src) {
      if (logoImg.src !== l.src) logoImg.src = l.src;
      logoImg.style.display = 'block';
      logoImg.style.opacity = l.opacity;
      logoImg.style.filter = l.glow > 0 ? `drop-shadow(0 0 ${l.glow * 40}px rgba(255,255,255,.6))` : 'none';
      layoutLogo();
    } else {
      logoImg.style.display = 'none';
    }
  }

  function layoutLogo() {
    const l = cfg.logo;
    if (!l.enabled || !l.src) return;
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    const size = minDim * clamp(l.scale, 0.03, 0.9);
    logoImg.style.width = size + 'px';
    logoImg.style.left = l.x * 100 + '%';
    logoImg.style.top = l.y * 100 + '%';
  }

  // --------------------------------------------------------------------------
  // Render döngüsü
  // --------------------------------------------------------------------------
  function frame(now) {
    raf = requestAnimationFrame(frame);

    // Kare hızı sınırlama.
    // requestAnimationFrame ekranın yenileme hızına kilitlidir; "şu kadar ms
    // geçti mi" karşılaştırması, sınır yenileme hızının tam böleni değilse
    // hedefin çok altına düşer (75 Hz ekranda 60 sınırı => 37.5 FPS).
    // Bunun yerine artan bir sayaç kullanılır: uzun vadeli ortalama tam olarak
    // istenen kare hızına oturur (75 Hz'de 60 için 5 tikin 4'ünde çizilir).
    const cap = cfg.power.fpsCap;
    const rafDt = lastRaf ? now - lastRaf : 16.7;
    lastRaf = now;
    if (cap > 0) {
      const interval = 1000 / cap;
      frameAcc += Math.min(rafDt, interval * 2); // sekme sonrası sıçramayı sınırla
      if (frameAcc < interval) return;
      frameAcc -= interval;
      if (frameAcc > interval) frameAcc = interval; // birikmeyi engelle
    } else {
      frameAcc = 0;
    }

    const dt = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 0.016;
    lastDraw = now;
    const t = now / 1000;

    audio.update();

    // sessizlikte duraklat (güç tasarrufu)
    const silent = cfg.power.pauseOnSilence && audio.level < 0.008 && audio.bass < 0.01;

    if (cfg.background.type === 'gradient' && gradient && !silent) {
      gradient.draw(audio, cfg, t);
    } else if (bgMode && !silent) {
      bgMode.draw(bg2dCtx, audio, cfg, t, bg2d.width, bg2d.height, dt);
    }

    if (foreground) {
      if (silent || !audio.ready) {
        // sahneyi temizle (ses yokken çizme)
        c2d.getContext('2d').clearRect(0, 0, c2d.width, c2d.height);
      } else {
        foreground.draw(audio, cfg, t, dt);
      }
    }

    // medya katmanı (kamera / video)
    if (mediaOn) {
      mediaCtx.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height);
      if (!silent) media.draw(mediaCtx, audio, cfg, mediaCanvas.width, mediaCanvas.height, t);
    }

    // ek görsel nesneler / partiküller (arka katman görselin arkasında,
    // ön katman görselin önünde)
    if (imagesOn) {
      fxBackCtx.clearRect(0, 0, fxBack.width, fxBack.height);
      fxFrontCtx.clearRect(0, 0, fxFront.width, fxFront.height);
      if (!silent && audio.ready) {
        if (sprites.hasLayer('back')) sprites.draw(fxBackCtx, audio, t, fxBack.width, fxBack.height, 'back');
        if (sprites.hasLayer('front')) sprites.draw(fxFrontCtx, audio, t, fxFront.width, fxFront.height, 'front');
      }
    }

    // logo nabzı
    if (cfg.logo.enabled && cfg.logo.src) {
      const pulse = 1 + audio.bass * cfg.logo.pulse;
      logoImg.style.transform = `translate(-50%,-50%) scale(${pulse.toFixed(3)})`;
    }

    // ses gelmiyorsa ipucu göster
    if (audio.ready && now - audio.lastFrameTs > 1500) {
      hint.style.display = 'block';
      hint.textContent = 'Ses alınamıyor — yönetici panelinden çıkış aygıtı seçin';
    } else if (hint.style.display === 'block' && audio.ready && now - audio.lastFrameTs < 600) {
      hint.style.display = 'none';
    }

    // seviye göstergesini ve LED spektrumunu ana sürece bildir (~30 Hz)
    if (now - meterT > 32) {
      meterT = now;
      // sampleColors() gl.readPixels kullanır ve GPU işlem hattını senkron olarak
      // bekletir. Yalnızca Dynamic Lighting gerçekten arkaplan renklerini
      // istediğinde çağrılır; varsayılan yapılandırma bunu hiç kullanmaz.
      const needsBgColors =
        !!cfg.lighting?.enabled && cfg.lighting?.paletteSource === 'background';
      let backgroundColors = [];
      if (needsBgColors) {
        if (cfg.background?.type === 'gradient' && typeof gradient?.sampleColors === 'function') {
          backgroundColors = gradient.sampleColors(48);
        } else if (bgMode && typeof bgMode.palette === 'function') {
          // 2D arkaplanlar piksel okumak yerine kendi paletlerini bildirir
          backgroundColors = bgMode.palette(cfg);
        }
      }
      window.api.sendAudioMeter({
        level: audio.level,
        bass: audio.bass,
        mid: audio.mid,
        treble: audio.treble,
        time: now / 1000,
        backgroundColors,
        ready: audio.ready,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Yapılandırma uygula (ses yakalama ANA SÜREÇTE yönetilir)
  // --------------------------------------------------------------------------
  function applyConfig(newCfg) {
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), newCfg);

    applyBackground();
    applyForeground();
    applyImages();
    applyMedia();
    applyLogo();
    document.body.style.cursor = cfg.power.hideCursor ? 'none' : 'default';

    audio.applyConfig(cfg.audio);
    resize();
  }

  // --------------------------------------------------------------------------
  // Yardımcılar
  // --------------------------------------------------------------------------
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }
  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
  }

  // --------------------------------------------------------------------------
  // Başlat
  // --------------------------------------------------------------------------
  async function init() {
    // Studio presetleri (kullanıcının kendi shader'ları) ana süreçte tutulur
    try {
      window.SVPresets.setUser(await window.api.getPresets());
    } catch { /* preset yoksa yerleşiklerle devam */ }
    window.api.onPresets((list) => {
      window.SVPresets.setUser(list);
      // seçili preset düzenlendiyse motorun kaynağı yenilensin
      foreType = null;
      bgType = null;
      applyBackground();
      applyForeground();
      bindMediaToShaders();
    });

    const saved = await window.api.requestConfig();
    if (saved) cfg = window.SV.deepMerge(window.SV.defaultConfig(), saved);

    applyConfig(cfg);

    // Ana süreçten gelen ses karelerini al
    window.api.onNativeAudio((frame) => audio.ingestFrame(frame));
    window.api.onConfig((c) => applyConfig(c));
    window.addEventListener('resize', resize);

    raf = requestAnimationFrame(frame);
  }

  init();
})();
