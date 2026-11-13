/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Modülasyon matrisi paneli.

   Üç bölüm:
     Makrolar      — sekiz adlandırılabilir düğme; her biri birden çok
                     yönlendirmeyi aynı anda sürebilir
     Üreteçler     — LFO'lar, zarf takipçileri, rastgele üreteç
     Yönlendirmeler— kaynak → hedef bağlantıları, canlı değer göstergesiyle

   Hedef listesi yapılandırmadan CANLI üretilir: efekt zincirine bir efekt
   eklendiğinde onun parametreleri, 3B geometride formül değiştiğinde o
   formülün kendi parametreleri hedef olarak anında görünür. Sabit bir liste
   tutmak, motor büyüdükçe kaçınılmaz olarak eskirdi. */
(function () {
  const P = () => window.SVPanel;
  const SP = () => window.SVScenePanels;

  // ==========================================================================
  // Hedef kataloğu — yapılandırmadaki sayısal yaprakları toplar
  // ==========================================================================

  /* Bu köklerin altındaki sayısal alanlar hedef olabilir. Yapılandırmanın
     tamamını taramak yerine seçici davranıyoruz: "ekran kimliği" ya da "port
     numarası" gibi sayısal ama modüle edilmesi anlamsız alanlar listeyi
     kirletirdi. */
  const ROOTS = [
    { path: 'visualizer', label: 'Görselleştirici', skip: ['barCount', 'minFreq', 'maxFreq'] },
    // Saydamlık anahtarı bir renk eşiği, sürülecek bir ayar değil
    { path: 'background', label: 'Arkaplan', skip: ['transparentKey'] },
    { path: 'geometry', label: '3B Geometri', skip: ['attractorPoints'] },
    { path: 'logo', label: 'Logo', skip: [] },
    { path: 'images', label: 'Görsel Nesneler', skip: ['count'] },
    { path: 'audio', label: 'Ses', skip: [] },
    { path: 'lighting', label: 'Aydınlatma', skip: [] },
    /* Otomasyon hedefleri eksikti: bu ayarların kartı var, katmanlar da
       taşıyor, ama listede yoktular. Ağ sıklığı ve iç çözünürlük her ara
       değerde motoru yeniden kurar; onlar şemada kovalı kaydırıcı. */
    { path: 'milkdrop', label: 'MilkDrop', skip: ['mesh', 'renderScale', 'hardCutHalfLife'] },
    // echo: motorda var, panelde kaydırıcısı yok
    { path: 'feedback', label: 'Geri Besleme', skip: ['echo'] },
    // Giriş/çıkış noktası sarar; döngü vuruşu bir seçim
    { path: 'media', label: 'Medya', skip: ['inPoint', 'outPoint', 'loopBeats'] },
    { path: 'text', label: 'Yazı', skip: [] },
    { path: 'nowplaying', label: 'Çalan Parça', skip: ['holdSeconds', 'manual'] },
  ];

  /* İç içe bölümlerin kendi grubu. MilkDrop'un ses girişi genel "Ses"
     grubunda "Kazanç" ve "Yumuşatma" diye duruyordu; genel ses ayarlarından
     ayırt edilemiyordu. Ad, Ayarlar'daki kartın adı. */
  const NESTED_GROUPS = {
    'audio.milkdrop': { label: 'MilkDrop Ses Girişi', own: true },
    'visualizer.spectrum': { label: 'Tayf Ölçümü' },
  };
  /* Aramada ek sözcükler: MilkDrop'un kazancı onun duyarlılığı. */
  const SEARCH_KEYS = {
    'audio.milkdrop.gain': 'milkdrop duyarlılık hassasiyet sensitivity',
    'audio.sensitivity': 'sensitivity',
    'visualizer.sensitivity': 'sensitivity duyarlılık',
  };

  /* Panelin kendi kaydırıcılarındaki ad ve aralık (yol → [ad, en az, en çok]).
     Kaynak: lighting-general.js rangeRow, scene-panels.js miniSlider ve
     gradyan satırları, admin.js Ayarlar kartları. Ad yoksa alan ham
     anahtarından ("Gate Threshold") üretiliyordu, aralık yoksa hedef 0–1
     sanılıyordu ve otomasyon Hassasiyet'i 1'in üstüne çıkaramıyordu.
     tests/automation-targets.test.js her satırı kaynağıyla karşılaştırıyor. */
  const PANEL_SLIDERS = {
    'audio.bassBoost': ['Bas Vurgusu'],
    'audio.milkdrop.gain': ['Kazanç', 0, 4],
    'audio.milkdrop.gateHold': ['Bekleme', 0, 3],
    'audio.milkdrop.gateThreshold': ['Filtre Eşiği', 0, 0.2],
    'audio.milkdrop.smoothing': ['Yumuşatma', 0, 0.95],
    'audio.sensitivity': ['Hassasiyet'],
    'audio.smoothing': ['Yumuşatma'],
    'background.gradient.audioBrightness': ['Ses Patlaması (Parlaklık)', 0, 2],
    'background.gradient.audioHue': ['Ses ile Renk Kayması', 0, 1],
    'background.gradient.audioReactivity': ['Ses Tepkisi', 0, 2],
    'background.gradient.brightness': ['Parlaklık (Temel)', 0.4, 1.6],
    'background.gradient.drift': ['Tek Yönlü Kayma', 0, 1],
    'background.gradient.grain': ['Gren', 0, 0.2],
    'background.gradient.orbit': ['Dolanma Miktarı', 0, 2],
    'background.gradient.scale': ['Ölçek (Yoğunluk)', 0.4, 3],
    'background.gradient.speed': ['Akış Hızı', 0, 2],
    'background.gradient.swirl': ['İç Dönüş (Swirl)', 0, 2],
    'background.gradient.vignette': ['Vinyet', 0, 1],
    'background.gradient.wander': ['Gezinme Alanı', 0, 2],
    'background.gradient.warp': ['Bozulma (Akışkanlık)', 0, 2],
    'feedback.bassRotate': ['Bas → Dönüş'],
    'feedback.bassZoom': ['Bas → Yakınlaşma'],
    'feedback.decay': ['Sönme'],
    'feedback.dx': ['Yatay Kayma'],
    'feedback.dy': ['Dikey Kayma'],
    'feedback.rotate': ['Dönüş'],
    'feedback.sharpen': ['Keskinlik'],
    'feedback.swirl': ['İç Dönüş'],
    'feedback.warp': ['Bükülme'],
    'feedback.waveAmp': ['Dalga Genliği'],
    'feedback.waveThickness': ['Dalga Kalınlığı'],
    'feedback.zoom': ['Yakınlaşma'],
    'lighting.audioAcceleration': ['Sesle Hızlanma', 0, 3],
    'lighting.bandAttack': ['Bant Saldırı Hızı', 0.15, 1],
    'lighting.bandHardness': ['Bant Sertliği', 0, 1],
    'lighting.bandRelease': ['Bant Bırakma Hızı', 0.03, 0.65],
    'lighting.bandSeparation': ['Bant Ayrıştırma', 0, 1],
    'lighting.bandThreshold': ['Bant Gürültü Eşiği', 0, 0.8],
    'lighting.baseLevel': ['Sessizlikte Işık', 0.02, 0.6],
    'lighting.bassGain': ['Bas Hassasiyeti', 0, 3],
    'lighting.brightness': ['Genel Parlaklık', 0, 1],
    'lighting.colorSpeed': ['Renk Akış Hızı', 0, 3],
    'lighting.flashDecay': ['Patlama Sönümleme', 0.45, 0.995],
    'lighting.flashStrength': ['Patlama Gücü', 0, 1.5],
    'lighting.flashThreshold': ['Patlama Eşiği', 0.02, 0.98],
    'lighting.flowSpeed': ['Aygıtlar Arası Akış Hızı', 0, 3],
    'lighting.fusionMix': ['Arka Plan Karışım Oranı', 0, 1],
    'lighting.intensity': ['Ses Tepkisi', 0, 1],
    'lighting.midGain': ['Orta Frekans Hassasiyeti', 0, 3],
    'lighting.rainbowAudioBrightness': ['Sese Göre Parlaklık Gücü', 0, 1.5],
    'lighting.rainbowBaseBrightness': ['Rainbow Taban Parlaklığı', 0.02, 1],
    'lighting.rainbowSpeed': ['Rainbow Akış Hızı', 0.05, 3],
    'lighting.rainbowSpread': ['Rainbow Renk Yayılımı', 0.1, 4],
    'lighting.rippleSpeed': ['Dalga Hızı', 0.05, 3],
    'lighting.rippleWidth': ['Dalga Genişliği', 0.03, 0.6],
    'lighting.saturation': ['Renk Doygunluğu', 0, 1.5],
    'lighting.smoothing': ['Yumuşatma', 0, 0.95],
    'lighting.spectrumContrast': ['Bar Kontrastı', 0, 1],
    'lighting.spread': ['Renk Yayılımı', 0.1, 4],
    'lighting.thresholdBurstBaseBrightness': ['Eşik Altı Taban Işığı', 0, 0.5],
    'lighting.thresholdBurstCooldown': ['Darbeler Arası Süre (ms)', 0, 1000],
    'lighting.thresholdBurstDecay': ['Patlama Sönümleme', 0.45, 0.995],
    'lighting.thresholdBurstStrength': ['Eşik Üstü Patlama Gücü', 0, 2],
    'lighting.thresholdBurstThreshold': ['Tetikleme Eşiği', 0.01, 0.99],
    'lighting.trebleGain': ['Tiz Hassasiyeti', 0, 3],
    'lighting.updateRate': ['Güncelleme Hızı', 5, 60],
    'lighting.zoneBlend': ['Bölge Geçiş Yumuşaklığı', 0, 1],
    'logo.audioBrightness': ['Ses → Parlaklık', 0, 1],
    'logo.audioHue': ['Ses → Renk', 0, 1],
    'logo.audioOpacity': ['Ses → Saydamlık', 0, 1],
    'logo.audioSpeed': ['Ses → Hız', 0, 1],
    'logo.beatFlash': ['Ritim Parlaması', 0, 1],
    'logo.brightness': ['Parlaklık', 0.2, 2],
    'logo.cornerRadius': ['Köşe / Oval', 0, 0.5],
    'logo.glow': ['Parlama (Glow)', 0, 1],
    'logo.hue': ['Renk Kayması', 0, 1],
    'logo.opacity': ['Saydamlık', 0, 1],
    'logo.pulse': ['Nabız', 0, 1],
    'logo.saturate': ['Doygunluk', 0, 2],
    'logo.scale': ['Boyut', 0.05, 0.9],
    'logo.speed': ['Oynatma Hızı', 0.1, 3],
    'logo.x': ['Yatay Konum (X)', 0, 1],
    'logo.y': ['Dikey Konum (Y)', 0, 1],
    'visualizer.barCenterX': ['Yatay Konum', 0, 1],
    'visualizer.barCount': ['Bar Sayısı', 16, 160],
    'visualizer.barHeight': ['Bar Yüksekliği', 0.05, 1],
    'visualizer.barRadius': ['Köşe Yuvarlaklığı', 0, 0.5],
    'visualizer.barSpan': ['Bar Genişliği', 0.1, 1],
    'visualizer.baseline': ['Taban Çizgisi', 0, 1],
    'visualizer.capFall': ['Tepe Düşüş Hızı', 0.25, 4],
    'visualizer.capHold': ['Tepe Bekleme (sn)', 0, 2],
    'visualizer.gap': ['Bar Boşluğu', 0, 0.8],
    'visualizer.glow': ['Parlama (Glow)', 0, 1],
    'visualizer.lineWidth': ['Çizgi Kalınlığı', 1, 12],
    'visualizer.reflection': ['Zemin Yansıması', 0, 1],
    'visualizer.reflectionLength': ['Yansıma Boyu', 0.05, 1],
    'visualizer.segmentGap': ['Segment Aralığı', 0, 0.8],
    'visualizer.segmentSize': ['Segment Boyu', 0.01, 0.2],
    'visualizer.sensitivity': ['Hassasiyet', 0.2, 3],
    'visualizer.spectrum.attack': ['Atak (sn)', 0, 0.2],
    'visualizer.spectrum.floorDb': ['dB Tabanı', -96, -24],
    'visualizer.spectrum.release': ['Bırakma (sn)', 0.01, 1.2],
    'visualizer.spectrum.smooth': ['Profil Yumuşatma', 0, 1],
    'visualizer.spectrum.spread': ['Komşu Yayılımı', 0, 0.95],
    'visualizer.spectrum.tilt': ['Eğim (dB/oktav)', -6, 12],
    'visualizer.thickness': ['Genlik / Dolgu', 0.1, 1],
    'visualizer.trailHeight': ['Yükseklik', 0.4, 3],
    // Medya kartı (mediaSlider; aralık şemada)
    'media.audioOpacity': ['Bas → Saydamlık'],
    'media.audioZoom': ['Bas → Yakınlaşma'],
    'media.beatPulse': ['Vuruşta Nabız'],
    'media.hue': ['Renk Kayması'],
    'media.kaleido': ['Kaleydoskop Dilimi'],
    'media.kenBurns': ['Ken Burns (Yavaş Yakınlaşma ve Kayma)'],
    'media.kenBurnsPeriod': ['Ken Burns Döngüsü'],
    'media.saturate': ['Doygunluk'],
    // MilkDrop kartı: ölçüyle otomatik geçiş aralığı
    'milkdrop.autoNextBars': ['Aralık', 1, 64],
    // Yazı katmanı
    'text.animDuration': ['Giriş Süresi', 0.05, 2],
    'text.audioJitter': ['Titreşim', 0, 1],
    'text.audioLift': ['Harf Yükselmesi', 0, 1],
    'text.audioScale': ['Bas Nabzı', 0, 0.6],
    'text.karaokeHoldAmount': ['Esneme Miktarı', 0, 1],
    'text.karaokeHoldMin': ['Esneme Eşiği', 0.2, 3],
    'text.marqueeSpeed': ['Kayma Hızı', 0.02, 0.6],
    'text.maxWidth': ['En Fazla Genişlik', 0.2, 1],
    'text.offset': ['Senkron Kayması', -10, 10],
    'text.opacity': ['Yazı Saydamlığı', 0, 1],
    'text.outline': ['Kontur', 0, 1],
    'text.scrollSpeed': ['Kaydırma Hızı', 0.25, 4],
    'text.shadow': ['Gölge', 0, 1],
    'text.size': ['Yazı Boyutu', 0.01, 0.3],
    'text.weight': ['Kalınlık', 100, 900],
    'text.x': ['Yatay Konum', 0, 1],
    'text.y': ['Dikey Konum', 0, 1],
    // Şimdi Çalıyor katmanı
    'nowplaying.audioScale': ['Bas Nabzı', 0, 0.4],
    'nowplaying.barBackOpacity': ['Zemin Koyuluğu', 0, 1],
    'nowplaying.barGap': ['Yazıyla Arası', 0, 2],
    'nowplaying.barHeight': ['Çubuk Kalınlığı', 0.001, 0.04],
    'nowplaying.barWidth': ['Genişlik', 0.05, 1],
    'nowplaying.coverAudioScale': ['Kapak Bas Nabzı', 0, 0.4],
    'nowplaying.coverGap': ['Yazı Aralığı', 0, 1],
    'nowplaying.coverRadius': ['Köşe / Oval', 0, 0.5],
    'nowplaying.coverSize': ['Kapak Boyutu', 0.05, 0.5],
    'nowplaying.lineGap': ['Satır Aralığı', 0, 1.2],
    'nowplaying.maxWidth': ['En Fazla Genişlik', 0.2, 1],
    'nowplaying.opacity': ['Yazı Saydamlığı', 0, 1],
    'nowplaying.outline': ['Kontur', 0, 1],
    'nowplaying.scrollSpeed': ['Kaydırma Hızı', 0.25, 4],
    'nowplaying.shadow': ['Gölge', 0, 1],
    'nowplaying.size': ['Boyut', 0.015, 0.16],
    'nowplaying.weight': ['Kalınlık', 100, 900],
    'nowplaying.x': ['Yatay Konum', 0, 1],
    'nowplaying.y': ['Dikey Konum', 0, 1],
  };

  // Sık kullanılan alanların insan okuyabilir adları. Listede olmayan bir
  // alan ham anahtarıyla görünür — yeni alan eklendiğinde panel bozulmaz.
  const FIELD_LABELS = {
    glow: 'Parlama', opacity: 'Saydamlık', thickness: 'Kalınlık', gap: 'Boşluk',
    sensitivity: 'Duyarlılık', lineWidth: 'Çizgi Kalınlığı', trailHeight: 'Yükseklik', smoothing: 'Yumuşatma',
    speed: 'Hız', bright: 'Parlaklık', react: 'Tepki', scale: 'Ölçek', rotate: 'Dönüş',
    spin: 'Dönüş Hızı', tilt: 'Eğim', zoom: 'Yakınlaşma', deform: 'Bozulma',
    alpha: 'Saydamlık', pointSize: 'Nokta Boyutu', resolution: 'Çözünürlük',
    cameraAudio: 'Bas → Kamera', pulse: 'Nabız', x: 'Yatay', y: 'Dikey',
    bassBoost: 'Bas Vurgusu', strength: 'Şiddet', amount: 'Miktar', size: 'Boyut',
    attractorStep: 'İntegrasyon Adımı', hueShift: 'Renk Kayması', saturation: 'Doygunluk',
  };
  Object.assign(FIELD_LABELS, {
    reflection: 'Zemin Yansıması', reflectionLength: 'Yansıma Boyu', segmentSize: 'Segment Boyu', segmentGap: 'Segment Aralığı',
    barRadius: 'Köşe Yuvarlaklığı', capHold: 'Tepe Bekleme (sn)', capFall: 'Tepe Düşüş Hızı', tilt: 'Eğim',
    attack: 'Atak', release: 'Bırakma', drift: 'Sürüklenme', orbit: 'Yörünge', warp: 'Bükülme',
    audioReactivity: 'Ses Tepkisi', brightness: 'Parlaklık', audioBrightness: 'Ses → Parlaklık', grain: 'Gren',
    vignette: 'Vinyet', gain: 'Kazanç', depth: 'Derinlik', height: 'Yükseklik', density: 'Yoğunluk',
    softness: 'Yumuşaklık', amplitude: 'Genlik', contrast: 'Kontrast', angle: 'Açı', width: 'Genişlik',
    updateRate: 'Güncelleme Hızı', threshold: 'Eşik',
  });
  /* Listede olmayan alan ham anahtarıyla ("reflectionLength", "bassPush") görünüyordu. Artık
     sözcüklere ayrılıyor ("Reflection Length"): çevrilmemiş ama okunur. */
  function humanize(k) {
    const s = String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(k);
  }
  const fieldLabel = (k) => FIELD_LABELS[k] || humanize(k);

  /* Arkaplanın mod ayarları (background.starfield.count …) tek bir "Arkaplan" grubunda,
     hangi moda ait olduğu belli olmadan ve üç ayrı "count", altı ayrı "bassPush" olarak
     sıralanıyordu. Her mod kendi grubunda, adı ve ayar etiketleri mod kataloğundan
     (mode-catalog.js: gerçek etiket ve aralık) geliyor. */
  function modeGroup(base, key) {
    const MC = window.SVModeCatalog;
    // Katmanın kendi arkaplanı da: layers.<i>.settings.background
    if (!/(^|\.)background$/.test(base) || !MC || !MC.get) return null;
    const m = MC.get('background', key);
    return m ? { label: m.label, settings: m.settings || [] } : null;
  }

  // Bir nesnenin sayısal yapraklarını topla (en fazla iki düzey derin)
  function collect(obj, base, out, group, skip, depth, known) {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    for (const k of Object.keys(obj)) {
      if (skip && skip.indexOf(k) >= 0) continue;
      const v = obj[k];
      const path = base + '.' + k;
      if (typeof v === 'number' && isFinite(v)) {
        const def = known ? known.find((d) => d[0] === k) : null;
        if (def) out.push({ path, label: def[1], group, min: def[2], max: def[3] });
        else out.push({ path, label: fieldLabel(k), group });
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const mg = depth === 1 ? modeGroup(base, k) : null;
        const nested = NESTED_GROUPS[relPath(path)];
        // Kendi grubu olan bölüm (MilkDrop Ses Girişi) genel "Ses" altında değil
        const g = mg ? group + ' · ' + mg.label
          : nested ? (nested.own && relPath(path) === path ? nested.label : group + ' · ' + nested.label) : group;
        collect(v, path, out, g, skip, depth + 1, mg ? mg.settings : null);
      }
    }
  }

  // Katman yolunun genel karşılığı: layers.3.settings.visualizer.glow → visualizer.glow
  function relPath(path) { return String(path).replace(/^layers\.\d+\.settings\./, ''); }

  /* Ad, aralık ve arama sözcükleri: önce şema (panel kaydırıcısının sınırı,
     sliderCtrl ile aynı), sonra panel tablosu. Yol değişmiyor; kayıtlı
     şeritler aynı hedefe bağlı kalıyor. */
  function enrich(o) {
    const rel = relPath(o.path);
    const S = window.SVSchema;
    const known = S && S.rangeFor ? S.rangeFor(rel) : null;
    const ps = PANEL_SLIDERS[rel];
    if (ps && ps[0]) o.label = ps[0];
    else {
      // Şemadaki denetleyici kaydırıcısının adı ("MilkDrop · Geçiş Süresi" → "Geçiş Süresi")
      const sl = S && S.SLIDERS ? S.SLIDERS.find((x) => x.path === rel) : null;
      if (sl && sl.label) o.label = String(sl.label).split(' · ').pop();
    }
    if (known && known.min !== undefined && known.max !== undefined) { o.min = known.min; o.max = known.max; }
    else if (o.min == null && ps && ps.length === 3) { o.min = ps[1]; o.max = ps[2]; }
    if (SEARCH_KEYS[rel]) o.keys = (o.keys ? o.keys + ' ' : '') + SEARCH_KEYS[rel];
    return o;
  }

  /* Katmanın kendi ayarları. Katman bir değeri taşıyorsa genel yol o katmanı
     sürmüyor (layers.js layerConfig: katman ayarı genel ayarın üstüne
     biniyor; genel yol yalnız ilk canlı katmana yönleniyor). Gerçek bir
     sahnede 117 katmanın 23'ü kendi Hassasiyet değerini taşıyordu; ikinci
     görselleştirici katmanının duyarlılığı hiçbir hedefle sürülemiyordu.
     Yalnız katmanın taşıdığı yapraklar: olmayan yol otomasyonda "eksik" sayılır.
     Arkaplan katmanında yalnız kendi modu ve gradyan; öbür modların ayarları
     o katmanda çizilmiyor. */
  const SECTION_LABELS = {
    visualizer: 'Görselleştirici', background: 'Arkaplan', geometry: '3B Geometri', logo: 'Logo',
    images: 'Görsel Nesneler', milkdrop: 'MilkDrop', feedback: 'Geri Besleme', media: 'Medya',
    text: 'Yazı', nowplaying: 'Çalan Parça',
  };
  function layerSettings(l, i, g, out) {
    const st = l && l.settings;
    if (!st || typeof st !== 'object') return;
    for (const sec of Object.keys(st)) {
      const v = st[sec];
      if (!v || typeof v !== 'object' || Array.isArray(v) || !SECTION_LABELS[sec]) continue;
      let src = v;
      if (sec === 'background') {
        src = {};
        for (const k of Object.keys(v)) {
          if (typeof v[k] === 'number' || k === 'gradient' || k === l.type) src[k] = v[k];
        }
      }
      const root = ROOTS.find((r) => r.path === sec);
      // "Logo" adlı logo katmanında "Logo · Logo" yazmasın
      const sg = l.name === SECTION_LABELS[sec] ? g : g + ' · ' + SECTION_LABELS[sec];
      collect(src, 'layers.' + i + '.settings.' + sec, out, sg, root ? root.skip : [], 1);
    }
  }

  function targetCatalog(cfg) {
    const out = [];
    for (const r of ROOTS) {
      collect(cfg[r.path], r.path, out, r.label, r.skip, 1);
    }
    // Ana opaklık (Kontrol kartındaki ana fader)
    if (typeof cfg.master === 'number') out.push({ path: 'master', label: 'Ana Opaklık', group: 'Çıkış', min: 0, max: 1 });
    // Efekt zinciri: her efektin kendi parametreleri
    const fx = Array.isArray(cfg.postfx) ? cfg.postfx : [];
    const defs = (window.SVPostFX && window.SVPostFX.EFFECTS) || {};
    fx.forEach((f, i) => {
      const def = defs[f.type];
      if (!def) return;
      out.push({ path: 'postfx.' + i + '.opacity', label: 'Karışım', group: (i + 1) + '. ' + def.label, min: 0, max: 1 });
      for (const p of def.params || []) {
        out.push({
          path: 'postfx.' + i + '.params.' + p.name,
          label: p.label || p.name,
          group: (i + 1) + '. ' + def.label,
          min: p.min, max: p.max,
        });
      }
    });
    // Katmanlar: opaklık ve dönüşüm
    const layers = Array.isArray(cfg.layers) ? cfg.layers : [];
    layers.forEach((l, i) => {
      const g = 'Katman ' + (i + 1) + (l.name ? ' · ' + l.name : '');
      out.push({ path: 'layers.' + i + '.opacity', label: 'Saydamlık', group: g, min: 0, max: 1 });
      out.push({ path: 'layers.' + i + '.transform.scale', label: 'Ölçek', group: g, min: 0.2, max: 3 });
      out.push({ path: 'layers.' + i + '.transform.rotate', label: 'Dönüş', group: g, min: -180, max: 180 });
      out.push({ path: 'layers.' + i + '.transform.x', label: 'Yatay', group: g, min: -1, max: 1 });
      out.push({ path: 'layers.' + i + '.transform.y', label: 'Dikey', group: g, min: -1, max: 1 });
      layerSettings(l, i, g, out);
    });
    return out.map(enrich);
  }

  // Hedefin makul kaydırıcı aralığı: katalogda varsa oradan, yoksa mevcut
  // değerden türetilir
  function rangeFor(cat, path, current) {
    const hit = cat.find((c) => c.path === path);
    if (hit && hit.min != null && hit.max != null) return [hit.min, hit.max];
    const v = typeof current === 'number' ? current : 1;
    if (v >= 0 && v <= 1) return [0, 1];
    const span = Math.max(1, Math.abs(v) * 2);
    return [v - span, v + span];
  }

  // ==========================================================================
  // Panel
  // ==========================================================================
  const SHAPE_LABELS = [
    ['sine', 'Sinüs'], ['triangle', 'Üçgen'], ['sawUp', 'Testere ↑'], ['sawDown', 'Testere ↓'],
    ['square', 'Kare'], ['pulse', 'Darbe'], ['stepRandom', 'Rastgele (basamaklı)'],
    ['smoothRandom', 'Rastgele (yumuşak)'],
  ];
  const CURVE_LABELS = [
    ['linear', 'Doğrusal'], ['exp', 'Üstel'], ['exp3', 'Üstel (güçlü)'], ['log', 'Logaritmik'],
    ['scurve', 'S Eğrisi'], ['ease', 'Yumuşak'], ['abs', 'Mutlak'],
  ];
  const MODE_LABELS = [['set', 'Değeri Belirle'], ['add', 'Üstüne Ekle'], ['mul', 'Çarp']];
  const BAND_LABELS = [['bass', 'Bas'], ['mid', 'Orta'], ['treble', 'Tiz'], ['level', 'Genel']];

  let meterTimer = 0;
  const meters = []; // { el, source }

  function newRoute(cfg) {
    return {
      id: 'md_' + Math.random().toString(36).slice(2, 8),
      enabled: true,
      source: 'bass',
      target: '',
      min: 0, max: 1,
      mode: 'set',
      curve: 'linear',
      amount: 1,
      smooth: 0,
      steps: 0,
      invert: false,
    };
  }

  function panel() {
    const el = P().el;
    const cfg = P().cfg();
    const m = cfg.modulation || (cfg.modulation = window.SV.defaultConfig().modulation);
    const rerender = () => P().apply();
    const nodes = [];
    meters.length = 0;

    nodes.push(SP().miniToggle('Modülasyon Etkin', () => m.enabled !== false, (v) => { m.enabled = v; }));

    // ---------------------------------------------------------------- makro
    const macroBox = el('div', { class: 'mod-macros' });
    for (let i = 0; i < 8; i++) {
      const mc = m.macros[i] || (m.macros[i] = { name: '', value: 0 });
      const nameIn = el('input', {
        class: 'p-in tiny', type: 'text', value: mc.name || '',
        // Yer tutucu arayüz metni olduğu için çevrilir; ad ise kullanıcının
        // yazdığı veridir ve olduğu gibi kalır
        placeholder: 'Makro ' + (i + 1),
        oninput: (e) => { mc.name = e.target.value; P().push(false); },
      });
      const val = el('span', { class: 'val', text: Math.round((mc.value || 0) * 100) + '%' });
      const slider = el('input', {
        type: 'range', min: 0, max: 1, step: 0.01, value: mc.value || 0,
        oninput: (e) => {
          mc.value = parseFloat(e.target.value);
          val.textContent = Math.round(mc.value * 100) + '%';
          P().push(false);
        },
      });
      macroBox.appendChild(el('div', { class: 'mod-macro' }, [
        el('div', { class: 'row' }, [nameIn, val]), slider,
      ]));
    }
    nodes.push(el('div', { class: 'ctrl' }, [
      el('label', { class: 'lbl', text: 'Makrolar' }), macroBox,
      el('div', { class: 'studio-note dim-hint', text: 'Bir makroyu birden çok yönlendirmeye bağlayın: tek düğme sahnenin tamamını sürer.' }),
    ]));

    // ----------------------------------------------------------------- LFO
    nodes.push(SP().foldable('LFO (4)', () => {
      const kids = [];
      for (let i = 0; i < 4; i++) {
        const l = m.lfos[i] || (m.lfos[i] = {});
        kids.push(el('div', { class: 'mod-gen' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'LFO ' + (i + 1) })]),
          SP().miniSelect('Dalga', SHAPE_LABELS, () => l.shape || 'sine', (v) => { l.shape = v; }),
          SP().miniToggle('Tempoya Kilitle', () => !!l.sync, (v) => { l.sync = v; }, rerender),
          l.sync
            ? SP().miniSelect('Bölüm', window.SVModulation.DIVISIONS.map((d) => [d.id, d.id]), () => l.division || '1/1', (v) => { l.division = v; })
            : SP().miniSlider('Hız (Hz)', () => (l.rate == null ? 0.5 : l.rate), (v) => { l.rate = v; }, { min: 0.01, max: 8, step: 0.01, fmt: (v) => (+v).toFixed(2) + ' Hz' }),
          SP().miniSlider('Faz', () => l.phase || 0, (v) => { l.phase = v; }, { min: 0, max: 1, step: 0.01 }),
          l.shape === 'pulse'
            ? SP().miniSlider('Darbe Genişliği', () => (l.width == null ? 0.25 : l.width), (v) => { l.width = v; }, { min: 0.05, max: 0.95, step: 0.01, percent: true })
            : null,
          SP().miniToggle('Çift Kutuplu (-1..1)', () => !!l.bipolar, (v) => { l.bipolar = v; }),
        ].filter(Boolean)));
      }
      return kids;
    }));

    // --------------------------------------------------------------- zarf
    nodes.push(SP().foldable('Zarf Takipçileri (2)', () => {
      const kids = [];
      for (let i = 0; i < 2; i++) {
        const e = m.envelopes[i] || (m.envelopes[i] = {});
        kids.push(el('div', { class: 'mod-gen' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'Zarf ' + (i + 1) })]),
          SP().miniSelect('Kaynak Bant', BAND_LABELS, () => e.band || 'bass', (v) => { e.band = v; }),
          SP().miniSlider('Atak', () => (e.attack == null ? 0.02 : e.attack), (v) => { e.attack = v; }, { min: 0.001, max: 1, step: 0.001, fmt: (v) => Math.round(v * 1000) + ' ms' }),
          SP().miniSlider('Bırakma', () => (e.release == null ? 0.3 : e.release), (v) => { e.release = v; }, { min: 0.01, max: 3, step: 0.01, fmt: (v) => Math.round(v * 1000) + ' ms' }),
        ]));
      }
      const r = m.random || (m.random = {});
      kids.push(el('div', { class: 'mod-gen' }, [
        el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'Rastgele Üreteç' })]),
        SP().miniToggle('Tempoya Kilitle', () => !!r.sync, (v) => { r.sync = v; }, rerender),
        r.sync
          ? SP().miniSelect('Bölüm', window.SVModulation.DIVISIONS.map((d) => [d.id, d.id]), () => r.division || '1/1', (v) => { r.division = v; })
          : SP().miniSlider('Hız (Hz)', () => (r.rate == null ? 1 : r.rate), (v) => { r.rate = v; }, { min: 0.05, max: 12, step: 0.05, fmt: (v) => (+v).toFixed(2) + ' Hz' }),
      ]));
      return kids;
    }));

    // ------------------------------------------------------ serbest bantlar
    nodes.push(SP().foldable('Serbest Bantlar (4)', () => {
      const MOD = window.SVModulation;
      const fb = Array.isArray(m.freeBands) ? m.freeBands : (m.freeBands = []);
      // Hz kaydırıcısı logaritmik: 20 Hz–20 kHz konumda eşit oktav aralığı alır
      const lnLo = Math.log(MOD.FREE_HZ_MIN);
      const lnSpan = Math.log(MOD.FREE_HZ_MAX) - lnLo;
      const toPos = (hz) => (Math.log(hz) - lnLo) / lnSpan;
      const toHz = (p) => Math.round(Math.exp(lnLo + p * lnSpan));
      const fmtHz = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz' : hz + ' Hz');
      const fmtDb = (v) => Math.round(v) + ' dB';
      const kids = [el('div', { class: 'studio-note dim-hint', text: 'Bir frekans aralığı ve dB penceresi seçin: alt sınırda kaynak 0, üst sınırda 1 olur. Yönlendirmelerde "Serbest Bant" grubundan seçilir.' })];
      for (let i = 0; i < MOD.FREE_BANDS; i++) {
        const b = fb[i] || (fb[i] = Object.assign({}, MOD.FREE_BAND_DEFAULTS[i]));
        const eff = () => MOD.freeBand(m, i);
        const meter = el('span', { class: 'mod-meter' }, [el('i')]);
        meters.push({ el: meter.firstChild, source: 'fband' + (i + 1) });
        kids.push(el('div', { class: 'mod-gen' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: 'Serbest Bant ' + (i + 1) })]),
          P().row('Anlık', meter),
          /* Sınırlar yazılırken birbirini geçemez: motor ters sırayı düzeltse
             de saklanan değer ters kalırsa bir kaydırıcı ötekinin yerinde
             görünür ve sürüklenince öteki zıplar */
          SP().miniSlider('Alt Frekans', () => toPos(eff().lo), (p) => { b.lo = Math.min(toHz(p), eff().hi); }, { min: 0, max: 1, step: 0.001, fmt: (p) => fmtHz(Math.min(toHz(p), eff().hi)) }),
          SP().miniSlider('Üst Frekans', () => toPos(eff().hi), (p) => { b.hi = Math.max(toHz(p), eff().lo); }, { min: 0, max: 1, step: 0.001, fmt: (p) => fmtHz(Math.max(toHz(p), eff().lo)) }),
          SP().miniSlider('Taban (0)', () => eff().floor, (v) => { b.floor = Math.min(v, eff().ceil - 1); }, { min: MOD.FREE_DB_MIN, max: MOD.FREE_DB_MAX, step: 1, fmt: (v) => fmtDb(Math.min(v, eff().ceil - 1)) }),
          SP().miniSlider('Tavan (1)', () => eff().ceil, (v) => { b.ceil = Math.max(v, eff().floor + 1); }, { min: MOD.FREE_DB_MIN, max: MOD.FREE_DB_MAX, step: 1, fmt: (v) => fmtDb(Math.max(v, eff().floor + 1)) }),
          SP().miniSlider('Atak', () => eff().attack, (v) => { b.attack = v; }, { min: 0, max: 0.5, step: 0.001, fmt: (v) => Math.round(v * 1000) + ' ms' }),
          SP().miniSlider('Bırakma', () => eff().release, (v) => { b.release = v; }, { min: 0.01, max: 3, step: 0.01, fmt: (v) => Math.round(v * 1000) + ' ms' }),
        ]));
      }
      startMeters();
      return kids;
    }));

    // ------------------------------------------------- adım sıralayıcılar
    nodes.push(SP().foldable('Adım Sıralayıcı (2)', () => {
      const MOD = window.SVModulation;
      const seqs = Array.isArray(m.sequencers) ? m.sequencers : (m.sequencers = []);
      const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
      const kids = [el('div', { class: 'studio-note dim-hint', text: 'Tempoya kilitli adım dizisi. Her adımın yüksekliği o adımdaki değerdir (0..1). Yönlendirmelerde "Sıralayıcı" grubundan seçilir.' })];
      for (let i = 0; i < MOD.SEQUENCERS; i++) {
        const sq = seqs[i] || (seqs[i] = {});
        if (!Array.isArray(sq.values)) sq.values = [];
        const eff = MOD.sequencer(m, i);
        const meter = el('span', { class: 'mod-meter' }, [el('i')]);
        meters.push({ el: meter.firstChild, source: 'seq' + (i + 1) });
        // Adım kaydırıcıları: dikey, uzunluk kadar gösterilir
        const grid = el('div', { class: 'mod-steps', role: 'group', 'aria-label': tr('Adımlar') });
        for (let k = 0; k < eff.length; k++) {
          const inp = el('input', {
            type: 'range', min: 0, max: 1, step: 0.01, value: eff.values[k],
            'aria-label': tr('Adım') + ' ' + (k + 1),
            oninput: (e) => {
              for (let j = sq.values.length; j < MOD.SEQ_MAX_STEPS; j++) sq.values.push(0);
              sq.values[k] = parseFloat(e.target.value);
              P().push(false);
            },
          });
          grid.appendChild(inp);
        }
        kids.push(el('div', { class: 'mod-gen' }, [
          el('div', { class: 'item-head' }, [el('span', { class: 'item-title', text: tr('Sıralayıcı') + ' ' + (i + 1) })]),
          P().row('Anlık', meter),
          SP().miniSelect('Adım Sayısı', MOD.SEQ_LENGTHS.map((n) => [n, String(n)]), () => eff.length, (v) => { sq.length = parseInt(v, 10); }, rerender),
          SP().miniSelect('Bölüm', MOD.DIVISIONS.map((d) => [d.id, d.id]), () => eff.division, (v) => { sq.division = v; }),
          SP().miniSlider('Kayarak Geçiş', () => MOD.sequencer(m, i).glide, (v) => { sq.glide = v; }, { min: 0, max: 1, step: 0.01, percent: true }),
          grid,
          el('div', { class: 'row sv-btn-row' }, [
            el('button', {
              class: 'btn ghost small', type: 'button', text: 'Adımları Sıfırla',
              onclick: () => { sq.values = []; rerender(); },
            }),
          ]),
        ]));
      }
      startMeters();
      return kids;
    }));
    // -------------------------------------------------------- yönlendirmeler
    const routes = Array.isArray(m.routes) ? m.routes : (m.routes = []);
    const cat = targetCatalog(cfg);
    const sources = window.SVModulation.catalog(cfg);

    const list = el('div', { class: 'mod-routes' });
    routes.forEach((r, i) => {
      const enableBox = el('input', {
        type: 'checkbox',
        onchange: (e) => { r.enabled = e.target.checked; rerender(); },
      });
      enableBox.checked = r.enabled !== false;

      const meter = el('span', { class: 'mod-meter' }, [el('i')]);
      meters.push({ el: meter.firstChild, source: r.source });

      const srcOpts = [];
      let lastGroup = null;
      for (const s of sources) {
        if (s.group !== lastGroup) { srcOpts.push([null, s.group]); lastGroup = s.group; }
        srcOpts.push([s.id, s.label]);
      }

      const tgtSel = P().el('select', {
        class: 'p-in',
        onchange: (e) => {
          r.target = e.target.value;
          const cur = window.SVModulation.getIn(cfg, r.target);
          const [lo, hi] = rangeFor(cat, r.target, cur);
          r.min = lo; r.max = hi;
          rerender();
        },
      });
      const trTgt = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);
      tgtSel.setAttribute('aria-label', trTgt('Hedef'));
      tgtSel.appendChild(P().el('option', { value: '', text: '— hedef seçin —' }));
      let tGroup = null;
      let optGroup = null;
      for (const c of cat) {
        if (c.group !== tGroup) {
          tGroup = c.group;
          optGroup = P().el('optgroup');
          optGroup.label = String(c.group).split(' · ').map(trTgt).join(' · ');
          tgtSel.appendChild(optGroup);
        }
        const o = P().el('option', { value: c.path, text: trTgt(c.label) });
        if (c.path === r.target) o.selected = true;
        optGroup.appendChild(o);
      }

      const title = (sources.find((s) => s.id === r.source) || {}).label || r.source;
      const kids = [
        SP().itemHeader(routes, i, (i + 1) + '. ' + title, rerender,
          el('label', { class: 'switch small' }, [enableBox, el('span', { class: 'track' })])),
        P().row('Anlık', meter),
        (() => {
          const sel = P().el('select', {
            class: 'p-in',
            'aria-label': trTgt('Kaynak'),
            onchange: (e) => { r.source = e.target.value; rerender(); },
          });
          let g = null;
          let og = null;
          for (const [v, t] of srcOpts) {
            if (v === null) { og = P().el('optgroup'); og.label = trTgt(t); sel.appendChild(og); g = t; continue; }
            const o = P().el('option', { value: v, text: trTgt(t) });
            if (v === r.source) o.selected = true;
            (og || sel).appendChild(o);
          }
          return P().row('Kaynak', sel);
        })(),
        P().row('Hedef', tgtSel),
        SP().miniSelect('Kip', MODE_LABELS, () => r.mode || 'set', (v) => { r.mode = v; }),
        SP().miniSelect('Eğri', CURVE_LABELS, () => r.curve || 'linear', (v) => { r.curve = v; }),
        SP().miniSlider('Miktar', () => (r.amount == null ? 1 : r.amount), (v) => { r.amount = v; }, { min: 0, max: 1, step: 0.01, percent: true }),
        SP().miniSlider('Alt Sınır', () => (r.min == null ? 0 : r.min), (v) => { r.min = v; }, { min: -180, max: 180, step: 0.01, fmt: (v) => (+v).toFixed(2) }),
        SP().miniSlider('Üst Sınır', () => (r.max == null ? 1 : r.max), (v) => { r.max = v; }, { min: -180, max: 180, step: 0.01, fmt: (v) => (+v).toFixed(2) }),
        SP().miniSlider('Yumuşatma', () => r.smooth || 0, (v) => { r.smooth = v; }, { min: 0, max: 2, step: 0.01, fmt: (v) => (v > 0 ? Math.round(v * 1000) + ' ms' : 'yok') }),
        SP().miniSlider('Basamak', () => r.steps || 0, (v) => { r.steps = Math.round(v); }, { min: 0, max: 16, step: 1, fmt: (v) => (v > 1 ? Math.round(v) : 'sürekli') }),
        SP().miniToggle('Ters Çevir', () => !!r.invert, (v) => { r.invert = v; }),
      ];
      list.appendChild(el('div', { class: 'mod-route' }, kids));
    });

    if (!routes.length) {
      list.appendChild(el('div', { class: 'studio-note', text: 'Henüz yönlendirme yok. "Yönlendirme Ekle" ile bası bir efekt parametresine ya da bir LFO\'yu kameraya bağlayın.' }));
    }
    nodes.push(list);

    nodes.push(el('div', { class: 'row sv-btn-row' }, [
      el('button', {
        class: 'btn', type: 'button', text: '+ Yönlendirme Ekle',
        onclick: () => { routes.push(newRoute(cfg)); rerender(); },
      }),
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Hepsini Temizle',
        onclick: async () => {
          if (!routes.length) return;
          if (await P().confirm('Tüm yönlendirmeler silinsin mi?')) { routes.length = 0; rerender(); }
        },
      }),
    ]));

    startMeters();
    return el('div', { class: 'mod-panel' }, nodes);
  }

  /* Canlı değer göstergeleri. Panelin kendi modülatörü yok; önizlemedeki
     motorun değerlerini okur, böylece gösterge ile ekrandaki görüntü aynı
     sayıyı gösterir. */
  function startMeters() {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = setInterval(() => {
      const mod = window.SVPreview && window.SVPreview.modulator && window.SVPreview.modulator();
      if (!mod) return;
      let alive = false;
      for (const m of meters) {
        if (!m.el || !m.el.isConnected) continue;
        alive = true;
        const v = Math.max(0, Math.min(1, Math.abs(mod.value(m.source))));
        m.el.style.width = (v * 100).toFixed(1) + '%';
      }
      if (!alive) { clearInterval(meterTimer); meterTimer = 0; }
    }, 80);
  }

  window.SVModulationPanel = { panel, targetCatalog };
})();
