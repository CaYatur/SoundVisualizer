/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TEK ŞEMA (#905). Aynı bilgi birkaç yerde elle yazılıydı; panel ile katmanlar
   arasındaki tutarsızlığı üreten de bu kopyalardı. Burada bir kez yazılıyor,
   kullananlar buradan alıyor.

   SCENE_KEYS: sahneye ait alanlar. Panel, kontrol, ana süreç, MCP, yedeklilik ve
   şablonlar aynı listeyi kullanıyor.

   SLIDERS: denetleyicilerin sürdüğü kaydırıcılar. Kontrol hedefleri ve OSC ağacı
   buradan üretiliyor. Aralıklar panel kaydırıcılarıyla aynı tutuldu ki denetleyicinin
   tam açması, kaydırıcının sonuna gelmesiyle aynı şey olsun.

   RANGES ve rangeFor: panel ve MCP aynı sınırı buradan okuyor. */
(function () {
  const SCENE_KEYS = [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ];

  const SLIDERS = [
    { path: 'audio.sensitivity', label: 'Ses · Hassasiyet', min: 0.2, max: 4 },
    { path: 'audio.smoothing', label: 'Ses · Yumuşatma', min: 0, max: 0.95, noExtend: true },
    { path: 'audio.bassBoost', label: 'Ses · Bas Vurgusu', min: 1, max: 4 },
    { path: 'visualizer.sensitivity', label: 'Görselleştirici · Hassasiyet', min: 0.3, max: 3 },
    { path: 'visualizer.glow', label: 'Görselleştirici · Parlama', min: 0, max: 1 },
    { path: 'visualizer.barCount', label: 'Görselleştirici · Bar Sayısı', min: 16, max: 160, int: true },
    { path: 'visualizer.gap', label: 'Görselleştirici · Bar Boşluğu', min: 0, max: 0.8 },
    { path: 'visualizer.lineWidth', label: 'Görselleştirici · Çizgi Kalınlığı', min: 1, max: 12 },
    { path: 'visualizer.thickness', label: 'Görselleştirici · Genlik', min: 0.1, max: 1 },
    { path: 'visualizer.trailHeight', label: 'Görselleştirici · Yükseklik', min: 0.4, max: 3 },
    { path: 'background.gradient.speed', label: 'Arkaplan · Akış Hızı', min: 0, max: 2 },
    { path: 'background.gradient.audioReactivity', label: 'Arkaplan · Ses Tepkisi', min: 0, max: 2 },
    { path: 'background.gradient.brightness', label: 'Arkaplan · Parlaklık', min: 0.4, max: 1.6 },
    { path: 'background.gradient.audioHue', label: 'Arkaplan · Renk Kayması', min: 0, max: 1 },
    { path: 'background.gradient.vignette', label: 'Arkaplan · Vinyet', min: 0, max: 1 },
    { path: 'logo.opacity', label: 'Logo · Saydamlık', min: 0, max: 1 },
    { path: 'logo.scale', label: 'Logo · Boyut', min: 0.05, max: 0.6 },
    { path: 'feedback.zoom', label: 'Geri Besleme · Yakınlaşma', min: 0.94, max: 1.08, noExtend: true },
    { path: 'feedback.decay', label: 'Geri Besleme · Sönme', min: 0.7, max: 0.999, noExtend: true },
    { path: 'feedback.warp', label: 'Geri Besleme · Bükülme', min: 0, max: 2 },
    { path: 'feedback.rotate', label: 'Geri Besleme · Dönüş', min: -1, max: 1 },
    { path: 'media.opacity', label: 'Medya · Saydamlık', min: 0, max: 1, noExtend: true },
    { path: 'media.kaleido', label: 'Medya · Kaleydoskop', min: 0, max: 12, int: true },
    /* MILKDROP (#570). Aralıklar panelin kaydırıcılarıyla aynı. */
    { path: 'milkdrop.blendTime', label: 'MilkDrop · Geçiş Süresi', min: 0, max: 5 },
    { path: 'milkdrop.autoNext', label: 'MilkDrop · Otomatik Geçiş', min: 0, max: 120, int: true },
    { path: 'milkdrop.autoNextRand', label: 'MilkDrop · Rastgele Pay', min: 0, max: 30, int: true },
    { path: 'milkdrop.hardCutThreshold', label: 'MilkDrop · Sert Geçiş Eşiği', min: 1, max: 6 },
    /* Ağ sıklığı ve iç çözünürlük panelde de yalnız bu değerleri alıyor.
       Sürekli bir düğme her ara değerde ağı ya da çerçeve tamponlarını
       yeniden kurardı; denetleyicinin yolu kovalara bölünüyor. */
    { path: 'milkdrop.mesh', label: 'MilkDrop · Ağ Sıklığı', steps: [24, 32, 48, 64, 96, 128] },
    { path: 'milkdrop.renderScale', label: 'MilkDrop · İç Çözünürlük', steps: [0.75, 1, 1.5, 2] },
  ];

  /* Yalnız panelde kaydırıcısı olan ayarlar. Denetleyici hedefi değiller, bu yüzden
     SLIDERS'ta durmuyorlar: OSC ağacı ve kontrol hedefleri o listeden üretiliyor. */
  const RANGES = [
    { path: 'screensaver.idleSec', min: 10, max: 3600, noExtend: true },
    { path: 'screensaver.dim', min: 0.2, max: 1, noExtend: true },
    { path: 'recovery.intervalSec', min: 15, max: 900, noExtend: true },
    { path: 'lyricsLookup.timeoutMs', min: 1000, max: 15000, noExtend: true },
    { path: 'background.gradient.audioBrightness', min: 0, max: 2 },
    { path: 'background.gradient.drift', min: 0, max: 1 },
    { path: 'background.gradient.grain', min: 0, max: 0.2 },
    { path: 'background.gradient.orbit', min: 0, max: 2 },
    { path: 'background.gradient.scale', min: 0.4, max: 3 },
    { path: 'background.gradient.swirl', min: 0, max: 2 },
    { path: 'background.gradient.wander', min: 0, max: 2 },
    { path: 'background.gradient.warp', min: 0, max: 2 },
    { path: 'export.loopCrossfade', min: 0.2, max: 2 },
    { path: 'feedback.bassRotate', min: 0, max: 0.3 },
    { path: 'feedback.bassZoom', min: 0, max: 0.3 },
    { path: 'feedback.dx', min: -0.05, max: 0.05, noExtend: true },
    { path: 'feedback.dy', min: -0.05, max: 0.05, noExtend: true },
    { path: 'feedback.sharpen', min: 0, max: 1 },
    { path: 'feedback.swirl', min: 0, max: 2 },
    { path: 'feedback.waveAmp', min: 0, max: 3 },
    { path: 'feedback.waveThickness', min: 0, max: 3 },
    { path: 'floating.opacity', min: 0.2, max: 1 },
    { path: 'logo.audioBrightness', min: 0, max: 1 },
    { path: 'logo.audioHue', min: 0, max: 1 },
    { path: 'logo.audioOpacity', min: 0, max: 1 },
    { path: 'logo.audioSpeed', min: 0, max: 1 },
    { path: 'logo.beatFlash', min: 0, max: 1 },
    { path: 'logo.brightness', min: 0.2, max: 2 },
    { path: 'logo.cornerRadius', min: 0, max: 0.5 },
    { path: 'logo.glow', min: 0, max: 1 },
    { path: 'logo.hue', min: 0, max: 1 },
    { path: 'logo.pulse', min: 0, max: 1 },
    { path: 'logo.saturate', min: 0, max: 2 },
    { path: 'logo.speed', min: 0.1, max: 3 },
    { path: 'logo.x', min: 0, max: 1 },
    { path: 'logo.y', min: 0, max: 1 },
    { path: 'power.renderScale', min: 0.4, max: 1, noExtend: true },
    { path: 'power.adaptiveFloor', min: 0.3, max: 0.9, noExtend: true },
    { path: 'visualizer.barCenterX', min: 0, max: 1 },
    { path: 'visualizer.barHeight', min: 0.05, max: 1 },
    { path: 'visualizer.barRadius', min: 0, max: 0.5 },
    { path: 'visualizer.barSpan', min: 0.1, max: 1 },
    { path: 'visualizer.baseline', min: 0, max: 1 },
    { path: 'visualizer.capFall', min: 0.25, max: 4 },
    { path: 'visualizer.capHold', min: 0, max: 2 },
    { path: 'visualizer.maxFreq', min: 2000, max: 20000 },
    { path: 'visualizer.minFreq', min: 20, max: 500 },
    { path: 'visualizer.reflection', min: 0, max: 1 },
    { path: 'visualizer.reflectionLength', min: 0.05, max: 1 },
    { path: 'visualizer.segmentGap', min: 0, max: 0.8 },
    { path: 'visualizer.segmentSize', min: 0.01, max: 0.2 },
    { path: 'visualizer.spectrum.attack', min: 0, max: 0.2 },
    { path: 'visualizer.spectrum.floorDb', min: -96, max: -24 },
    { path: 'visualizer.spectrum.release', min: 0.01, max: 1.2 },
    { path: 'visualizer.spectrum.smooth', min: 0, max: 1 },
    { path: 'visualizer.spectrum.spread', min: 0, max: 0.95 },
    { path: 'visualizer.spectrum.tilt', min: -6, max: 12 },
    { path: 'artnet.brightness', min: 0, max: 1, noExtend: true },
    { path: 'artnet.fixtures', min: 1, max: 64, int: true },
    { path: 'artnet.fps', min: 1, max: 44, int: true, noExtend: true },
    { path: 'artnet.startChannel', min: 1, max: 512, int: true, noExtend: true },
    { path: 'artnet.universe', min: 0, max: 32, int: true },
    { path: 'sacn.brightness', min: 0, max: 1, noExtend: true },
    { path: 'sacn.fixtures', min: 1, max: 64, int: true },
    { path: 'sacn.fps', min: 1, max: 44, int: true, noExtend: true },
    { path: 'sacn.priority', min: 0, max: 200, int: true, noExtend: true },
    { path: 'sacn.startChannel', min: 1, max: 512, int: true, noExtend: true },
    { path: 'sacn.universe', min: 1, max: 512, int: true },
    { path: 'wled.brightness', min: 0, max: 1, noExtend: true },
    { path: 'wled.fps', min: 1, max: 60, int: true, noExtend: true },
    { path: 'wled.ledCount', min: 1, max: 1500, int: true },
    { path: 'wledSync.fps', min: 5, max: 60, int: true, noExtend: true },
    { path: 'geometry.alpha', min: 0.05, max: 1 },
    { path: 'geometry.attractorPoints', min: 1000, max: 200000 },
    { path: 'geometry.attractorStep', min: 0.0005, max: 0.02 },
    { path: 'geometry.cameraAudio', min: 0, max: 1 },
    { path: 'geometry.deform', min: 0, max: 1.5 },
    { path: 'geometry.pointSize', min: 1, max: 12 },
    { path: 'geometry.resolution', min: 8, max: 200 },
    { path: 'geometry.spin', min: -2, max: 2 },
    { path: 'geometry.tilt', min: -1.5, max: 1.5 },
    { path: 'geometry.zoom', min: 0.2, max: 3 },
    { path: 'master', min: 0, max: 1, noExtend: true },
    { path: 'media.audioOpacity', min: 0, max: 1, noExtend: true },
    { path: 'media.audioZoom', min: 0, max: 1 },
    { path: 'media.beatPulse', min: 0, max: 1, noExtend: true },
    { path: 'media.hue', min: 0, max: 1, noExtend: true },
    { path: 'media.kenBurns', min: 0, max: 1, noExtend: true },
    { path: 'media.kenBurnsPeriod', min: 4, max: 60 },
    { path: 'media.saturate', min: 0, max: 3 },
    { path: 'media.speed', min: 0.25, max: 4, noExtend: true },
    { path: 'media.inPoint', min: 0, max: 600 },
    { path: 'media.outPoint', min: 0, max: 600 },
    { path: 'stream.overlayFps', min: 24, max: 120 },
    { path: 'stream.quality', min: 0.4, max: 1, noExtend: true },
  ];

  const BY_PATH = new Map(SLIDERS.concat(RANGES).map((x) => [x.path, x]));
  function rangeFor(path) { return BY_PATH.get(path) || null; }

  /* Genişletilmiş aralık: panel seçeneği üst sınırı 5 katına çıkarır. noExtend,
     algoritmanın gerçekten sınırladığı ayarlar: yumuşatma 1'e ulaşırsa sinyal donar.
     Üst sınırı sıfır ya da eksi olan ayar büyütülemez: -24 dB'nin 5 katı -120 dB,
     alt sınırın da altı. */
  const RANGE_FACTOR = 5;
  function extendedMax(row) {
    return row.noExtend || !(row.max > 0) ? row.max : row.max * RANGE_FACTOR;
  }

  const api = { SCENE_KEYS, SLIDERS, RANGES, RANGE_FACTOR, rangeFor, extendedMax };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSchema = api;
})();
