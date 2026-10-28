/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/*
 * Offline (deterministik) video render motoru.
 * Ekran/ses KAYDI YAPMAZ: seçilen ses dosyasını çözer, her video karesi için
 * FFT'yi birebir hesaplar (loopback-helper.js ile aynı ölçek) ve görselleştiriciyle
 * AYNI efektleri (WebGL gradyan + 2D ön katman + logo) kare kare çizer.
 * Ham RGBA kareler ana sürece akıtılır; ffmpeg orada kayıpsız videoya kodlar.
 */
(function () {
  /* MilkDrop presetleri burada BEKLEYEREK derleniyor (#573). Canlı
     ekranlarda yeni preset arka planda derlenip hazır olunca geliyor; o
     an derlemenin hızına bağlı. Dışa aktarımda bir presetin hangi karede
     göründüğü buna kalamaz: aynı iş aynı videoyu vermeli. */
  window.SVMilkdropSync = true;
  /* Medya katmanı çevrimdışı (#539): video kendiliğinden oynamaz, her kare
     kare saatine sarılır; kamera açılmaz (canlı kaynak). */
  window.SV_OFFLINE = true;

  // ---- loopback-helper.js ile birebir aynı sabitler/ölçek ----
  const FFT_SIZE = 2048;
  const BINS = FFT_SIZE / 2; // 1024
  const MIN_DB = -90;
  const MAX_DB = -18;

  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  // loopback-helper.js'teki radix-2 FFT (birebir)
  function fft() {
    const n = FFT_SIZE;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const vr = re[b] * cr - im[b] * ci;
          const vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr; im[a] += vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  // ---- Durum ----
  const stageEl = document.getElementById('stage');
  const comp = document.getElementById('comp');
  /* Her karede getImageData ile geri okuma yapıldığı için willReadFrequently
     açık. Bu bayrak Chromium'u YAZILIM rasterizer'a düşürür ve kenar
     yumuşatma/gradyan dithering'i GPU'dan biraz farklı çıkar.

     Bu yüzden sahne doğrudan buraya çizilmez: katmanlar kendi normal (GPU)
     tuvallerine çizilip buraya kopyalanır — canlı pencere de tam olarak
     bunu yapar. Böylece dışa aktarılan video ekranda görülenle eşleşir.
     (Ölçüm: 'npm start -- --smoke --smoke-raster' iki rasterizer arasındaki
     farkı sayısal olarak gösterir.) */
  const compCtx = comp.getContext('2d', { willReadFrequently: true });

  const audio = new window.SVAudio();
  let cfg = null;
  let stack = null;
  // Modülasyon matrisi. Kaynaklar kare saatinden beslendiği için çevrimdışı
  // render belirlenimli kalır (aynı iş -> bit bazında aynı video).
  const modulator = new window.SVModulation.Modulator();
  let postfx = null;
  let sprites = null;
  let logo = null;

  /* Çözülmüş kanallar (#566). Tek kanallı dosyada ikisi AYNI dizi. Mono
     karışım artık ayrı bir diziye kopyalanmıyor: pencere başına eskisiyle
     aynı ifadeden hesaplanıyor, yani analiz aynı sayıları görüyor. */
  let pcmL = null;
  let pcmR = null;
  let totalSamples = 0;
  let sampleRate = 48000;
  let width = 1920;
  let height = 1080;
  let fps = 60;
  let totalFrames = 1;
  /* Aşama süreleri (#531). Yalnız iş `profile` isterse tutulur; hızlandırma
     iddiası ölçümle yapılsın diye: çizim, geri okuma, kodlayıcıyı bekleme. */
  let prof = null;
  let alpha = false;
  let yuv = null; // GPU I420 dönüştürücüsü (#531); RGBA yolunda null

  const ring = new Float32Array(FFT_SIZE);
  const ringL = new Float32Array(FFT_SIZE);
  const ringR = new Float32Array(FFT_SIZE);
  const freqBytes = new Uint8Array(BINS);
  const timeBytes = new Uint8Array(FFT_SIZE);
  const leftBytes = new Uint8Array(FFT_SIZE);
  const rightBytes = new Uint8Array(FFT_SIZE);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Belirli bir örnek konumunda (sampleEnd ile biten 2048 örneklik pencere) analiz et.
  // Çıktı: freqBytes (0..255, dB ölçekli) + timeBytes (128 merkez) + sol ve
  // sağ kanal baytları — loopback ile aynı.
  function analyzeAt(sampleEnd) {
    const start = sampleEnd - FFT_SIZE;
    const mono = pcmL === pcmR;
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      const inside = idx >= 0 && idx < totalSamples;
      const l = inside ? pcmL[idx] : 0;
      const r = inside ? pcmR[idx] : 0;
      ring[i] = mono ? l : (l + r) * 0.5;
      ringL[i] = l;
      ringR[i] = r;
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = ring[i] * hann[i];
      im[i] = 0;
    }
    fft();
    const range = MAX_DB - MIN_DB;
    for (let i = 0; i < BINS; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_SIZE / 4);
      let db = 20 * Math.log10(mag + 1e-9);
      let v = (db - MIN_DB) / range;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      freqBytes[i] = (v * 255) | 0;
    }
    const toByte = (s) => {
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      return (128 + s * 127) | 0;
    };
    for (let i = 0; i < FFT_SIZE; i++) {
      timeBytes[i] = toByte(ring[i]);
      leftBytes[i] = toByte(ringL[i]);
      rightBytes[i] = toByte(ringR[i]);
    }
  }

  // Ses dosyasını PCM'e çöz (kayıpsız çözümleme). 48000 Hz sabit — canlı boru hattıyla
  // aynı binHz (48000/2048) için. İlk iki kanal tutuluyor (loopback ile aynı);
  // mono karışım pencere başına ikisinin ortalaması.
  async function decodeAudio(arrayBuffer) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx({ sampleRate: 48000 });
    const buf = await ac.decodeAudioData(arrayBuffer);
    try { ac.close(); } catch (e) {}
    sampleRate = buf.sampleRate;
    const n = buf.length;
    const ch = buf.numberOfChannels;
    pcmL = buf.getChannelData(0);
    pcmR = ch <= 1 ? pcmL : buf.getChannelData(1);
    totalSamples = n;
    return buf.duration;
  }

  function waitImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve();
      const img = new Image();
      const done = () => resolve();
      img.onload = done;
      img.onerror = done;
      img.src = src;
      if (img.complete) done();
    });
  }

  /* playing kapalı: konum kare saatidir, duvar saati videoyu kaydırmaz. */
  function publishExportTrack(t) {
    const tag = window.SVExportTrack;
    if (!tag) return;
    const dur = sampleRate > 0 ? totalSamples / sampleRate : 0;
    window.SVNowLive = window.SVNowLive || {};
    window.SVNowLive.state = {
      has: !!(tag.title || tag.artist || tag.album || tag.artwork),
      playing: false,
      title: tag.title || '',
      artist: tag.artist || '',
      album: tag.album || '',
      artwork: tag.artwork || '',
      position: Math.max(0, t),
      duration: dur,
      updated: 0,
      received: 0,
    };
  }

  function loadLogo(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function setup(job) {
    const os = job.platform || 'win32';
    window.SV_PLATFORM = {
      os: os,
      isWindows: os === 'win32',
      isMac: os === 'darwin',
      isLinux: os === 'linux',
    };
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), job.cfg || {});
    // Video katmanlarının ara kopyaları (ana süreç hazırladı, #539)
    window.SVExportMediaMap = job.mediaMap && typeof job.mediaMap === 'object' ? job.mediaMap : {};
    alpha = !!job.alpha;
    /* Saydam biçim (#525): sahne yayın katmanıyla AYNI kuralla çizilir —
       "Şeffaf Arkaplan" açılmış gibi. Arkaplan boyanmaz; bir arkaplan
       efekti varsa koyu yerleri saydamlaşır. Ayrı bir kural yazılsaydı
       dışa aktarılan bindirme ekrandakinden farklı çıkardı. */
    if (alpha) cfg.background = Object.assign({}, cfg.background, { transparent: true });
    // Studio presetleri işin içinde gelir; modlar kurulmadan ÖNCE kaydedilmeli
    if (window.SVPresets && Array.isArray(job.presets)) window.SVPresets.setUser(job.presets);
    // Dışa aktarımda her zaman tam çözünürlük çizilir
    cfg.power = Object.assign({}, cfg.power, { renderScale: 1 });
    width = job.width;
    height = job.height;
    fps = job.fps;

    comp.width = width;
    comp.height = height;

    /* Ana süreç ffmpeg'i I420 girdiyle başlattıysa kare GPU'da çevrilmek
       ZORUNDA: dönüştürücü kurulamazsa iş açıkça duruyor, RGBA'ya sessizce
       düşmek ffmpeg'e yanlış boyutta kare göndermek olurdu. */
    yuv = null;
    if (job.pix === 'yuv420p') {
      yuv = window.SVYuvReadout && window.SVYuvReadout.create(width, height);
      if (!yuv) throw new Error('GPU renk dönüştürücüsü kurulamadı (WebGL2).');
    }

    /* Katman yığını. Canlı pencerelerle AYNI sınıf kullanılır; tek fark,
       burada tuvaller belgeye eklenmeyip tek bir birleştirme yüzeyine
       basılmasıdır (drawTo). Böylece dışa aktarımda ekrandakinden farklı
       bir sahne oluşması mümkün değil. */
    // Ek görsel nesneler / partiküller (resimler kare 0'dan önce yüklenir)
    if (cfg.images && cfg.images.enabled && Array.isArray(cfg.images.items) && cfg.images.items.length) {
      sprites = new window.SVSprites();
      sprites.setItems(cfg.images.items);
      await sprites.whenReady();
    }

    stack = new window.SVLayers.LayerStack(stageEl, {});
    if (sprites) stack.setSprites(sprites);
    if (alpha) installKeyFilter();
    stack.resize(width, height);
    stack.setConfig(cfg);
    setupMedia();
    /* Kusursuz döngü: canlı kaynaklar (web sayfası, Spout/Syphon) kendi
       saatiyle akıyor, son kare başa bağlanmaz. O anki kare dondurulur. */
    if (job.loopFreeze) await stack.freezeSources(8000);
    // Son-işlem zinciri dışa aktarımda da uygulanır; efektler ekrandakiyle
    // aynı sırada ve aynı parametrelerle çalışır.
    if (Array.isArray(cfg.postfx) && cfg.postfx.length && window.SVPostFX) {
      postfx = new window.SVPostFX.PostFX();
      postfx.setChain(cfg.postfx);
      postfx.resize(width, height);
      if (!postfx.hasWork()) postfx = null;
    }

    audio.applyConfig(cfg.audio);

    /* Seçilen dosyanın adı ve kapağı. Takip kapalıyken söz, yüklenen
       dosyada kalır; kütüphane ancak Çalan Parçayı İzle açıksa gelir. */
    window.SVExportTrack = job.track || null;
    if (Array.isArray(job.lyricsLibrary)) {
      window.SVLyricsLib = window.SVLyricsLib || { items: [], sig: '' };
      window.SVLyricsLib.items = job.lyricsLibrary;
    }
    publishExportTrack(0);
    if (job.track && job.track.artwork) await waitImage(job.track.artwork);

    if (cfg.logo.enabled && cfg.logo.src) {
      logo = await loadLogo(cfg.logo.src);
    }
    await preloadLayerLogos();
  }

  /* MEDYA KATMANLARI (#539). Dışa aktarıcı medya modunu hiç yüklemiyordu:
     video arkaplanlı bir yayın düzeni videoda arkaplansız çıkıyordu. Canlı
     pencerenin kurduğu gibi kurulur (visualizer.js applyMedia): yığında
     katman başına oynatıcı havuzu, katmansız kipte tek oynatıcı. Videolar
     ilk kare çizilmeden yüklenir; her kareden önce o karenin zamanına
     sarılır (seekMedia). */
  let mediaSingle = null;
  function setupMedia() {
    const L = window.SVLayers;
    if (!window.SVMedia || !L || !stack) return;
    const isStack = L.stackOn(cfg);
    const hasLayer = isStack && Array.isArray(cfg.layers) && cfg.layers.some((l) => l && l.kind === 'media' && l.enabled !== false);
    if (hasLayer) { stack.syncMedia(cfg); return; }
    if (!isStack && cfg.media && cfg.media.enabled) {
      mediaSingle = new window.SVMedia();
      stack.setMedia(mediaSingle);
      mediaSingle.apply(Object.assign({}, cfg.media, { enabled: true }));
    }
  }
  function mediaPlayers() {
    const out = [];
    if (stack && stack._mediaPool) for (const m of stack._mediaPool.values()) out.push(m);
    if (mediaSingle) out.push(mediaSingle);
    return out;
  }
  async function seekMedia(t) {
    const list = mediaPlayers().filter((m) => typeof m.seekTo === 'function');
    if (!list.length) return true;
    const res = await Promise.all(list.map((m) => m.seekTo(t)));
    return res.every((r) => r !== false);
  }

  /* KATMAN LOGOLARI ÖNCEDEN (#535, #539). Yığındaki logo katmanları
     görselini ilk karede eşzamansız istiyordu: kitaplık logosu videonun ilk
     karelerinde eksik kalabiliyordu. Değişim listesindeki her görsel de
     render başlamadan yüklenip çözülür — sıra canlıdakiyle aynı olsun ve
     geçiş anında görsel hazır olsun. */
  async function preloadLayerLogos() {
    const L = window.SVLayers;
    if (!L || !stack || typeof L.logoFileSrc !== 'function' || !Array.isArray(cfg.layers)) return;
    const urls = new Set();
    cfg.layers.forEach((l) => {
      if (!l || l.kind !== 'logo' || l.enabled === false) return;
      const lg = (l.settings && l.settings.logo) || cfg.logo;
      if (!lg) return;
      const own = L.logoFileSrc(lg);
      if (own) urls.add(own);
      const sw = lg.swap;
      if (sw && sw.enabled && Array.isArray(sw.items)) {
        sw.items.forEach((id) => { const u = L.logoFileSrc({ source: 'manual', libraryId: id }); if (u) urls.add(u); });
      }
    });
    await Promise.all(Array.from(urls).map((u) => {
      const img = stack._getImage(u);
      if (!img) return null;
      if (img.complete && img.naturalWidth) return null;
      return (img.decode ? img.decode() : new Promise((r) => { img.onload = r; img.onerror = r; })).catch(() => null);
    }));
  }

  /* Arkaplanın koyu yerlerini saydamlaştıran süzgeç. Görselleştirici
     penceresindekinin aynısı (visualizer.js): katman yığını onu tuvale
     çizerken uyguluyor. */
  function installKeyFilter() {
    const L = window.SVLayers;
    if (!L || typeof L.keyMatrix !== 'function') return;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'sv-bg-key');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const m = document.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', L.keyMatrix(cfg));
    filter.appendChild(m);
    svg.appendChild(filter);
    document.body.appendChild(svg);
    stack.setKeyFilter('url(#sv-bg-key)');
  }

  function drawLogo() {
    if (!logo || !cfg.logo.enabled) return;
    const l = cfg.logo;
    const minDim = Math.min(width, height);
    const size = minDim * clamp(l.scale, 0.03, 0.9);
    const pulse = 1 + audio.bass * l.pulse;
    const w = size * pulse;
    const ratio = logo.naturalHeight && logo.naturalWidth ? logo.naturalHeight / logo.naturalWidth : 1;
    const h = w * ratio;
    const cx = l.x * width;
    const cy = l.y * height;
    compCtx.save();
    compCtx.globalAlpha = clamp(l.opacity, 0, 1);
    if (l.glow > 0) {
      compCtx.shadowColor = 'rgba(255,255,255,0.6)';
      compCtx.shadowBlur = l.glow * 40 * (minDim / 1080);
    }
    compCtx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
    compCtx.restore();
  }

  // Tek kareyi çiz ve birleştirme yüzeyinin RGBA baytlarını döndür.
  /* Ses analizi kaydı. Kendi ses motoru ve modülatörü var: çizimin
     kullandığı nesnelere yalnız bakmak bile yetmezdi, çünkü getBars her
     çağrıda durum ilerletiyor. Ayrı nesneler aynı kare baytlarını okuyor;
     video bu kayıt açıkken de bit bazında aynı. */
  let anRec = null;
  function startAnalysis() {
    const A = window.SVAnalysisExport;
    const anAudio = new window.SVAudio();
    anAudio.applyConfig(cfg.audio);
    const anMod = new window.SVModulation.Modulator();
    const rec = new A.Recorder({ fps, fields: A.fieldIds(window.SVModulation.catalog(cfg)) });
    anRec = {
      rec,
      step(t, dt) {
        anAudio.ingestFrame({ freq: freqBytes, time: timeBytes, left: leftBytes, right: rightBytes, sampleRate });
        anAudio.update(dt);
        anMod.update(cfg, anAudio, t, dt);
        rec.push(anMod.values, anAudio.analysis);
      },
    };
  }

  function renderFrame(i) {
    const t0 = prof ? performance.now() : 0;
    const t = i / fps;
    const dt = 1 / fps;
    publishExportTrack(t);
    const sampleEnd = Math.round(t * sampleRate);

    analyzeAt(sampleEnd);
    if (anRec) anRec.step(t, dt);
    audio.ingestFrame({ freq: freqBytes, time: timeBytes, left: leftBytes, right: rightBytes, sampleRate });
    audio.update(dt);

    /* Zaman çizelgesi otomasyonu. Gösteri saati (showclock.js) BURADA
       KULLANILMAZ: o duvar saatine dayanır ve aynı işi iki kez
       çalıştırdığında farklı kareler üretirdi. Çevrimdışı işlemede zaman
       yalnızca KARE İNDEKSİNDEN gelir — dışa aktarımın regresyon ağı
       olma özelliği buna bağlı. */
    let base = cfg;
    if (cfg.timeline && cfg.timeline.enabled && window.SVTimeline) {
      base = window.SVTimeline.applyAutomation(cfg, cfg.timeline, t).cfg;
    }

    // Modülasyon: kaynaklar kare saatinden (t = kare/fps) beslendiği için
    // aynı iş iki kez çalıştırıldığında bit bazında aynı sonucu verir.
    modulator.update(base, audio, t, dt);
    const mcfg = modulator.apply(base, dt);
    if (postfx && modulator.touches('postfx')) postfx.setChain(mcfg.postfx || []);

    // Tüm katmanlar tek birleştirme yüzeyine (logo dahil, kendi sırasında)
    stack.composeTo(compCtx, audio, mcfg, t, dt, drawLogo);

    if (postfx) {
      // Efekt zinciri GPU'da çalışır; sonucu geri okuyabilmek için
      // birleştirme yüzeyine yazarız.
      postfx.render(comp, audio, t, dt);
      compCtx.setTransform(1, 0, 0, 1, 0, 0);
      compCtx.globalCompositeOperation = 'copy';
      compCtx.globalAlpha = 1;
      compCtx.drawImage(postfx.canvas, 0, 0, width, height);
      compCtx.globalCompositeOperation = 'source-over';
    }

    const master = Number.isFinite(Number(cfg.master)) ? Math.max(0, Math.min(1, Number(cfg.master))) : 1;
    if (master < 1) {
      /* Saydam biçimde ana opaklık görüntüyü SAYDAMLAŞTIRIR; siyaha
         boyamak bindirmenin arkasını örterdi. */
      compCtx.globalCompositeOperation = alpha ? 'destination-in' : 'source-over';
      compCtx.globalAlpha = alpha ? master : 1 - master;
      compCtx.fillStyle = '#000000';
      compCtx.fillRect(0, 0, width, height);
      compCtx.globalAlpha = 1;
      compCtx.globalCompositeOperation = 'source-over';
    }

    if (prof) prof.drawMs += performance.now() - t0;
    const t1 = prof ? performance.now() : 0;
    // I420 (GPU'da çevrilmiş) ya da ham RGBA
    const data = yuv ? yuv.read(comp) : compCtx.getImageData(0, 0, width, height).data;
    if (prof) prof.readMs += performance.now() - t1;
    return data;
  }

  /* MilkDrop dokuları (#586) diskten ASENKRON geliyor. Canlı pencere
     beklemiyor ama burada beklemek şart: yoksa dokunun hangi karede
     yerleştiği diskin o anki hızına kalır ve aynı iş iki kez farklı video
     verir. Her kareden sonra uçuştaki doku varsa bekleniyor — doku her
     çalıştırmada istendiği karenin HEMEN ardından yerleşiyor.

     Süre sınırı bir sigorta: bir istek hiç dönmezse dışa aktarım sonsuza
     kadar beklemesin. Süre dolarsa iş AÇIKÇA duruyor — beklemeden devam
     etmek, sessizce farklı bir video yazmak olurdu. */
  const ASSET_WAIT_MS = 20000;
  const MEDIA_LATE = 'Video katmanının karesi okunamadı: dosya açılamadı ya da çözülemedi. Video her çalıştırmada aynı çıkmayacağı için dışa aktarım durduruldu.';
  const ASSET_LATE = 'MilkDrop dokusu 20 saniyede yüklenmedi. Video her çalıştırmada aynı çıkmayacağı için dışa aktarım durduruldu.';
  async function settleAssets() {
    if (!stack || typeof stack.assetsPending !== 'function' || !stack.assetsPending()) return true;
    let timer = null;
    const late = new Promise((r) => { timer = setTimeout(() => r(false), ASSET_WAIT_MS); });
    const ok = await Promise.race([stack.whenAssetsSettled().then(() => true), late]);
    clearTimeout(timer);
    return ok;
  }

  async function run(job) {
    prof = job.profile ? { decodeMs: 0, setupMs: 0, drawMs: 0, readMs: 0, sendMs: 0, waitMs: 0, settleMs: 0, mediaMs: 0, mediaFail: 0 } : null;
    let tp = performance.now();
    const duration = await decodeAudio(job.audioBuffer);
    if (prof) { prof.decodeMs = performance.now() - tp; tp = performance.now(); }
    if (job.analysisOnly) return runAnalysisOnly(job, duration);
    await setup(job);
    if (job.analysis) startAnalysis();
    if (prof) prof.setupMs = performance.now() - tp;
    /* Süre ana süreçten gelebilir (#523): sabit saniye, zaman çizelgesi ya
       da N ölçü. Ses bittikten sonraki kareler sessizlikle çiziliyor
       (analyzeAt dosya dışını sıfır okuyor); ffmpeg sesi de aynı süreye
       dolduruyor ya da kesiyor. */
    const renderSec = Number(job.durationSec) > 0 ? Number(job.durationSec) : duration;
    totalFrames = Math.max(1, Math.ceil(renderSec * fps));
    window.exp.ready(totalFrames);

    // Boru hattı (pipeline): render, IPC ve ffmpeg kodlaması ÜST ÜSTE çalışsın.
    // Karelerin tek tek beklenmesi yerine WINDOW kadar kareyi "uçuşta" tutarız;
    // böylece render ederken ffmpeg de önceki kareleri kodlar. Bu, GPU'da
    // dışa aktarımı belirgin biçimde hızlandırır (darboğaz = max(render, encode)).
    // WINDOW, bellek için kare boyutuna göre sınırlanır (~64 MB tampon).
    const frameBytes = width * height * 4;
    const WINDOW = Math.max(3, Math.min(12, Math.round((64 * 1024 * 1024) / frameBytes)));

    const progStep = Math.max(1, Math.round(fps / 4));
    let cancelled = false;
    const pending = [];

    for (let i = 0; i < totalFrames && !cancelled; i++) {
      const tm = prof ? performance.now() : 0;
      const seekOk = await seekMedia(i / fps);
      if (prof) { prof.mediaMs += performance.now() - tm; if (!seekOk) prof.mediaFail++; }
      /* Kare okunamadıysa o anki (yanlış) kare çizilirdi: aynı iş her
         çalıştırmada farklı video verir. Durdurup söylemek daha dürüst. */
      if (!seekOk) {
        window.exp.error(MEDIA_LATE);
        return;
      }
      const data = renderFrame(i);
      const ts = prof ? performance.now() : 0;
      // Geri basınç: ana süreç kareyi ffmpeg.stdin'e yazana kadar bekler; ama
      // hemen await etmeyip pencereyi dolduruyoruz (render/encode örtüşmesi).
      const p = window.exp.sendFrame(data, i).then((res) => {
        if (res && res.cancel) cancelled = true;
      });
      if (prof) prof.sendMs += performance.now() - ts; // invoke kareyi burada, eşzamanlı serileştiriyor
      pending.push(p);
      let tw = prof ? performance.now() : 0;
      if (pending.length >= WINDOW) await pending.shift();
      if (prof) { prof.waitMs += performance.now() - tw; tw = performance.now(); }
      if (i % progStep === 0) window.exp.progress(i + 1, totalFrames);
      if (!(await settleAssets())) {
        window.exp.error(ASSET_LATE);
        return;
      }
      if (prof) prof.settleMs += performance.now() - tw;
    }

    const tw = prof ? performance.now() : 0;
    await Promise.all(pending);
    if (prof) prof.waitMs += performance.now() - tw;
    if (cancelled) {
      window.exp.cancelled();
      return;
    }
    window.exp.progress(totalFrames, totalFrames);
    if (anRec) window.exp.analysis(anRec.rec.finish(analysisMeta(job)));
    window.exp.finish(prof ? Object.assign({ frames: totalFrames }, prof) : null);
  }

  function analysisMeta(job) {
    return { file: job.audioName || '', durationSec: totalFrames / fps, sampleRate, generator: job.generator || '' };
  }

  /* Yalnız analiz: sahne kurulmuyor, kare çizilmiyor, ffmpeg yok. Ses
     aynı kare saatiyle çözümleniyor, yani aynı dosya video dışa
     aktarımının yanına yazılanla aynı. İptal ana süreçten soruluyor. */
  async function runAnalysisOnly(job, duration) {
    cfg = window.SV.deepMerge(window.SV.defaultConfig(), job.cfg || {});
    fps = job.fps;
    const renderSec = Number(job.durationSec) > 0 ? Number(job.durationSec) : duration;
    totalFrames = Math.max(1, Math.ceil(renderSec * fps));
    startAnalysis();
    window.exp.ready(totalFrames);
    const step = Math.max(1, fps * 2);
    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      analyzeAt(Math.round(t * sampleRate));
      anRec.step(t, 1 / fps);
      if (i % step === 0) {
        window.exp.progress(i + 1, totalFrames);
        // Olay döngüsüne nefes: ilerleme gitsin, iptal sorusu cevaplansın
        if (await window.exp.cancelRequested()) { window.exp.cancelled(); return; }
      }
    }
    window.exp.progress(totalFrames, totalFrames);
    window.exp.analysis(anRec.rec.finish(analysisMeta(job)));
    window.exp.finish(null);
  }

  window.exp.onJob((job) => {
    let ab = job.audioBuffer;
    // Node Buffer/Uint8Array geldiyse ArrayBuffer'a normalize et
    if (ab && ab.buffer && ab.byteLength != null && !(ab instanceof ArrayBuffer)) {
      ab = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
    }
    job.audioBuffer = ab;
    run(job).catch((e) => window.exp.error(String((e && e.stack) || e)));
  });
})();
