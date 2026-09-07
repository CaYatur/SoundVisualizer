'use strict';
/* Dinamik / Olay Temelli Renk Teması Motoru.
 *
 * Windows SMTC üzerinden gelen çalan parça bilgilerine (özellikle albüm kapağı)
 * veya şarkı geçişi olaylarına göre 5 noktalı arkaplan gradyanı ve görselleştirici
 * ana/ikincil renklerini hesaplar.
 *
 * Hem tarayıcı/renderer (yönetici paneli) hem Node.js (birim testleri) ortamında çalışır.
 */
(function () {

  // --- Renk Dönüşümleri ---
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [Math.round(h * 360), clamp(s, 0, 1), clamp(l, 0, 1)];
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return [0, 0, 0];
    let c = hex.trim().replace(/^#/, '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const num = parseInt(c, 16);
    if (isNaN(num)) return [0, 0, 0];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function colorDistance(rgb1, rgb2) {
    const dr = rgb1[0] - rgb2[0];
    const dg = rgb1[1] - rgb2[1];
    const db = rgb1[2] - rgb2[2];
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < (s || '').length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // --- 1. Piksel Verisinden Albüm Kapağı Renk Ayıklama ---
  // rgbaData: Uint8ClampedArray veya Buffer ([r, g, b, a, r, g, b, a, ...])
  function extractPaletteFromPixels(rgbaData, width, height, options) {
    const opts = options || {};
    const count = opts.count || 5;
    if (!rgbaData || rgbaData.length < 4) {
      return fallbackPalette();
    }

    const totalPixels = Math.floor(rgbaData.length / 4);
    // Performans için örnekleme adımı (maks ~1200 piksel incelenir)
    const step = Math.max(1, Math.floor(totalPixels / 1200));

    // 16 Hue kovası (22.5° aralıklı) + 3 nötr kova (koyu, orta, açık)
    const BUCKET_COUNT = 16;
    const buckets = [];
    for (let i = 0; i < BUCKET_COUNT + 3; i++) {
      buckets.push({ r: 0, g: 0, b: 0, count: 0, weight: 0, maxSat: 0 });
    }

    let dominantR = 0, dominantG = 0, dominantB = 0;
    let sampledCount = 0;

    for (let i = 0; i < rgbaData.length; i += 4 * step) {
      const a = rgbaData[i + 3];
      if (a < 128) continue; // şeffaf pikselleri atla

      const r = rgbaData[i];
      const g = rgbaData[i + 1];
      const b = rgbaData[i + 2];

      dominantR += r;
      dominantG += g;
      dominantB += b;
      sampledCount++;

      const [h, s, l] = rgbToHsl(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      let bucketIndex;
      // Nötr pikseller (düşük doygunluk veya aşırı uç aydınlık)
      if (s < 0.14 || lum < 15 || lum > 242) {
        if (lum < 60) bucketIndex = BUCKET_COUNT;     // Koyu nötr
        else if (lum > 195) bucketIndex = BUCKET_COUNT + 2; // Açık nötr
        else bucketIndex = BUCKET_COUNT + 1;         // Orta nötr
      } else {
        bucketIndex = Math.floor(((h + 11.25) % 360) / 22.5);
      }

      // Canlı ve belirgin renklere daha yüksek ağırlık verilir
      const w = 1.0 + s * 2.2 + (l > 0.15 && l < 0.85 ? 0.8 : 0);
      const bkt = buckets[bucketIndex];
      bkt.r += r * w;
      bkt.g += g * w;
      bkt.b += b * w;
      bkt.weight += w;
      bkt.count++;
      if (s > bkt.maxSat) bkt.maxSat = s;
    }

    if (sampledCount === 0) {
      return fallbackPalette();
    }

    // Aday renkleri hesapla
    const candidates = [];
    for (let i = 0; i < buckets.length; i++) {
      const bkt = buckets[i];
      if (bkt.count < 3 || bkt.weight <= 0) continue;
      const avgR = Math.round(bkt.r / bkt.weight);
      const avgG = Math.round(bkt.g / bkt.weight);
      const avgB = Math.round(bkt.b / bkt.weight);
      const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
      candidates.push({
        rgb: [avgR, avgG, avgB],
        hex: hslToHex(h, s, l),
        h, s, l,
        weight: bkt.weight,
        isNeutral: i >= BUCKET_COUNT,
        // Kapaktan GERÇEKTEN ölçülen renk; aşağıdaki dolgulardan ayırt edilmeli
        derived: false,
      });
    }

    // Ağırlığa göre sırala
    candidates.sort((a, b) => b.weight - a.weight);

    // Birbirinden farklı (maksimum renk mesafeli) renkleri seç
    const selected = [];
    for (const cand of candidates) {
      if (selected.length >= count) break;
      const isTooClose = selected.some((s) => colorDistance(cand.rgb, s.rgb) < 36);
      if (!isTooClose) {
        selected.push(cand);
      }
    }

    /* Hiçbir kova üç piksele ulaşamadıysa (çok küçük ya da çok dağınık bir
       görsel) elimizdeki tek bilgi piksel ortalaması. Tonu ORTALAMADAN
       okunmalı: sabit bir ton yazılırsa aşağıdaki dolgular o sabit tondan
       türeyip kapakla ilgisi olmayan bir palet üretir — kırmızı bir kapak
       mor bir tema verirdi. */
    if (selected.length === 0) {
      const avgR = Math.round(dominantR / sampledCount);
      const avgG = Math.round(dominantG / sampledCount);
      const avgB = Math.round(dominantB / sampledCount);
      const [avgH, avgS, avgL] = rgbToHsl(avgR, avgG, avgB);
      selected.push({
        rgb: [avgR, avgG, avgB],
        hex: hslToHex(avgH, avgS, avgL),
        h: avgH, s: avgS, l: avgL,
        weight: 1,
        derived: false,
      });
    }

    /* Beşe tamamlarken ölçülen renkler SIRAYLA taban alınır. Hepsini ilk
       renkten türetmek paleti tek bir tona bağlardı. */
    const measured = selected.length;
    while (selected.length < count) {
      const base = selected[(selected.length - measured) % measured];
      const offset = (selected.length * 35) % 360;
      const newH = (base.h + offset) % 360;
      const newL = clamp(base.l + (selected.length % 2 === 0 ? 0.18 : -0.18), 0.15, 0.85);
      const newS = clamp(base.s + 0.1, 0.35, 0.95);
      const hex = hslToHex(newH, newS, newL);
      selected.push({
        rgb: hexToRgb(hex),
        hex,
        h: newH, s: newS, l: newL,
        weight: base.weight * 0.5,
        derived: true,
      });
    }

    // Renkleri aydınlık ve tona göre sıralayarak dengeli bir gradyan dizisi kur
    selected.sort((a, b) => a.l - b.l);

    const colors = selected.slice(0, count).map((s) => s.hex);

    /* Görselleştirici ana rengi: en canlı olan.

       Ama önce KAPAKTA GERÇEKTEN OLAN renkler geliyor. Dolgu renkleri
       doygunluğu 0.95'e kıstırılıp aydınlığı 0.68'e itilerek üretiliyor;
       canlılık puanı (s*1.5 + l) bir dolguya 2.105, saf kırmızıya 2.0
       veriyordu. Yani tek renkli bir kapakta ana renk, kapakta HİÇ
       BULUNMAYAN bir renk oluyordu — düz kırmızı bir görselden sarı-yeşil.
       Oysa özelliğin tamamı "rengi kapaktan al" demek.

       Kullanılabilirlik önce bakılıyor: siyaha yakın bir kapağın kendi
       renkleri sadık ama görselleştiricide görünmez olurdu, orada dolguya
       düşmek doğru. */
    const usable = (c) => c.l >= 0.2 && c.l <= 0.9;
    const rank = (c) => (usable(c) ? 0 : 2) + (c.derived ? 1 : 0);
    const vibrancy = (c) => c.s * 1.5 + c.l;
    const vibrant = selected.slice().sort((a, b) => rank(a) - rank(b) || vibrancy(b) - vibrancy(a));
    const primaryColor = vibrant[0] ? vibrant[0].hex : colors[2] || '#3aa6ff';
    const secondaryColor = vibrant[1] ? vibrant[1].hex : colors[4] || '#d24bff';

    return {
      colors,
      color: primaryColor,
      color2: secondaryColor,
    };
  }

  function fallbackPalette() {
    return {
      colors: ['#1a103c', '#2c3e50', '#3498db', '#e74c3c', '#f1c40f'],
      color: '#3498db',
      color2: '#e74c3c',
    };
  }

  // --- 2. Tarayıcıda Data URL'den Çıkarma ---
  function extractPaletteFromDataUrl(dataUrl, callback) {
    if (typeof document === 'undefined' || !dataUrl) {
      callback(fallbackPalette());
      return;
    }
    try {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = function () {
        try {
          const canvas = document.createElement('canvas');
          const size = 48; // Hızlı işleme için 48x48
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            callback(fallbackPalette());
            return;
          }
          ctx.drawImage(img, 0, 0, size, size);
          const imgData = ctx.getImageData(0, 0, size, size);
          const res = extractPaletteFromPixels(imgData.data, size, size);
          callback(res);
        } catch (_) {
          callback(fallbackPalette());
        }
      };
      img.onerror = function () {
        callback(fallbackPalette());
      };
      img.src = dataUrl;
    } catch (_) {
      callback(fallbackPalette());
    }
  }

  // --- 3. Stüdyo Mantığında Rastgele Armonik Renk Teması Üretimi ---
  const HARMONY_STYLES = [
    'analogous',       // Bitişik tonlar (akıcı, yumuşak)
    'complementary',   // Zıt tamamlayıcı (yüksek enerji)
    'triadic',         // Üçgen armoni (canlı, festival)
    'cyberpunk',       // Neon camgöbeği, mor, eflatun, sarı
    'warmSunset',      // Günbatımı / ateş
    'deepOcean',       // Derin okyanus / biyolüminesans
    'synthwave',       // 80'ler retro neon
    'aurora',          // Kutup ışıkları zümrüt ve eflatun
  ];

  function generateHarmonicPalette(randFunc) {
    const rand = typeof randFunc === 'function' ? randFunc : Math.random;
    const style = HARMONY_STYLES[Math.floor(rand() * HARMONY_STYLES.length)];
    const baseHue = Math.floor(rand() * 360);
    const colors = [];

    let c1, c2;

    switch (style) {
      case 'analogous': {
        const spread = 20 + rand() * 35;
        const sat = 0.55 + rand() * 0.35;
        for (let i = 0; i < 5; i++) {
          const h = (baseHue + (i - 2) * spread) % 360;
          const l = 0.18 + i * 0.14 + (rand() - 0.5) * 0.06;
          colors.push(hslToHex(h, sat, clamp(l, 0.12, 0.85)));
        }
        c1 = colors[2];
        c2 = colors[4];
        break;
      }
      case 'complementary': {
        const compHue = (baseHue + 180) % 360;
        const sat = 0.65 + rand() * 0.3;
        colors.push(hslToHex(baseHue, sat * 0.8, 0.15));
        colors.push(hslToHex(baseHue, sat, 0.38));
        colors.push(hslToHex((baseHue + 30) % 360, sat * 0.9, 0.56));
        colors.push(hslToHex(compHue, sat, 0.52));
        colors.push(hslToHex((compHue + 30) % 360, sat * 1.1, 0.72));
        c1 = colors[3];
        c2 = colors[1];
        break;
      }
      case 'triadic': {
        const h2 = (baseHue + 120) % 360;
        const h3 = (baseHue + 240) % 360;
        const sat = 0.65 + rand() * 0.25;
        colors.push(hslToHex(baseHue, sat, 0.18));
        colors.push(hslToHex(baseHue, sat, 0.45));
        colors.push(hslToHex(h2, sat, 0.55));
        colors.push(hslToHex(h3, sat, 0.52));
        colors.push(hslToHex(h2, sat, 0.76));
        c1 = colors[2];
        c2 = colors[3];
        break;
      }
      case 'cyberpunk': {
        colors.push('#0d0826');
        colors.push('#3f1d8c');
        colors.push('#00f0ff');
        colors.push('#ff007f');
        colors.push('#ffe600');
        c1 = '#00f0ff';
        c2 = '#ff007f';
        break;
      }
      case 'warmSunset': {
        colors.push('#24001a');
        colors.push('#7a003c');
        colors.push('#df2c14');
        colors.push('#f7821b');
        colors.push('#ffcd3c');
        c1 = '#f7821b';
        c2 = '#df2c14';
        break;
      }
      case 'deepOcean': {
        colors.push('#020f1f');
        colors.push('#053354');
        colors.push('#0b7285');
        colors.push('#20c997');
        colors.push('#63e6be');
        c1 = '#20c997';
        c2 = '#0b7285';
        break;
      }
      case 'synthwave': {
        colors.push('#1a0826');
        colors.push('#4b1369');
        colors.push('#9b27b0');
        colors.push('#e91e63');
        colors.push('#00e5ff');
        c1 = '#e91e63';
        c2 = '#00e5ff';
        break;
      }
      case 'aurora':
      default: {
        colors.push('#06141a');
        colors.push('#0d4239');
        colors.push('#109868');
        colors.push('#4bf3a3');
        colors.push('#a066ff');
        c1 = '#4bf3a3';
        c2 = '#a066ff';
        break;
      }
    }

    return {
      colors,
      color: c1 || colors[2],
      color2: c2 || colors[4],
      style,
    };
  }

  // --- 4. Şarkı Adı ve Ruh Hali Analizi (energyMood) ---
  const MOOD_LEXICON = [
    [['enerjik', 'hızlı', 'sert', 'techno', 'bass', 'metal', 'rock', 'dance', 'intense', 'fire', 'punch', 'wild'], 25, 0.85, 0.5],
    [['chill', 'ambient', 'lofi', 'sakin', 'slow', 'dream', 'peace', 'night', 'sleep', 'relax', 'deep'], 220, 0.55, 0.42],
    [['warm', 'sunset', 'ateş', 'gold', 'summer', 'sun', 'amber', 'love', 'red'], 15, 0.88, 0.54],
    [['cold', 'ice', 'winter', 'blue', 'rain', 'snow', 'ocean', 'frost', 'water'], 205, 0.75, 0.48],
    [['dark', 'shadow', 'black', 'goth', 'space', 'noir', 'evil', 'grave', 'demon'], 275, 0.65, 0.32],
    [['neon', 'light', 'bright', 'cyber', 'future', 'electric', 'star', 'glow'], 175, 0.95, 0.58],
  ];

  /* Palet parçadan DETERMİNİSTİK olarak türetilir: aynı şarkı her çalışında
     aynı rengi alsın diye. Burada rastgelelik yok — daha önce imzada bir
     `randFunc` parametresi vardı ama gövde onu hiç çağırmıyordu, yani
     verilen fonksiyon sessizce yok sayılıyordu. Kaldırıldı. */
  function generateMoodPalette(title, artist) {
    const text = ((title || '') + ' ' + (artist || '')).toLowerCase();
    const seed = hashString(text);

    let targetHue = -1;
    let targetSat = 0.7;
    let targetLum = 0.5;

    for (const [words, h, s, l] of MOOD_LEXICON) {
      if (words.some((w) => text.includes(w))) {
        targetHue = h;
        targetSat = s;
        targetLum = l;
        break;
      }
    }

    // Kelime eşleşmezse başlıktan deterministik renk çıkar
    if (targetHue === -1) {
      targetHue = seed % 360;
      targetSat = 0.55 + (seed % 35) / 100;
      targetLum = 0.4 + (seed % 25) / 100;
    }

    const colors = [];
    for (let i = 0; i < 5; i++) {
      const h = (targetHue + (i - 2) * 28 + 360) % 360;
      const l = clamp(targetLum + (i - 2) * 0.14, 0.12, 0.86);
      colors.push(hslToHex(h, targetSat, l));
    }

    return {
      colors,
      color: colors[2],
      color2: colors[4],
      style: 'mood',
    };
  }

  // --- 5. Ana Karar Fonksiyonu (resolveDynamicTheme) ---
  function resolveDynamicTheme(st, dynamicCfg, presets, callback) {
    const cfg = dynamicCfg || {};
    const mode = cfg.mode || 'artworkOrRandom';
    const hasArtwork = !!(st && st.artwork && typeof st.artwork === 'string' && st.artwork.length > 20);

    // 1. Albüm Kapağı Modları
    if ((mode === 'artwork' || mode === 'artworkOrRandom') && hasArtwork) {
      extractPaletteFromDataUrl(st.artwork, function (res) {
        callback({
          colors: res.colors,
          color: res.color,
          color2: res.color2,
          modeUsed: 'artwork',
          track: st.title ? `${st.title} — ${st.artist || ''}` : 'Kapak Görseli',
        });
      });
      return;
    }

    // 2. Kapak yoksa ve Yalnızca Albüm Kapağı seçiliyse değiştirme yapma
    if (mode === 'artwork' && !hasArtwork) {
      callback(null);
      return;
    }

    // 3. Rastgele Renk Teması Modu (Stüdyo armoni mantığı) veya Kapak Yoksa Rastgele Fallback'i
    if (mode === 'random' || (mode === 'artworkOrRandom' && !hasArtwork)) {
      const res = generateHarmonicPalette();
      callback({
        colors: res.colors,
        color: res.color,
        color2: res.color2,
        modeUsed: 'random',
        style: res.style,
        track: st && st.title ? `${st.title} — ${st.artist || ''}` : 'Rastgele Armoni',
      });
      return;
    }

    // 4. Parça Adı & Ruh Hali
    if (mode === 'energyMood') {
      const res = generateMoodPalette(st && st.title, st && st.artist);
      callback({
        colors: res.colors,
        color: res.color,
        color2: res.color2,
        modeUsed: 'energyMood',
        track: st && st.title ? `${st.title} — ${st.artist || ''}` : 'Ruh Hali',
      });
      return;
    }

    // 5. Hazır Şablon Rastgele veya Döngüsü
    if (mode === 'presetRandom' || mode === 'presetCycle') {
      const list = Array.isArray(presets) && presets.length ? presets : [fallbackPalette()];
      const idx = mode === 'presetRandom'
        ? Math.floor(Math.random() * list.length)
        : ((cfg._cycleIdx || 0) % list.length);
      const chosen = list[idx] || list[0];
      const colors = (chosen.colors || chosen).slice(0, 5);
      callback({
        colors,
        color: colors[2] || '#3aa6ff',
        color2: colors[4] || '#d24bff',
        modeUsed: mode,
        presetName: chosen.name || 'Şablon ' + (idx + 1),
        nextCycleIdx: (idx + 1) % list.length,
      });
      return;
    }

    callback(null);
  }

  const api = {
    rgbToHsl,
    hslToHex,
    hexToRgb,
    colorDistance,
    extractPaletteFromPixels,
    extractPaletteFromDataUrl,
    generateHarmonicPalette,
    generateMoodPalette,
    resolveDynamicTheme,
    fallbackPalette,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SV = window.SV || {};
    window.SV.AdaptiveTheme = api;
  }
})();
