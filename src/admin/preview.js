'use strict';
/* Yönetici panelindeki canlı önizleme.
   Görselleştirici penceresiyle aynı çizim modüllerini (window.SVModes / SVSprites)
   küçük bir sahnede çalıştırır; böylece ayarların etkisi tek ekrandan görülür.

   Ses kaynağı iki türlü olabilir:
     • Gerçek  — ana süreçten gelen native-audio kareleri (yakalama etkinken)
     • Demo    — gerçek kare gelmiyorsa üretilen örnek sinyal (müzik benzeri)
   Böylece görselleştirici kapalıyken bile önizleme canlı kalır. */
(function () {
  const REAL_FRAME_TIMEOUT = 700; // ms — bu süre kare gelmezse demo sinyale düş
  const PREVIEW_FPS = 45; // panelin kendi kare sınırı (CPU/GPU dostu)
  const BINS = 1024;
  const TIME_LEN = 2048;

  let stage, glCanvas, bg2d, c2d, fxBack, fxFront, logoImg;
  let fxBackCtx, fxFrontCtx, c2dCtx, bg2dCtx;

  let cfg = window.SV.defaultConfig();
  let audio = null;
  let sprites = null;
  let gradient = null;
  let bgMode = null;
  let bgType = null;
  let foreground = null;
  let foreType = null;
  let imagesOn = false;
  let mediaCanvas = null;
  let mediaCtx = null;
  let media = null;
  let mediaOn = false;

  let raf = 0;
  let lastDraw = 0;
  let lastRaf = 0;
  let frameAcc = 0; // kare hızı sınırı için birikim sayacı
  let lastRealFrame = 0;
  let paused = false;
  let started = false;
  let liveSource = false;
  let onSourceChange = null;
  let lastSpriteSig = null;
  let lastW = 0;
  let lastH = 0;

  const synthFreq = new Uint8Array(BINS);
  const synthTime = new Uint8Array(TIME_LEN);
  const synthFrame = { freq: synthFreq, time: synthTime, sampleRate: 48000 };

  // --------------------------------------------------------------------------
  // Demo sinyali — 120 BPM civarı, bas vuruşu + hareketli orta/tiz içerik
  // --------------------------------------------------------------------------
  function buildSyntheticFrame(t) {
    const beatPhase = (t * 2) % 1; // saniyede 2 vuruş
    const kick = Math.pow(1 - beatPhase, 3.2); // keskin iniş
    const halfPhase = (t * 4) % 1;
    const hat = Math.pow(1 - halfPhase, 9) * 0.55;
    const swell = 0.5 + 0.5 * Math.sin(t * 0.55);

    for (let i = 0; i < BINS; i++) {
      const n = i / BINS;
      // Gerçekçi spektrum eğrisi: bas ağır, tizler zayıf
      let v = Math.pow(1 - n, 2.6) * 0.85;
      v += kick * Math.pow(1 - n * 7, 6) * 0.9; // bas vuruşu (0..140 Hz)
      v += hat * Math.pow(n, 1.4) * 0.5; // hi-hat parlaklığı
      // gezinen melodik tepe noktaları
      v += 0.30 * swell * Math.exp(-Math.pow((n - (0.13 + 0.05 * Math.sin(t * 0.9))) * 26, 2));
      v += 0.22 * Math.exp(-Math.pow((n - (0.26 + 0.07 * Math.sin(t * 0.63 + 2))) * 30, 2));
      v += 0.14 * Math.exp(-Math.pow((n - (0.44 + 0.06 * Math.sin(t * 1.27 + 1))) * 34, 2));
      v *= 0.86 + 0.14 * Math.sin(i * 12.9898 + t * 3.1); // hafif doku
      synthFreq[i] = Math.max(0, Math.min(255, v * 255)) | 0;
    }

    const amp = 0.20 + kick * 0.62;
    for (let i = 0; i < TIME_LEN; i++) {
      const p = (i / TIME_LEN) * Math.PI * 2;
      const s =
        Math.sin(p * 3 + t * 6) * 0.6 +
        Math.sin(p * 7 + t * 3) * 0.26 +
        Math.sin(p * 17 + t * 11) * 0.14;
      synthTime[i] = Math.max(0, Math.min(255, 128 + s * amp * 127)) | 0;
    }
    return synthFrame;
  }

  // --------------------------------------------------------------------------
  // Boyutlandırma — sahne kutusuna göre (pencereye göre değil)
  // --------------------------------------------------------------------------
  function resize(force) {
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    // Boyut değişmediyse tuvalleri yeniden ayırma (kaydırıcı sürüklerken önemli)
    if (!force && w === lastW && h === lastH) {
      layoutLogo(w, h);
      return;
    }
    lastW = w;
    lastH = h;
    // Önizleme küçük olduğu için dpr'ı 2 ile sınırla
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    for (const cv of [c2d, fxBack, fxFront, bg2d]) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    if (gradient) gradient.resize(Math.round(w * dpr), Math.round(h * dpr));
    layoutLogo(w, h);
  }

  // --------------------------------------------------------------------------
  // Katmanlar
  // --------------------------------------------------------------------------
  function ensureGradient() {
    if (gradient) return;
    try {
      gradient = new window.SVModes.gradient(glCanvas);
      resize(true);
    } catch {
      // WebGL yoksa önizleme düz renge düşer
      gradient = null;
      glCanvas.style.display = 'none';
    }
  }

  function applyBackground() {
    const type = cfg.background.type;
    const is2d = !!(window.SVBackgrounds && window.SVBackgrounds[type]);

    if (bgType !== type) {
      bgType = type;
      bgMode = is2d ? new window.SVBackgrounds[type]() : null;
    }
    bg2d.style.display = is2d ? 'block' : 'none';

    if (type === 'gradient') {
      ensureGradient();
      if (gradient) glCanvas.style.display = 'block';
      stage.style.background = '#05040a';
    } else {
      glCanvas.style.display = 'none';
      stage.style.background = is2d ? '#05040a' : cfg.background.solidColor;
    }
  }

  function applyForeground() {
    const type = cfg.visualizer.type;
    if (type === foreType) return;
    if (foreground && foreground.dispose) foreground.dispose();
    foreground = null;
    foreType = type;
    if (type && type !== 'none' && window.SVModes[type]) {
      foreground = new window.SVModes[type](c2d);
    } else {
      c2dCtx.clearRect(0, 0, c2d.width, c2d.height);
    }
  }

  // Partikül sabitleri yalnızca bu alanlar değişince yeniden üretilir; diğer
  // parametreler (hız, saydamlık, ışıltı…) doğrudan cfg üzerinden canlı okunur.
  function spriteSignature() {
    const items = (cfg.images && cfg.images.items) || [];
    return items.map((i) => [i.id, i.src ? i.src.length : 0, i.count, i.sizeVar, i.seed].join(':')).join('|');
  }

  // Medya katmanı (web kamerası / video) — görselleştirici penceresiyle aynı sınıf
  function applyMedia() {
    if (!mediaCanvas) return;
    mediaOn = !!(cfg.media && cfg.media.enabled);
    media.apply(cfg.media);
    mediaCanvas.style.display = mediaOn ? 'block' : 'none';
    mediaCanvas.style.zIndex = cfg.media && cfg.media.layer === 'front' ? '4' : '1';
    if (!mediaOn) mediaCtx.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height);
    if (foreground && foreground.host && foreground.host.setMedia) foreground.host.setMedia(mediaOn ? media.video : null);
    if (bgMode && bgMode.host && bgMode.host.setMedia) bgMode.host.setMedia(mediaOn ? media.video : null);
  }

  function applyImages() {
    imagesOn = !!(cfg.images && cfg.images.enabled);
    const items = imagesOn ? cfg.images.items || [] : [];
    const sig = imagesOn ? spriteSignature() : '';
    if (sig !== lastSpriteSig) {
      lastSpriteSig = sig;
      sprites.setItems(items);
    } else {
      // Yapı aynı: yalnızca canlı okunan yapılandırma referansını tazele
      const withSrc = items.filter((c) => c && c.src);
      sprites.items.forEach((it, i) => {
        if (withSrc[i]) it.cfg = withSrc[i];
      });
    }
    fxBack.style.display = imagesOn ? 'block' : 'none';
    fxFront.style.display = imagesOn ? 'block' : 'none';
    if (!imagesOn) {
      fxBackCtx.clearRect(0, 0, fxBack.width, fxBack.height);
      fxFrontCtx.clearRect(0, 0, fxFront.width, fxFront.height);
    }
  }

  function applyLogo() {
    const l = cfg.logo;
    if (l.enabled && l.src) {
      if (logoImg.getAttribute('src') !== l.src) logoImg.src = l.src;
      logoImg.style.display = 'block';
      logoImg.style.opacity = l.opacity;
      logoImg.style.filter = l.glow > 0 ? `drop-shadow(0 0 ${l.glow * 14}px rgba(255,255,255,.6))` : 'none';
      const rect = stage.getBoundingClientRect();
      layoutLogo(rect.width, rect.height);
    } else {
      logoImg.style.display = 'none';
    }
  }

  function layoutLogo(w, h) {
    const l = cfg.logo;
    if (!l.enabled || !l.src) return;
    const size = Math.min(w, h) * Math.max(0.03, Math.min(0.9, l.scale));
    logoImg.style.width = size + 'px';
    logoImg.style.left = l.x * 100 + '%';
    logoImg.style.top = l.y * 100 + '%';
  }

  // --------------------------------------------------------------------------
  // Çizim döngüsü
  // --------------------------------------------------------------------------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused || document.hidden) return;

    // Görselleştiricideki ile aynı birikimli sınırlama: "şu kadar ms geçti mi"
    // karşılaştırması, sınır ekranın yenileme hızının tam böleni değilse hedefin
    // çok altına düşer (75 Hz ekranda 45 sınırı => 37.5 FPS).
    const interval = 1000 / PREVIEW_FPS;
    const rafDt = lastRaf ? now - lastRaf : 16.7;
    lastRaf = now;
    frameAcc += Math.min(rafDt, interval * 2);
    if (frameAcc < interval) return;
    frameAcc -= interval;
    if (frameAcc > interval) frameAcc = interval;

    const dt = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 0.016;
    lastDraw = now;
    const t = now / 1000;

    // Gerçek kare gelmiyorsa demo sinyaline geç
    const live = now - lastRealFrame < REAL_FRAME_TIMEOUT;
    if (live !== liveSource) {
      liveSource = live;
      if (onSourceChange) onSourceChange(live);
    }
    if (!live) audio.ingestFrame(buildSyntheticFrame(t));

    audio.update();

    if (cfg.background.type === 'gradient' && gradient) gradient.draw(audio, cfg, t);
    else if (bgMode) bgMode.draw(bg2dCtx, audio, cfg, t, bg2d.width, bg2d.height, dt);

    if (foreground) foreground.draw(audio, cfg, t, dt);

    if (mediaOn && mediaCanvas) {
      mediaCtx.clearRect(0, 0, mediaCanvas.width, mediaCanvas.height);
      media.draw(mediaCtx, audio, cfg, mediaCanvas.width, mediaCanvas.height, t);
    }

    if (imagesOn) {
      fxBackCtx.clearRect(0, 0, fxBack.width, fxBack.height);
      fxFrontCtx.clearRect(0, 0, fxFront.width, fxFront.height);
      if (sprites.hasLayer('back')) sprites.draw(fxBackCtx, audio, t, fxBack.width, fxBack.height, 'back');
      if (sprites.hasLayer('front')) sprites.draw(fxFrontCtx, audio, t, fxFront.width, fxFront.height, 'front');
    }

    if (cfg.logo.enabled && cfg.logo.src) {
      const pulse = 1 + audio.bass * cfg.logo.pulse;
      logoImg.style.transform = `translate(-50%,-50%) scale(${pulse.toFixed(3)})`;
    }
  }

  // --------------------------------------------------------------------------
  // Genel API
  // --------------------------------------------------------------------------
  function init(opts) {
    if (started) return true;
    stage = document.getElementById('previewStage');
    glCanvas = document.getElementById('pvGl');
    bg2d = document.getElementById('pvBg2d');
    c2d = document.getElementById('pv2d');
    fxBack = document.getElementById('pvBack');
    fxFront = document.getElementById('pvFront');
    mediaCanvas = document.getElementById('pvMedia');
    if (mediaCanvas) {
      mediaCtx = mediaCanvas.getContext('2d');
      media = new window.SVMedia();
    }
    logoImg = document.getElementById('pvLogo');
    if (!stage || !glCanvas || !c2d || !bg2d) return false;

    c2dCtx = c2d.getContext('2d');
    bg2dCtx = bg2d.getContext('2d');
    fxBackCtx = fxBack.getContext('2d');
    fxFrontCtx = fxFront.getContext('2d');

    audio = new window.SVAudio();
    sprites = new window.SVSprites();
    onSourceChange = (opts && opts.onSourceChange) || null;

    // Demo sinyalinde bile ilk kareden itibaren çizim yapılabilsin
    audio.ingestFrame(buildSyntheticFrame(0));

    setConfig(cfg);

    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    window.addEventListener('resize', resize);

    started = true;
    raf = requestAnimationFrame(frame);
    return true;
  }

  function setConfig(next) {
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), next);
    if (!started && !stage) return;
    applyBackground();
    applyForeground();
    applyImages();
    if (mediaCanvas) applyMedia();
    applyLogo();
    // Önizlemede ses ayarları da birebir uygulanır (hassasiyet/yumuşatma etkisi görünsün)
    audio.applyConfig(cfg.audio);
    resize();
  }

  function ingest(f) {
    if (!audio || !f || !f.freq) return;
    lastRealFrame = performance.now();
    audio.ingestFrame(f);
  }

  function setPaused(v) {
    paused = !!v;
    if (stage) stage.classList.toggle('paused', paused);
  }

  // Gerçek ses akarken seviye göstergeleri buradan beslenebilir (görselleştirici
  // kapalıyken ana süreçten 'audio-meter' gelmediği için)
  function getLevels() {
    if (!audio) return null;
    return { level: audio.level, bass: audio.bass, mid: audio.mid, treble: audio.treble };
  }

  window.SVPreview = {
    init,
    setConfig,
    // Studio önizlemesi aynı ses motorunu kullanır: panelde iki ayrı analiz
    // çalıştırmak hem israf hem de iki farklı görüntü demek olurdu.
    audioEngine: () => audio,
    ingest,
    setPaused,
    getLevels,
    isPaused: () => paused,
    isLive: () => liveSource,
  };
})();
