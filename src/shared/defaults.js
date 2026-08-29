'use strict';
/* Hem yönetici panelinde hem görselleştirici penceresinde yüklenir.
   window.SV altında ortak varsayılanlar + yardımcılar sağlar. */
(function () {
  const DEFAULT_CONFIG = {
    version: 1,
    // Görselleştirmenin açılacağı ekranlar. Birden fazla seçilirse her birinde
    // ayrı bir tam ekran pencere açılır. `id` eski sürümlerle uyum için kalır.
    display: { id: null, ids: [] },

    audio: {
      // Aygıt adları makineye özeldir; varsayılan her zaman sistem çıkışıdır.
      sources: ['default'],
      sensitivity: 0.25, // genel kazanç
      smoothing: 0.5, // zaman yumuşatma (0..0.95)
      bassBoost: 2.05, // düşük frekans vurgusu
    },

    background: {
      // 'gradient' (WebGL) | 'solid' | 2D modlar:
      // 'waves' | 'aurora' | 'starfield' | 'grid' | 'bokeh' | 'rain' | 'network' | 'rings'
      type: 'gradient',
      solidColor: '#08080f',
      // Not: 2D arkaplan modları da bu bloğun colors/speed/audioReactivity/
      // brightness/vignette alanlarını okur; böylece renk seçiciler, hazır
      // şablonlar ve kullanıcı şablonları tüm arkaplan modlarında geçerli kalır.
      gradient: {
        colors: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'],
        style: 'plasma', // 'soft' = yumuşak/parlamasız, 'plasma' = parlamalı
        speed: 0.5,
        drift: 0.05, // tek yönlü kayma miktarı
        wander: 0.85, // sınırlı gezinme/dolanma alanı
        orbit: 1.12, // renk alanlarının yörüngesel hareketi
        swirl: 0.8, // merkez çevresi iç dönüş
        scale: 1.1,
        warp: 0.58, // bozulma miktarı (akışkanlık)
        audioReactivity: 0.8, // sese tepki (akış/dalgalanma)
        brightness: 1.0, // temel parlaklık
        audioBrightness: 1.8, // ses patlaması parlaklığı (ayarlanabilir)
        audioHue: 0.36, // ses ile renk kayması miktarı (0 = kapalı)
        hideLines: true, // belirgin damar/şimşek çizgilerini yumuşat
        grain: 0.0, // film greni (banding'i gizler)
        vignette: 0.34,
      },

      // --- 2D arkaplan modlarının kendi ayarları ---
      // Ortak alanlar (renkler, akış hızı, ses tepkisi, parlaklık, vinyet)
      // yukarıdaki gradient bloğundan okunur; aşağıdakiler moda özeldir.
      starfield: {
        count: 340, // yıldız sayısı
        depth: 1.0, // perspektif derinliği
        size: 1.0, // yıldız boyutu çarpanı
        trail: 1.0, // hız izi uzunluğu
        twinkle: 0.35, // parıldama miktarı
        bassPush: 2.2, // bas darbesinin hızlandırma etkisi
      },
      grid: {
        horizon: 0.52, // ufuk çizgisinin dikey konumu
        rows: 18, // yatay çizgi sayısı
        cols: 26, // dikey çizgi sayısı
        lineWidth: 1.0,
        horizonGlow: 0.55, // ufuk parlamasının gücü
        skyIntensity: 0.95, // gökyüzü gradyanının yoğunluğu
        spectrumBars: 1.0, // dikey çizgilerin spektruma tepkisi
        bassPush: 1.6,
      },
      waves: {
        layers: 6, // katman sayısı
        amplitude: 1.0, // tepe yüksekliği
        frequency: 1.0, // dalga sıklığı
        spread: 1.0, // katmanlar arası açıklık
        opacity: 1.0,
        bassPush: 1.1,
      },
      bokeh: {
        count: 26, // ışık topu sayısı
        size: 1.0, // boyut çarpanı
        sizeVar: 1.0, // boyut çeşitliliği
        drift: 1.0, // süzülme miktarı
        pulse: 0.5, // bas nabzı
        opacity: 1.0,
      },
      rain: {
        columns: 68, // sütun sayısı
        speed: 1.0,
        trail: 1.0, // damla izinin uzunluğu
        density: 0.7, // aynı anda düşen sütun oranı
        thickness: 1.0,
        bassPush: 1.4,
      },
      aurora: {
        bands: 5, // perde sayısı
        amplitude: 1.0, // dalgalanma yüksekliği
        thickness: 1.0, // perde kalınlığı
        softness: 1.0, // kenar yumuşaklığı
        height: 0.55, // perdelerin dikey konumu
        bassPush: 1.2,
      },
      network: {
        nodes: 54, // düğüm sayısı
        linkDist: 0.18, // bağlantı mesafesi (kısa kenara oran)
        nodeSize: 1.0,
        lineWidth: 1.0,
        speed: 1.0,
        bassPush: 1.5,
      },
      rings: {
        rate: 2.4, // saniyedeki halka sayısı
        speed: 1.0, // genişleme hızı
        thickness: 1.0,
        beatSpawn: 1.0, // bas darbesinde ek halka doğurma
        fade: 1.0, // sönme hızı
      },
      nebula: {
        clouds: 7, // bulut katmanı sayısı
        size: 1.0, // bulut yarıçapı çarpanı
        softness: 1.0, // kenar yumuşaklığı
        drift: 1.0, // sürüklenme hızı
        density: 0.75, // yoğunluk / opaklık
        bassPush: 1.4,
      },
      hexgrid: {
        size: 1.0, // altıgen boyutu
        gap: 0.14, // hücreler arası boşluk
        spectrum: 1.0, // spektrumun hücrelere yansıması
        wave: 0.6, // merkezden yayılan dalga
        speed: 1.0,
        bassPush: 1.5,
      },
      ink: {
        blobs: 5, // mürekkep damlası sayısı
        viscosity: 1.0, // akış yumuşaklığı
        swirl: 1.0, // burulma miktarı
        spread: 1.0, // yayılma alanı
        opacity: 0.9,
        bassPush: 1.6,
      },
      snow: {
        count: 260, // parçacık sayısı
        size: 1.0,
        fall: 1.0, // düşme hızı
        sway: 1.0, // yanal salınım
        depth: 1.0, // derinlik katmanları
        bassPush: 1.2,
      },
      city: {
        buildings: 34, // bina sayısı
        height: 1.0, // bina yüksekliği çarpanı
        windows: 1.0, // pencere yoğunluğu
        skyGlow: 0.8, // gökyüzü parlaması
        parallax: 1.0, // ikinci katman kayması
        bassPush: 1.4,
      },
      corridor: {
        rings: 26, // koridor halkası sayısı
        speed: 1.0, // ilerleme hızı
        sides: 0, // 0 = daire, 3..12 = çokgen
        twist: 0.5, // dönüş miktarı
        lineWidth: 1.0,
        bassPush: 1.8,
      },
      spiral: {
        arms: 3, // kol sayısı
        turns: 4.5, // tur sayısı
        thickness: 1.0,
        speed: 1.0,
        taper: 0.7, // uca doğru incelme
        bassPush: 1.3,
      },
      mosaic: {
        cells: 26, // hücre sayısı (kısa kenar)
        jitter: 0.55, // hücre düzensizliği
        borders: 0.35, // hücre kenar kalınlığı
        response: 1.0, // spektrum tepkisi
        speed: 0.6,
        bassPush: 1.2,
      },
    },

    visualizer: {
      // 'none' | 'bars' | 'centerBars' | 'blocks' | 'dots' | 'wave' | 'ribbon' |
      // 'terrain' | 'circular' | 'radialWave' | 'starburst' | 'tunnel' | 'orb' |
      // 'particles' | 'spectrogram' | 'kaleido' | 'helix' | 'metaball' |
      // 'fireworks' | 'vortex' | 'mandala' | 'skyline' | 'lightning' |
      // 'ripplegrid' | 'lissajous' | 'strings' | 'bubbles' | 'wave3d' |
      // 'arcs' | 'pinwheel' | 'feedback' (MilkDrop ailesi) | 'custom' (Studio)
      type: 'bars',
      rainbow: true,
      color: '#3aa6ff',
      color2: '#d24bff',
      barCount: 160,
      minFreq: 20,
      maxFreq: 20000,
      sensitivity: 0.7,
      mirror: false,
      lineWidth: 3,
      cap: true, // bar tepe noktaları
      glow: 0.46,
      gap: 0.36, // barlar arası boşluk oranı
      position: 'center', // 'bottom' | 'center' | 'full' (bars için)
      thickness: 0.42, // dalga/çember için
    },

    logo: {
      enabled: false,
      src: null, // dataURL
      scale: 0.22, // ekranın kısa kenarına oran
      opacity: 1,
      pulse: 0.3, // sese tepki (büyüme)
      x: 0.5,
      y: 0.5, // konum oranı (otomatik ortalama = 0.5, 0.5)
      glow: 0.2,
    },

    power: {
      // 0 = ekranla eşitle (her yenilemede bir kare). En akıcı sonuç budur:
      // ekranın yenileme hızının tam böleni olmayan bir sınır (75 Hz'de 60 gibi)
      // kare aralıklarını eşitsizleştirir.
      fpsCap: 120, // 0(ekranla eşitle) | 30 | 60 | 120
      renderScale: 1.0, // arkaplan çözünürlük ölçeği (0.5..1)
      pauseOnSilence: false,
      hideCursor: true,
      // Görselleştirme penceresini her zaman diğer pencerelerin üstünde tut.
      // Başka bir uygulama öne çıkarsa pencere kendini yeniden üste taşır.
      alwaysOnTop: false,
    },

    // Windows Dynamic Lighting (LampArray). Uyumlu aygıt bulunamazsa yönetici
    // paneli açılışta bunu otomatik olarak kapatır.
    lighting: {
      enabled: true,
      mode: 'beat-pulse',
      color: '#ff0000',
      color2: '#f00000',
      bassColor: '#52ff3f',
      midColor: '#35b8ff',
      trebleColor: '#d43cff',
      brightness: 1.0,
      intensity: 1.0,
      smoothing: 0.48,
      updateRate: 5,
      layout: 'global', // 'global' | 'per-device' | 'uniform'
      paletteSource: 'background', // 'visualizer' | 'background' | 'bands' | 'rainbow' | 'custom'
      colorSpeed: 0.45,
      spread: 2.25,
      saturation: 0.92,
      baseLevel: 0.02,
      bassGain: 1.9,
      midGain: 1.6,
      trebleGain: 1.05,
      spectrumContrast: 0.82,
      zoneBlend: 0.55,
      flashStrength: 1.5,
      flashThreshold: 0.52,
      flashDecay: 0.87,
      triggerBand: 'auto', // 'bass' | 'mid' | 'treble' | 'level' | 'auto'
      rippleSpeed: 0.8,
      rippleWidth: 0.16,
      rippleDirection: 'forward', // 'forward' | 'reverse' | 'alternate'
      fusionMix: 0.55,
      flowSpeed: 0.45,
      audioAcceleration: 1.3,
      bandResponse: 'instant', // 'instant' | 'punchy' | 'smooth'
      bandAttack: 0.92,
      bandRelease: 0.38,
      bandThreshold: 0.6,
      bandHardness: 0.63,
      bandSeparation: 0.78,
      bandPattern: 'zones', // 'zones' | 'alternate' | 'mirror' | 'dominant'
      rainbowStyle: 'ordered', // 'ordered' | 'single'
      rainbowSpeed: 0.5,
      rainbowAudioBand: 'level',
      rainbowAudioBrightness: 0.85,
      rainbowBaseBrightness: 0.2,
      rainbowSpread: 1.0,
      thresholdBurstSource: 'bass', // 'bass' | 'mid' | 'treble' | 'level' | 'auto'
      thresholdBurstThreshold: 0.55,
      thresholdBurstMode: 'hybrid', // 'pulse' | 'proportional' | 'hybrid'
      thresholdBurstStrength: 1.0,
      thresholdBurstDecay: 0.82,
      thresholdBurstCooldown: 120,
      thresholdBurstBaseBrightness: 0.04,
      thresholdBurstColorPosition: 'source', // 'source' | 'center' | 'spread'
      deviceColors: {},
      deviceLedColors: {},
    },

    // Ek görsel nesneler / partiküller. Bir veya birden fazla resim yüklenip
    // sahnede gezinir, saçılır, yörünge çizer; saydamlık + ses tepkisi ayarlanır.
    images: {
      enabled: false,
      items: [], // imageItem() ile üretilen nesneler
    },

    // Kullanıcı renk şablonları (arkaplan gradyanı). Kalıcıdır; içe/dışa aktarılabilir.
    userPresets: [], // { id, name, colors:[5] }

    // Sahneler: tüm görünümün (arkaplan + görselleştirici + logo + görsel nesneler)
    // adlandırılmış anlık görüntüsü. Tek tıkla geri yüklenir; içe/dışa aktarılabilir.
    // { id, name, createdAt, data: { background, visualizer, logo, images } }
    scenes: [],

    // ------------------------------------------------------------------
    // Yayın çıkışı (OBS / tarayıcı kaynağı + mobil uzaktan kumanda)
    //
    // Uygulama yerel bir HTTP + WebSocket sunucusu açar. OBS'e "Tarayıcı
    // Kaynağı" olarak eklenen sayfa, görselleştiricinin AYNI motorunu
    // çalıştırır; ses analizi kareleri WebSocket ile akar. Böylece pencere
    // yakalamaya, ekran kaydına veya native eklentiye gerek kalmaz.
    // ------------------------------------------------------------------
    stream: {
      enabled: false,
      port: 8722,
      lan: false, // true = 0.0.0.0 (telefon/başka makine erişir), false = yalnız 127.0.0.1
      token: '', // boşsa açılışta üretilir; LAN modunda zorunludur
      transparent: true, // arkaplanı saydam bırak (OBS'te üst katman olarak)
      remote: true, // /remote mobil kumanda sayfası açık mı
      overlayFps: 60, // tarayıcı kaynağının kare hızı sınırı
      quality: 1.0, // tarayıcı kaynağı çözünürlük ölçeği
    },

    // ------------------------------------------------------------------
    // Harici kontrol yüzeyleri (MIDI / OSC)
    // Eşleme: { id, source:'midi'|'osc', channel, cc, address, path, min, max, mode }
    // ------------------------------------------------------------------
    control: {
      midi: { enabled: false, deviceId: 'all', mappings: [] },
      osc: { enabled: false, port: 9000, mappings: [] },
    },

    // ------------------------------------------------------------------
    // Medya katmanı: web kamerası veya video dosyası sahneye katman olarak
    // girer; sese göre yakınlaşır, rengi kayar, kaleydoskoba girer.
    // ------------------------------------------------------------------
    media: {
      enabled: false,
      source: 'webcam', // 'webcam' | 'file'
      deviceId: '', // boş = varsayılan kamera
      file: null, // video dosyası (file:// URL)
      fit: 'cover', // 'cover' | 'contain' | 'stretch'
      opacity: 0.85,
      blend: 'normal', // 'normal' | 'screen' | 'add' | 'multiply'
      layer: 'back', // 'back' (görselin arkasında) | 'front'
      loop: true,
      mirror: false,
      kaleido: 0, // 0 = kapalı, 3..12 = dilim sayısı
      hue: 0, // renk kayması (0..1)
      saturate: 1,
      audioZoom: 0.12, // bas -> yakınlaşma
      audioOpacity: 0, // bas -> saydamlık nabzı
    },

    // ------------------------------------------------------------------
    // Studio: kullanıcının kendi yaptığı görselleştirici/arkaplan presetleri.
    // Preset İÇERİĞİ burada DEĞİL, userData/presets/*.json altında durur:
    // ayar dosyası her kaydırıcı hareketinde diske yazılıyor, shader
    // kaynağını oraya koymak dosyayı gereksiz şişirirdi. Burada yalnızca
    // seçim ve kullanıcının o presete verdiği parametre değerleri tutulur.
    // ------------------------------------------------------------------
    custom: {
      visualizerId: null, // visualizer.type === 'custom' iken kullanılan preset
      backgroundId: null, // background.type === 'custom' iken kullanılan preset
      params: {}, // { presetId: { paramAdı: değer } }
    },

    // MilkDrop ailesi geri besleme (feedback) motoru ayarları
    feedback: {
      zoom: 1.006,
      rotate: 0.0,
      warp: 0.55,
      decay: 0.965,
      dx: 0.0,
      dy: 0.0,
      swirl: 0.35,
      waveMode: 'line', // 'line' | 'circle' | 'dual' | 'spectrum'
      waveAmp: 1.0,
      waveThickness: 1.0,
      echo: 0.0,
      bassZoom: 0.05,
      bassRotate: 0.02,
      sharpen: 0.25,
    },

    // Video dışa aktarma (MP3/ses -> kayıpsız video). Ekran/ses kaydı değil:
    // her kare offline ve birebir render edilir, ses kaynaktan kopyalanır.
    export: {
      resolution: '1080p', // '720p' | '1080p' | '1440p' | '2160p'
      fps: 60, // 30 | 60
      quality: 'visually-lossless', // 'visually-lossless' | 'high' | 'balanced'
      encoder: 'gpu', // 'gpu' (NVIDIA NVENC, hızlı) | 'cpu' (libx264, en uyumlu)
      speed: 'balanced', // 'fast' | 'balanced' | 'quality' — hız/kalite dengesi (preset)
    },
  };

  // Ek görsel nesne (partikül emitör) varsayılanları.
  const IMAGE_DEFAULTS = {
    name: 'Görsel',
    src: null, // dataURL
    count: 14, // kopya / partikül sayısı
    size: 0.07, // kısa kenara oran
    sizeVar: 0.45, // boyut rastgeleliği (0..1)
    opacity: 0.85,
    motion: 'float', // 'static'|'float'|'orbit'|'swirl'|'scatter'|'rise'|'fall'
    speed: 0.5,
    spread: 0.7, // gezinme alanı / yörünge yarıçapı
    spin: 0.15, // kendi ekseninde dönüş
    audioSize: 0.45, // bas -> boyut nabzı
    audioSpeed: 0.35, // seviye -> hareket hızı
    audioOpacity: 0.0, // bas -> saydamlık nabzı
    glow: 0.15,
    blend: 'normal', // 'normal'|'screen'|'add'
    layer: 'front', // 'front' (görselin önünde) | 'back' (arkasında)
    noOverlap: false, // üst üste binmeyi engelle
    minDist: 1.1,    // spriteların merkez mesafesi (boyut çarpanı); 1=kenar kenar, >1=boşluk
  };

  // Yeni bir görsel nesne üret (benzersiz id + deterministik seed ile)
  function imageItem(over) {
    const seed = ((Date.now() & 0xffffff) ^ ((Math.random() * 0xffffff) | 0)) >>> 0 || 1;
    return Object.assign({}, IMAGE_DEFAULTS, { id: 'img_' + seed.toString(36), seed }, over || {});
  }

  // Eksik alanları varsayılanlarla doldur (eski kayıtlar / içe aktarım için)
  function normalizeImageItem(it) {
    const out = Object.assign({}, IMAGE_DEFAULTS, it || {});
    if (out.seed == null) out.seed = ((Math.random() * 0xffffff) | 0) >>> 0 || 1;
    if (out.id == null) out.id = 'img_' + out.seed.toString(36);
    return out;
  }

  // Hazır renk şablonları (arkaplan gradyanı)
  const GRADIENT_PRESETS = [
    { name: 'Aurora', colors: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'] },
    { name: 'Gün Batımı', colors: ['#ff5e62', '#ff9966', '#ffcf6b', '#c94b8e', '#5b2c83'] },
    { name: 'Okyanus', colors: ['#0f2027', '#1c92d2', '#2af5d4', '#136a8a', '#0b486b'] },
    { name: 'Neon', colors: ['#ff00cc', '#3333ff', '#00ffe0', '#9d00ff', '#ff0066'] },
    { name: 'Orman', colors: ['#0b3d2e', '#1e6f5c', '#56c596', '#a3eb9d', '#0f5132'] },
    { name: 'Lav', colors: ['#1a0000', '#7a0000', '#ff2e00', '#ff8a00', '#ffd000'] },
    { name: 'Pastel', colors: ['#a8e6cf', '#dcedc1', '#ffd3b6', '#ffaaa5', '#d7a6ff'] },
    { name: 'Gece', colors: ['#020111', '#191654', '#43377c', '#7b2ff7', '#22264b'] },
    { name: 'Buz', colors: ['#cfefff', '#74c0ff', '#3a7bd5', '#7ee8fa', '#eaf6ff'] },
    { name: 'Tek Renk', colors: ['#3aa6ff', '#3aa6ff', '#1c4fa0', '#3aa6ff', '#1c4fa0'] },
  ];

  // Derin birleştirme (kaydedilen ayarları varsayılanlarla doldurur)
  function deepMerge(base, override) {
    if (override == null) return clone(base);
    if (Array.isArray(base)) {
      return Array.isArray(override) ? override.slice() : clone(base);
    }
    if (typeof base === 'object' && base !== null) {
      const out = {};
      for (const k of Object.keys(base)) {
        out[k] = deepMerge(base[k], override ? override[k] : undefined);
      }
      // override içindeki ekstra anahtarları da koru
      if (override && typeof override === 'object') {
        for (const k of Object.keys(override)) {
          if (!(k in out)) out[k] = override[k];
        }
      }
      return out;
    }
    return override === undefined ? base : override;
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function defaultConfig() {
    return clone(DEFAULT_CONFIG);
  }

  // Hex -> [r,g,b] 0..1
  function hexToRgb01(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(
      h.length === 3 ? h.split('').map((c) => c + c).join('') : h,
      16
    );
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  window.SV = {
    DEFAULT_CONFIG,
    GRADIENT_PRESETS,
    IMAGE_DEFAULTS,
    imageItem,
    normalizeImageItem,
    defaultConfig,
    deepMerge,
    clone,
    hexToRgb01,
  };
})();
