'use strict';
/* Hem yönetici panelinde hem görselleştirici penceresinde yüklenir.
   window.SV altında ortak varsayılanlar + yardımcılar sağlar. */
(function () {
  const DEFAULT_CONFIG = {
    version: 1,
    display: { id: null },

    audio: {
      sources: ['default'], // seçili ses kaynaklarının adı (birden fazla olabilir)
      sensitivity: 1.4, // genel kazanç
      smoothing: 0.65, // zaman yumuşatma (0..0.95)
      bassBoost: 1.0, // düşük frekans vurgusu
    },

    background: {
      type: 'gradient', // 'gradient' | 'solid'
      solidColor: '#08080f',
      gradient: {
        colors: ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'],
        style: 'soft', // 'soft' = yumuşak/parlamasız (Görsel 1 gibi), 'plasma' = parlamalı
        speed: 0.45,
        drift: 0.0, // tek yönlü kayma miktarı
        wander: 0.85, // sınırlı gezinme/dolanma alanı
        orbit: 0.75, // renk alanlarının yörüngesel hareketi
        swirl: 0.8, // merkez çevresi iç dönüş
        scale: 1.1,
        warp: 0.85, // bozulma miktarı (akışkanlık)
        audioReactivity: 0.85, // sese tepki (akış/dalgalanma)
        brightness: 1.0, // temel parlaklık
        audioBrightness: 0.45, // ses patlaması parlaklığı (ayarlanabilir)
        audioHue: 0.0, // ses ile renk kayması miktarı (0 = kapalı)
        hideLines: true, // belirgin damar/şimşek çizgilerini yumuşat
        grain: 0.05, // film greni (banding'i gizler)
        vignette: 0.25,
      },
    },

    visualizer: {
      type: 'bars', // 'none' | 'bars' | 'wave' | 'circular'
      rainbow: true,
      color: '#3aa6ff',
      color2: '#d24bff',
      barCount: 72,
      minFreq: 30,
      maxFreq: 16000,
      sensitivity: 1.0,
      mirror: false,
      lineWidth: 3,
      cap: true, // bar tepe noktaları
      glow: 0.45,
      gap: 0.28, // barlar arası boşluk oranı
      position: 'bottom', // 'bottom' | 'center' | 'full' (bars için)
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
      fpsCap: 60, // 30 | 60 | 120 | 0(sınırsız)
      renderScale: 1.0, // arkaplan çözünürlük ölçeği (0.5..1)
      pauseOnSilence: false,
      hideCursor: true,
    },

    // Ek görsel nesneler / partiküller. Bir veya birden fazla resim yüklenip
    // sahnede gezinir, saçılır, yörünge çizer; saydamlık + ses tepkisi ayarlanır.
    images: {
      enabled: false,
      items: [], // imageItem() ile üretilen nesneler
    },

    // Kullanıcı renk şablonları (arkaplan gradyanı). Kalıcıdır; içe/dışa aktarılabilir.
    userPresets: [], // { id, name, colors:[5] }

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
