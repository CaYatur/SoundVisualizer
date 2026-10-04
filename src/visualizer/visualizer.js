'use strict';
/* Görselleştirici penceresi kontrolcüsü.

   Sahne artık sabit bir tuval yığını değil, layers.js'in sürdüğü sıralı bir
   KATMAN listesidir (bkz. o dosyanın başındaki açıklama). Buradaki iş kare
   hızı sınırlaması, ses ölçüm bildirimi ve yapılandırmanın katman yığınına
   aktarılmasından ibarettir. */
(function () {
  /* Spout/Syphon yakalama penceresi (?svCapture=1): kompozitör şeffaf
     doğuyor; sayfa da ilk boyamada siyah basmamalı yoksa doku opak kalır.
     Asıl sahne applyConfig ile gelir — opak istenirse o zaman siyah dolar. */
  if (typeof location !== 'undefined' && /(?:\?|&)svCapture=1(?:&|$)/.test(location.search)) {
    document.documentElement.classList.add('sv-transparent');
    document.documentElement.style.background = 'transparent';
    if (document.body) document.body.style.background = 'transparent';
  }

  const stage = document.getElementById('stage');
  const logoImg = document.getElementById('logo');
  const hint = document.getElementById('hint');
  const errBox = document.getElementById('error');

  /* Yüzen pencere: çerçevesiz doğduğu için taşıma / boyut / köşe / kapat
     çubuğu yalnız --sv-floating iken çizilir. Tam ekran pencereler etkilenmez. */
  if (typeof window !== 'undefined' && window.SV_FLOATING) {
    document.documentElement.classList.add('sv-floating');
    const bar = document.createElement('div');
    bar.id = 'sv-float-bar';
    const grip = document.createElement('div');
    grip.className = 'sv-float-grip';
    // İkonlar ikon setinden (#665); set yüklenmemişse yazı
    const ico = (name, alt) => (window.SVIcons ? window.SVIcons.el(name) : document.createTextNode(alt));
    grip.appendChild(ico('grip', '::'));
    function chip(label, fn, icon, title) {
      const b = document.createElement('button');
      b.type = 'button';
      if (title) b.title = title;
      b.className = 'sv-float-chip';
      if (icon) b.appendChild(ico(icon, label)); else b.textContent = label;
      b.addEventListener('click', (e) => { e.preventDefault(); try { fn(); } catch { /* yok */ } });
      return b;
    }
    const sizes = document.createElement('div');
    sizes.className = 'sv-float-group';
    ['S', 'M', 'L'].forEach((k) => sizes.appendChild(chip(k, () => window.api.floatingSize(k.toLowerCase()))));
    const corners = document.createElement('div');
    corners.className = 'sv-float-group';
    [['tl', 'Sol üst köşe'], ['tr', 'Sağ üst köşe'], ['bl', 'Sol alt köşe'], ['br', 'Sağ alt köşe']].forEach((p) => {
      corners.appendChild(chip(p[0], () => window.api.floatingSnap(p[0]), 'corner-' + p[0], p[1]));
    });
    const close = document.createElement('button');
    close.className = 'sv-float-close';
    close.type = 'button';
    close.title = 'Kapat';
    close.appendChild(ico('x', 'x'));
    close.addEventListener('click', () => { try { window.api.floatingClose(); } catch { /* yok */ } });
    bar.appendChild(grip);
    bar.appendChild(sizes);
    bar.appendChild(corners);
    bar.appendChild(close);
    (document.body || document.documentElement).appendChild(bar);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { try { window.api.floatingClose(); } catch { /* yok */ } }
    });
  }



  /* Tam ekran gorsellestirici: F11 ile windowed olunca suruklenebilir olmali.
     Cercevesiz pencerede -webkit-app-region: drag sarti; kilit yalniz windowed. */
  if (typeof window !== 'undefined' && !window.SV_FLOATING && window.api && window.api.onWindowChrome) {
    const bar = document.createElement('div');
    bar.id = 'sv-win-bar';
    const grip = document.createElement('div');
    grip.className = 'sv-win-grip';
    const ico = (name, alt) => (window.SVIcons ? window.SVIcons.el(name) : document.createTextNode(alt));
    grip.appendChild(ico('grip', '::'));
    const label = document.createElement('span');
    label.textContent = 'Taşı';
    grip.appendChild(label);
    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'sv-win-lock';
    lockBtn.title = 'Konum ve boyutu kilitle';
    const setLockUi = (locked) => {
      lockBtn.classList.toggle('on', !!locked);
      document.documentElement.classList.toggle('sv-geo-locked', !!locked);
      lockBtn.textContent = '';
      lockBtn.appendChild(ico(locked ? 'lock' : 'unlock', locked ? 'Kilitli' : 'Açık'));
      const t = document.createElement('span');
      /* Kapaliyken eylem: Kilitle; acikken eylem: Kilidi ac */
      t.textContent = locked ? 'Kilidi aç' : 'Kilitle';
      lockBtn.appendChild(t);
    };
    let locked = false;
    lockBtn.addEventListener('click', (e) => {
      e.preventDefault();
      locked = !locked;
      setLockUi(locked);
      try { window.api.setGeometryLock(locked); } catch { /* yok */ }
    });
    setLockUi(false);
    bar.appendChild(grip);
    bar.appendChild(lockBtn);
    const mount = () => (document.body || document.documentElement).appendChild(bar);
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    window.api.onWindowChrome((st) => {
      const show = !!(st && st.show);
      const was = document.documentElement.classList.contains('sv-windowed');
      document.documentElement.classList.toggle('sv-windowed', show);
      if (!show) {
        /* Tam ekran / PiP / henüz F11 yok: cubuk kesin gizli. */
        document.documentElement.classList.remove('sv-win-show');
      }
      if (typeof st.locked === 'boolean') {
        locked = st.locked;
        setLockUi(locked);
      }
      /* Yalniz windowed'a YENI geciste flash; config/PiP ayari tekrarinda degil. */
      if (show && !was) {
        document.documentElement.classList.add('sv-win-show');
        setTimeout(() => document.documentElement.classList.remove('sv-win-show'), 1800);
      }
    });
    try {
      window.api.getGeometryLock().then((v) => { locked = !!v; setLockUi(locked); }).catch(() => {});
    } catch { /* yok */ }
  }

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
  let mapper = new window.SVMapper.Mapper();
  let mapRevivedAt = 0;
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
  /* Bu ekranın basıklık düzeltmesi. Haritalamayla aynı örüntü: ekran
     kimliğine özel tanım varsa o, yoksa 'default' (hepsi için). */
  function aspectDef(c) {
    return window.SVAspect.resolve(c && c.aspect, displayId);
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Arkaplan çözünürlük ölçeği katman yığınının tamamına uygulanır
    const rs = clamp(cfg.power.renderScale, 0.4, 1);
    const fw = Math.round(w * dpr * rs);
    const fh = Math.round(h * dpr * rs);

    /* Basıklık düzeltmesi görüntüyü GERMEZ; tuvalin ŞEKLİNİ değiştirir.
       Sahne, panelin gerçek fiziksel oranında bir tuvale çizilir; tuval CSS
       ile %100'e gerildiği için sıkıştırmayı tarayıcı yapar. Bu yüzden
       kırpma da bant da oluşmaz.

       Kritik olan, bunun KATMAN YIĞININA uygulanması: arkaplan,
       görselleştirici, logo, yazı ve görsel nesnelerin hepsi aynı mantıksal
       uzayda çizildiği için tek ayarla hepsi birden düzelir. Görselleri tek
       tek önceden germek gereken durum tam olarak budur ve böylece ortadan
       kalkar. */
    const r = window.SVAspect.renderSize(fw, fh, aspectDef(cfg));
    stack.resize(r.w, r.h);
    layoutCalib(r);
    layoutLogo();
  }

  // --------------------------------------------------------------------------
  // Kalibrasyon deseni
  //
  // Paneli ölçmek çoğu zaman mümkün değil; ama bir dairenin yuvarlak olup
  // olmadığı gözle görülür. Desen, sahneyle AYNI mantıksal tuvale çizilir ve
  // aynı sıkıştırmadan geçer — dolayısıyla daire ekranda yuvarlak göründüğü
  // anda düzeltme doğrudur. Kullanıcının tek yapması gereken kaydırıcıyı
  // oynatmak.
  // --------------------------------------------------------------------------
  let calibCanvas = null;

  function layoutCalib(r) {
    const def = aspectDef(cfg);
    const pattern = def.pattern || 'none';
    if (pattern === 'none') {
      if (calibCanvas && calibCanvas.parentNode) calibCanvas.parentNode.removeChild(calibCanvas);
      calibCanvas = null;
      return;
    }
    if (!calibCanvas) {
      calibCanvas = document.createElement('canvas');
      calibCanvas.style.position = 'absolute';
      calibCanvas.style.inset = '0';
      calibCanvas.style.width = '100%';
      calibCanvas.style.height = '100%';
      calibCanvas.style.pointerEvents = 'none';
      /* Haritalama tuvali 1000'de; desen onun da üstünde durmalı. Basıklık
         önce ayarlanır, yüzey haritalaması sonra — desen haritalamadan
         geçseydi hangi çarpıklığın hangisinden geldiği anlaşılmazdı. */
      calibCanvas.style.zIndex = '1001';
      stage.appendChild(calibCanvas);
    }
    if (calibCanvas.width !== r.w) calibCanvas.width = r.w;
    if (calibCanvas.height !== r.h) calibCanvas.height = r.h;
    drawCalib(calibCanvas, pattern);
  }

  function drawCalib(canvas, pattern) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const unit = Math.min(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(2, Math.round(unit * 0.004));
    ctx.strokeStyle = '#00ff66';
    ctx.globalAlpha = 0.95;

    if (pattern === 'grid') {
      /* Izgara: tek bir daire yalnızca merkezi anlatır, ızgara ise
         çarpıklığın ekranın her yerinde aynı olup olmadığını gösterir —
         değilse sorun basıklık değil, mercek ya da yüzey geometrisidir ve
         çözümü projeksiyon haritalaması olur. */
      const step = unit / 8;
      ctx.beginPath();
      for (let x = w / 2; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let x = w / 2 - step; x > 0; x -= step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = h / 2; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      for (let y = h / 2 - step; y > 0; y -= step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      // Izgaranın karesi kare mi: ortaya bir referans daire
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, step * 2, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const size = unit * 0.6;
    ctx.beginPath();
    if (pattern === 'square') {
      ctx.rect((w - size) / 2, (h - size) / 2, size, size);
    } else {
      ctx.arc(w / 2, h / 2, size / 2, 0, Math.PI * 2);
    }
    ctx.stroke();

    /* Artı işareti: gözle "yuvarlak mı" demek zor olabiliyor, ama iki kolun
       eşit uzunlukta görünüp görünmediği daha kolay seçiliyor. */
    ctx.beginPath();
    ctx.moveTo(w / 2 - size / 2, h / 2);
    ctx.lineTo(w / 2 + size / 2, h / 2);
    ctx.moveTo(w / 2, h / 2 - size / 2);
    ctx.lineTo(w / 2, h / 2 + size / 2);
    ctx.stroke();
  }

  // --------------------------------------------------------------------------
  // Sahne
  // --------------------------------------------------------------------------
  function applyScene() {
    stack.setConfig(cfg);
    stack.setPostFX(cfg.postfx);
    /* Gövdenin zemini: saydam modda (yayın katmanı ya da "Şeffaf Arkaplan")
       boyanmaz. Bkz. SVLayers.pageBackground — satır içi renk sınıf
       kuralını ezdiği için masaüstü penceresi hiç saydamlaşmıyordu. */
    const pageBg = window.SVLayers.pageBackground(cfg);
    document.body.style.background = pageBg;
    document.documentElement.style.background = pageBg;
    stack.bindMedia(mediaOn && stack.shaderVideo ? stack.shaderVideo() : null);
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
    /* Haritalamanın bağlamı kaybolursa (#594) yeni bir örnek kuruluyor:
       eski tuval sahneden kalkıyor, yenisi aşağıda ilk çizimde yerine
       giriyor. En çok iki saniyede bir — GPU süreci daha kalkmadıysa yeni
       bağlam da hemen kaybolur. */
    if (mapper.contextLost && mapper.contextLost() && performance.now() - mapRevivedAt > 2000) {
      mapRevivedAt = performance.now();
      const old = mapper.canvas;
      try { mapper.dispose(); } catch { /* bağlam zaten gitti */ }
      if (old && old.parentNode) old.parentNode.removeChild(old);
      mapper = new window.SVMapper.Mapper();
      mapCanvas = null;
    }
    mapper.resize(src.width, src.height);
    if (!mapper.render(src, out, window.SVLayers.seeThrough(c))) return;
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
    const isStack = window.SVLayers && window.SVLayers.stackOn(cfg);
    const hasMediaLayer = isStack && Array.isArray(cfg.layers)
      && cfg.layers.some((l) => l && l.kind === 'media' && l.enabled !== false);
    if (hasMediaLayer) {
      /* Klasik tek oynatıcıyı kapat. Açık bırakılırsa ilk kamera iki kez
         istenir ve ikinci katmanın aygıtı hiç açılmaz. */
      mediaOn = true;
      media.apply({ enabled: false });
      stack.syncMedia(cfg);
      return;
    }
    if (stack.syncMedia) stack.syncMedia(cfg);
    mediaOn = !isStack && !!(cfg.media && cfg.media.enabled);
    media.apply(Object.assign({}, cfg.media, { enabled: mediaOn }));
  }

  // --------------------------------------------------------------------------
  // Logo
  // --------------------------------------------------------------------------
  function applyLogo() {
    const l = cfg.logo;
    if (l && l.enabled && l.src) {
      if (logoImg.src !== l.src) logoImg.src = l.src;
    }
    logoImg.style.display = 'none';
  }

  function layoutLogo() {
    // Logo yerleşimi ve ölçeklemesi LayerStack tuval katmanı tarafından yürütülür
    if (logoImg) logoImg.style.display = 'none';
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

    // logo LayerStack tuval katmanı tarafından çizilir; DOM öğesi gizli kalır
    if (logoImg && logoImg.style.display !== 'none') {
      logoImg.style.display = 'none';
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
      /* Kaynak `milkdrop` ise (#589) palet MilkDrop'un o anki
         görüntüsünden: hangi ışık çıkışı açıksa — Dynamic Lighting, OpenRGB
         ya da Art-Net — onun için. Yığında MilkDrop yoksa arkaplana
         düşülüyor, ışık sönmesin. */
      const lightSrc = cfg.lighting?.paletteSource;
      const lightsOut = !!cfg.lighting?.enabled || !!cfg.openrgb?.enabled || !!cfg.artnet?.enabled;
      let backgroundColors = [];
      if (lightSrc === 'milkdrop' && lightsOut) {
        backgroundColors = stack.milkdropColors(8);
        if (!backgroundColors.length) backgroundColors = stack.palette(cfg);
      } else if (!!cfg.lighting?.enabled && lightSrc === 'background') {
        backgroundColors = stack.palette(cfg);
      }
      /* Sayfanın o an çizdiği preset tanı için de saklanıyor (#585): her
         ekranın aynı preseti gösterip göstermediği buradan okunuyor. */
      const mdPreset = stack.milkdropPreset();
      window.SVMdLive = mdPreset;
      window.api.sendAudioMeter({
        level: audio.level,
        bass: audio.bass,
        mid: audio.mid,
        treble: audio.treble,
        time: now / 1000,
        backgroundColors,
        ready: audio.ready,
        /* MilkDrop presetinin `monitor` değişkeni. Yeni bir IPC kanalı
           açmak yerine bu ~30 Hz mesaja biniyor: değer yazar aracı, kare
           başına doğruluk gerekmiyor ve ek kanal ek bakım demek. */
        mdMonitor: stack.milkdropMonitor(),
        /* O an çizilen MilkDrop preseti. Otomatik geçiş seçimini ayara
           yazmıyor; panel ekranda ne olduğunu, önizleme ve diğer ekranlar
           da neyi izleyeceğini buradan öğreniyor. */
        mdPreset,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Yapılandırma uygula (ses yakalama ANA SÜREÇTE yönetilir)
  // --------------------------------------------------------------------------
  function applyConfig(newCfg) {
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), newCfg);

    if (!window.SVLayers || !window.SVLayers.stackOn(cfg)) {
      sprites.setItems(cfg.images && cfg.images.enabled ? cfg.images.items : []);
    }
    applyMedia();
    applyScene();
    applyLogo();
    document.body.style.cursor = (window.SV_FLOATING || !cfg.power.hideCursor) ? 'default' : 'none';
    /* Sayfanın zemini de kalkmalı; pencere şeffaf doğsa bile body siyah
       boyadığı sürece arkasındaki masaüstü görünmez. */
    document.documentElement.classList.toggle('sv-transparent',
      window.SVLayers.seeThrough(cfg));
    applyBackgroundKey(cfg);

    audio.applyConfig(cfg.audio);
    resize();
  }

  /* Şeffaf arkaplanda arkaplan efektinin koyu yerleri saydamlaşır.
     Süzgeç tek bir SVG renk matrisi (eşik: SVLayers.keyMatrix). CSS kompozit
     yolunda arkaplan tuvaline CSS ile (visualizer.css, `.sv-bgkey`), tek
     yüzey yolunda (efekt zinciri, sahne geçişi) çizim sırasında aynı
     süzgeçle uygulanıyor; iki yol aynı görüntüyü veriyor. */
  let keyMatrixEl = null;
  function applyBackgroundKey(c) {
    const L = window.SVLayers;
    const on = L.seeThrough(c);
    if (on && !keyMatrixEl) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', 'sv-bg-key');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      keyMatrixEl = document.createElementNS(NS, 'feColorMatrix');
      keyMatrixEl.setAttribute('type', 'matrix');
      filter.appendChild(keyMatrixEl);
      svg.appendChild(filter);
      document.body.appendChild(svg);
    }
    if (keyMatrixEl) keyMatrixEl.setAttribute('values', L.keyMatrix(c));
    document.documentElement.classList.toggle('sv-bgkey', on);
    stack.setKeyFilter(on ? 'url(#sv-bg-key)' : null);
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
    /* Konsola da yazılıyor: yayın katmanında DevTools açan kullanıcı sebebi
       orada arıyor. v3.1.3'te hata yalnız gizli bir kutudaydı. */
    console.error('[görselleştirici] ' + msg);
  }

  // --------------------------------------------------------------------------
  // Başlat
  // --------------------------------------------------------------------------
  async function init() {
    if (!window.api) {
      showError('Başlatılamadı: pencere köprüsü yok');
      return;
    }
    // Studio presetleri (kullanıcının kendi shader'ları) ana süreçte tutulur.
    // Dinleyici listeden ÖNCE kurulur: kayıt o sırada gelirse yayın düşmesin
    // ve çıkış yeniden başlatılana kadar eski shader'da kalmasın.
    let presetsReady = false;
    const earlyDeltas = [];
    let presetGen = 0;
    let presetCatchBusy = false;
    const onPresetDelta = (d) => {
      const S = window.SVPresets;
      const ups = (d && Array.isArray(d.upsert)) ? d.upsert : [];
      const studio = ups.some((p) => p && p.kind !== 'milkdrop') ||
        (d && Array.isArray(d.remove) ? d.remove : []).some((id) => { const p = S.get(id); return !!p && p.kind !== 'milkdrop'; });
      let patched = false;
      if (typeof cfg !== 'undefined' && cfg && cfg.milkdrop) {
        for (let i = 0; i < ups.length; i++) {
          const p = ups[i];
          if (p && p.kind === 'milkdrop' && p.id === cfg.milkdrop.presetId && typeof p.source === 'string' && p.source !== cfg.milkdrop.source) {
            cfg.milkdrop = Object.assign({}, cfg.milkdrop, { source: p.source, name: p.name || cfg.milkdrop.name });
            patched = true;
            break;
          }
        }
      }
      S.applyDelta(d);
      if (studio) {
        stack.dispose();
        applyScene();
      } else if (patched && typeof applyConfig === 'function') {
        applyConfig(cfg);
      }
    };
    async function catchPresets() {
      if (!window.api.presetsSince || presetCatchBusy) return;
      presetCatchBusy = true;
      try {
        const page = await window.api.presetsSince(presetGen);
        if (!page) return;
        const nextGen = Number(page.gen) || 0;
        if (page.reset || page.bulk) {
          presetGen = nextGen;
          window.SVPresets.setUser(await window.api.getPresets());
          stack.dispose();
          applyScene();
          return;
        }
        presetGen = nextGen;
        const up = page.upsert || [];
        const rm = page.remove || [];
        if (!up.length && !rm.length) return;
        onPresetDelta({ upsert: up, remove: rm, gen: nextGen });
      } catch { /* ana süreç kapandıysa bir sonraki tur dener */ }
      finally { presetCatchBusy = false; }
    }
    if (window.api && window.api.onPresetsDelta) {
      window.api.onPresetsDelta((d) => {
        if (d && d.gen) presetGen = Math.max(presetGen, Number(d.gen) || 0);
        if (!presetsReady) { earlyDeltas.push(d); return; }
        onPresetDelta(d);
      });
    }
    let headGen = 0;
    try {
      if (window.api.presetsHead) {
        const head = await window.api.presetsHead();
        headGen = head && Number(head.gen) || 0;
      }
    } catch { headGen = 0; }
    try {
      window.SVPresets.setUser(await window.api.getPresets());
    } catch { /* preset yoksa yerleşiklerle devam */ }
    presetsReady = true;
    let maxEarly = 0;
    for (let i = 0; i < earlyDeltas.length; i++) {
      const d = earlyDeltas[i];
      if (d && d.gen) maxEarly = Math.max(maxEarly, Number(d.gen) || 0);
      onPresetDelta(d);
    }
    try {
      if (window.api.presetsSince) {
        const page = await window.api.presetsSince(headGen);
        if (page) {
          presetGen = Math.max(maxEarly, Number(page.gen) || 0);
          if (page.reset || page.bulk) {
            try { window.SVPresets.setUser(await window.api.getPresets()); } catch { /* liste yok */ }
            stack.dispose();
            applyScene();
          } else if ((page.upsert && page.upsert.length) || (page.remove && page.remove.length)) {
            onPresetDelta({ upsert: page.upsert || [], remove: page.remove || [], gen: page.gen });
          }
        }
      }
    } catch { /* yakalama yoksa yayın yeter */ }
    presetGen = Math.max(presetGen, maxEarly);
    setInterval(() => {
      if (cfg && cfg.mcp && cfg.mcp.enabled) catchPresets();
    }, 400);
    window.addEventListener('focus', () => { catchPresets(); });
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
    if (window.SVLyricsClock && window.SVLyricsClock.install) window.SVLyricsClock.install(window.api);
    /* LİDERİN MILKDROP SEÇİMİ (#585). Bu sayfa lider değilse ana süreç
       liderin seçimini buraya yolluyor ve motor kendi sayacı yerine onu
       gösteriyor — her ekranda aynı preset, aynı tohum. Zaman damgası
       bu sayfanın saatiyle: mesaj kesilince izleme 1,5 sn'de düşüyor. */
    if (window.api.onMdFollow) {
      window.api.onMdFollow((p) => {
        window.SVMdFollow = p ? Object.assign({ at: performance.now() }, p) : null;
      });
    }
    /* MILKDROP SPRITE'LARI (#577): ana süreç başlatma/silme komutlarını her
       motora yolluyor; sayfa sırayla kuyruğa koyuyor. Pencerenin kendi
       tuşları (K + iki hane...) komutu ana sürece gönderiyor — web
       çıkışında bu çağrı yok, orada tuşlar bir şey yapmıyor. */
    if (window.SVMilkdropSprites) {
      window.SVMilkdropSprites.listen(window.api);
      if (window.api.milkdropSprite) spriteKeys();
    }
    /* Çalan parça çıpası. Her kare gelmez — kaynak konumu ancak ara sıra
       günceller — aradaki değeri katmanlar SVNowPlaying ile hesaplar.
       Müzik pencere açılmadan çalıyorsa ilk örnek bu satırdan önce
       gitmiş olabilir. Preload son örneği saklar; burada bir de ana
       sürecin güncel durumunu isteriz ve bu arada canlı mesaj geldiyse
       onu ezmeyiz. */
    if (window.SVLateEvent) {
      await window.SVLateEvent.catchUp(window.SVNowLive, window.api);
    } else if (window.api.onNowPlaying) {
      window.api.onNowPlaying((st) => { window.SVNowLive.state = st; });
    }
    if (window.SVLyricsSync && window.SVLyricsSync.installLibrary) {
      window.SVLyricsSync.installLibrary(window.api);
    }
    window.addEventListener('resize', resize);

    raf = requestAnimationFrame(frame);
  }

  /* MilkDrop'un sprite tuşları (shared/milkdrop-sprites.js `spriteKey`).
     Kip açıkken sağ üstte kısa bir ipucu: ▶ başlatma, ■ silme, girilen
     haneler. Yakalama aşamasında dinleniyor: kipteyken ESC yüzen
     pencereyi kapatmasın, kipten çıksın. */
  function spriteKeys() {
    const S = window.SVMilkdropSprites;
    let st = { mode: '', digits: '' };
    let hint = null;
    let hideAt = 0;
    const show = () => {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'sv-md-keys';
        hint.style.cssText = 'position:fixed;top:12px;right:14px;z-index:100000;pointer-events:none;' +
          'font:600 15px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:4px 10px;border-radius:6px;';
        (document.body || document.documentElement).appendChild(hint);
      }
      const label = st.mode ? 'Sprite ' + (st.digits + '__').slice(0, 2) : '';
      if (window.SVIcons) window.SVIcons.set(hint, st.mode ? (st.mode === 'kill' ? 'stop' : 'play') : '', label);
      else hint.textContent = label;
      hint.style.display = st.mode ? 'block' : 'none';
      hideAt = performance.now() + 4000;
    };
    // Kip dört saniye tuşsuz kalırsa kapanıyor
    setInterval(() => {
      if (st.mode && performance.now() > hideAt) { st = { mode: '', digits: '' }; show(); }
    }, 500);
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const r = S.spriteKey(st, { key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      st = r.st;
      if (r.used) {
        e.preventDefault();
        e.stopImmediatePropagation();
        show();
      }
      if (r.cmd) Promise.resolve(window.api.milkdropSprite(r.cmd)).catch(() => {});
    }, true);
  }

  /* Katman yığınına dışarıdan tek erişim noktası — panelin önizlemesindeki
     `SVPreview.stack()` ile aynı desen. Öz test (#572) WebGL bağlamını
     buradan bulduğu katmanda bilerek kaybettirip karelerin geri geldiğini
     ölçüyor; başka türlü çizen motora ulaşmanın yolu yok. */
  window.SVStage = { stack: () => stack };

  init().catch((e) => showError('Başlatılamadı: ' + (e && e.message ? e.message : e)));
})();
