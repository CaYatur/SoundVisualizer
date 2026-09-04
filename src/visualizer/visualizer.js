'use strict';
/* Görselleştirici penceresi kontrolcüsü.

   Sahne artık sabit bir tuval yığını değil, layers.js'in sürdüğü sıralı bir
   KATMAN listesidir (bkz. o dosyanın başındaki açıklama). Buradaki iş kare
   hızı sınırlaması, ses ölçüm bildirimi ve yapılandırmanın katman yığınına
   aktarılmasından ibarettir. */
(function () {
  const stage = document.getElementById('stage');
  const logoImg = document.getElementById('logo');
  const hint = document.getElementById('hint');
  const errBox = document.getElementById('error');

  let cfg = window.SV.defaultConfig();
  const audio = new window.SVAudio();
  const sprites = new window.SVSprites(); // ek görsel nesneler / partiküller
  const media = new window.SVMedia(); // web kamerası / video katmanı
  let mediaOn = false;

  // Modülasyon matrisi: kaynakları kare başına hesaplar ve yapılandırmanın
  // modüle edilmiş bir KOPYASINI üretir; saklanan ayarlar değişmez.
  const modulator = new window.SVModulation.Modulator();

  /* Gösteri saati. Panel yalnızca durum değiştiğinde çıpa yollar; buradaki
     zaman o çıpadan kapalı formülle hesaplanır, böylece tüm ekranlar aynı
     kareyi gösterir ve kare başına IPC gerekmez. */
  let showAnchor = window.SVShowClock ? window.SVShowClock.idle() : null;
  /* Karşılığı olmayan otomasyon hedefleri bir kez bildirilir. Her karede
     yazmak konsolu boğardı; hiç yazmamak da "otomasyon çalışmıyor" diye
     bildirilen ama sebebi görünmeyen bir hataya dönüşürdü. */
  const warnedTargets = Object.create(null);

  /* Öz test kancası. Otomasyonun çizim döngüsüne gerçekten ulaştığını
     ölçmek için: birim testi modelin doğru olduğunu gösterir, bu ise
     modelin uygulamaya BAĞLI olduğunu. İkincisi, bağlamayı unutmakla
     sessizce kaybedilir. */
  window.SVShowDebug = { time: 0, applied: 0, missing: 0, frames: 0 };

  /* Projeksiyon haritalaması bu pencerenin ekranına ait tanımı kullanır.
     Kimlik dönüşümündeyse hiç devreye girmez — kapalı haritalamanın maliyeti
     sıfır olmalı. */
  const mapper = new window.SVMapper.Mapper();
  const displayId = window.SV_DISPLAY_ID;
  let mapCanvas = null;

  function outputDef(c) {
    const m = c && c.mapping;
    if (!m || m.enabled === false) return null;
    const outs = m.outputs || {};
    const own = (displayId != null && outs[displayId]) || outs.default || null;
    if (!own || window.SVWarp.isIdentity(own)) return null;
    return own;
  }

  const stack = new window.SVLayers.LayerStack(stage, { logoEl: logoImg });
  stack.setSprites(sprites);
  stack.setMedia(media);

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
    // Arkaplan çözünürlük ölçeği katman yığınının tamamına uygulanır
    const rs = clamp(cfg.power.renderScale, 0.4, 1);
    stack.resize(Math.round(w * dpr * rs), Math.round(h * dpr * rs));
    layoutLogo();
  }

  // --------------------------------------------------------------------------
  // Sahne
  // --------------------------------------------------------------------------
  function applyScene() {
    stack.setConfig(cfg);
    stack.setPostFX(cfg.postfx);
    // Saydam yayın modunda gövde arkaplanı da saydam kalmalı
    const bgType = cfg.background.type;
    document.body.style.background =
      bgType === 'transparent' ? 'transparent' : bgType === 'solid' ? cfg.background.solidColor : '#000';
    stack.bindMedia(mediaOn ? media.video : null);
  }

  /* Haritalama aşaması.

     Katman yığınının ürettiği görünür yüzeyi alır, büker ve kendi tuvalini
     sahneye koyar. Yığın CSS kompozit yolundayken (tek yüzey yok) tek yüzeye
     inmek gerekir; bunu yığından isteriz. */
  function applyMapping(c) {
    const out = outputDef(c);
    if (!out) {
      if (mapCanvas && mapCanvas.parentNode) mapCanvas.parentNode.removeChild(mapCanvas);
      mapCanvas = null;
      stack.setMapping(false);
      return;
    }
    stack.setMapping(true);
    const src = stack.surface();
    if (!src) return;
    mapper.resize(src.width, src.height);
    if (!mapper.render(src, out)) return;
    if (mapCanvas !== mapper.canvas) {
      mapCanvas = mapper.canvas;
      mapCanvas.style.position = 'absolute';
      mapCanvas.style.inset = '0';
      mapCanvas.style.width = '100%';
      mapCanvas.style.height = '100%';
      mapCanvas.style.zIndex = '1000';
      if (!mapCanvas.parentNode) stage.appendChild(mapCanvas);
    }
  }

  function applyMedia() {
    mediaOn = !!(cfg.media && cfg.media.enabled);
    media.apply(cfg.media);
  }

  // --------------------------------------------------------------------------
  // Logo
  // --------------------------------------------------------------------------
  function applyLogo() {
    const l = cfg.logo;
    if (l.enabled && l.src) {
      if (logoImg.src !== l.src) logoImg.src = l.src;
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

    audio.update(dt);

    /* Sessizlikte duraklat (güç tasarrufu).

       Sahne geçişi sürerken duraklamak yok: geçiş ilerlemesini çizim
       karesi taşıyor. Karartma en çok müzik durduğunda kullanılıyor ve
       duraklama tam o anda panik düğmesini işlevsiz bırakıyordu. */
    const silent = cfg.power.pauseOnSilence && audio.level < 0.008 && audio.bass < 0.01 && !stack.trans;
    if (!silent) {
      /* SIRA BİLİNÇLİ: önce zaman çizelgesi otomasyonu TABANI yazar,
         sonra canlı modülasyon onun üstüne biner. Çizilmiş bir eğri
         değeri belirler, ona atanmış bir LFO da o değerin etrafında
         salınır — ses yazılımlarında beklenen davranış budur. Ters sıra
         çizilen eğriyi görünmez kılardı.
         Yazma kopyala-yaz: kullanıcının kayıtlı ayarına dokunulmaz. */
      let base = cfg;
      if (cfg.timeline && cfg.timeline.enabled && window.SVTimeline && window.SVShowClock) {
        const showT = window.SVShowClock.resolve(showAnchor, Date.now());
        const auto = window.SVTimeline.applyAutomation(cfg, cfg.timeline, showT);
        base = auto.cfg;
        window.SVShowDebug.time = showT;
        window.SVShowDebug.applied = auto.applied;
        window.SVShowDebug.missing = auto.missing ? auto.missing.length : 0;
        window.SVShowDebug.frames++;
        if (auto.missing) {
          for (const path of auto.missing) {
            if (warnedTargets[path]) continue;
            warnedTargets[path] = 1;
            console.warn('[çizelge] otomasyon hedefi yapılandırmada yok: ' + path);
          }
        }
      }
      modulator.update(base, audio, t, dt);
      const mcfg = modulator.apply(base, dt);
      // Efekt zinciri nesneleri setChain() ile yakalandığı için modüle edilmiş
      // parametrelerin ulaşması ancak zincir yeniden verilerek olur
      if (modulator.touches('postfx')) stack.setPostFX(mcfg.postfx);
      stack.draw(audio, mcfg, t, dt);
      applyMapping(mcfg);
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
      // palette() gradyan katmanında gl.readPixels kullanır ve GPU işlem
      // hattını senkron olarak bekletir. Yalnızca Dynamic Lighting gerçekten
      // arkaplan renklerini istediğinde çağrılır.
      const needsBgColors =
        !!cfg.lighting?.enabled && cfg.lighting?.paletteSource === 'background';
      window.api.sendAudioMeter({
        level: audio.level,
        bass: audio.bass,
        mid: audio.mid,
        treble: audio.treble,
        time: now / 1000,
        backgroundColors: needsBgColors ? stack.palette(cfg) : [],
        ready: audio.ready,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Yapılandırma uygula (ses yakalama ANA SÜREÇTE yönetilir)
  // --------------------------------------------------------------------------
  function applyConfig(newCfg) {
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), newCfg);

    sprites.setItems(cfg.images && cfg.images.enabled ? cfg.images.items : []);
    applyMedia();
    applyScene();
    applyLogo();
    document.body.style.cursor = cfg.power.hideCursor ? 'none' : 'default';
    /* Sayfanın zemini de kalkmalı; pencere şeffaf doğsa bile body siyah
       boyadığı sürece arkasındaki masaüstü görünmez. */
    document.documentElement.classList.toggle('sv-transparent',
      !!(cfg.background && cfg.background.transparent));

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
      // Seçili preset düzenlendiyse motorun kaynağı yenilensin
      stack.dispose();
      applyScene();
    });

    const saved = await window.api.requestConfig();
    if (saved) cfg = window.SV.deepMerge(window.SV.defaultConfig(), saved);

    applyConfig(cfg);

    // Ana süreçten gelen ses karelerini al
    window.api.onNativeAudio((frame) => audio.ingestFrame(frame));
    window.api.onConfig((c) => applyConfig(c));
    if (window.api.onShowClock) window.api.onShowClock((a) => { showAnchor = a; });
    /* Çalan parça çıpası. Her kare gelmez — kaynak konumu ancak ara sıra
       günceller — aradaki değeri katmanlar SVNowPlaying ile hesaplar. */
    if (window.api.onNowPlaying) {
      window.api.onNowPlaying((st) => { window.SVNowLive.state = st; });
    }
    window.addEventListener('resize', resize);

    raf = requestAnimationFrame(frame);
  }

  init().catch((e) => showError('Başlatılamadı: ' + (e && e.message ? e.message : e)));
})();
