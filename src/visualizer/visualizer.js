'use strict';
/* Görselleştirici penceresi kontrolcüsü.
   Katmanlar: [WebGL gradyan arkaplan] -> [2D ön görselleştirici] -> [logo] */
(function () {
  const glCanvas = document.getElementById('gl');
  const c2d = document.getElementById('c2d');
  const fxBack = document.getElementById('fxBack');
  const fxFront = document.getElementById('fxFront');
  const fxBackCtx = fxBack.getContext('2d');
  const fxFrontCtx = fxFront.getContext('2d');
  const logoImg = document.getElementById('logo');
  const hint = document.getElementById('hint');
  const errBox = document.getElementById('error');

  let cfg = window.SV.defaultConfig();
  const audio = new window.SVAudio();
  const sprites = new window.SVSprites(); // ek görsel nesneler / partiküller
  let imagesOn = false;

  let gradient = null; // WebGL modu
  let foreground = null; // 2D modu örneği
  let foreType = null;
  let raf = 0;
  let lastDraw = 0;
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

    // Ek görsel nesne (partikül) katmanları — ön katmanla aynı çözünürlük
    for (const cv of [fxBack, fxFront]) {
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
    if (cfg.background.type === 'gradient') {
      glCanvas.style.display = 'block';
      document.body.style.background = '#000';
      ensureGradient();
    } else {
      glCanvas.style.display = 'none';
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
    const cap = cfg.power.fpsCap;
    if (cap > 0 && now - lastDraw < 1000 / cap - 0.4) return;
    const dt = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 0.016;
    lastDraw = now;
    const t = now / 1000;

    audio.update();

    // sessizlikte duraklat (güç tasarrufu)
    const silent = cfg.power.pauseOnSilence && audio.level < 0.008 && audio.bass < 0.01;

    if (cfg.background.type === 'gradient' && gradient && !silent) {
      gradient.draw(audio, cfg, t);
    }

    if (foreground) {
      if (silent || !audio.ready) {
        // sahneyi temizle (ses yokken çizme)
        c2d.getContext('2d').clearRect(0, 0, c2d.width, c2d.height);
      } else {
        foreground.draw(audio, cfg, t, dt);
      }
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
      const backgroundColors = cfg.background?.type === 'gradient' && typeof gradient?.sampleColors === 'function'
        ? gradient.sampleColors(48)
        : [];
      window.api.sendAudioMeter({
        level: audio.level,
        bass: audio.bass,
        mid: audio.mid,
        treble: audio.treble,
        bars: Array.isArray(audio.bars) ? audio.bars.slice() : [],
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
