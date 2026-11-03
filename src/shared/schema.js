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
   tam açması, kaydırıcının sonuna gelmesiyle aynı şey olsun. */
(function () {
  const SCENE_KEYS = [
    'background', 'visualizer', 'layers', 'layerStack', 'layerGroups', 'crossfade',
    'geometry', 'postfx', 'logo', 'images', 'media', 'text', 'modulation',
    'transition', 'custom', 'milkdrop', 'feedback',
  ];

  const SLIDERS = [
    { path: 'audio.sensitivity', label: 'Ses · Hassasiyet', min: 0.2, max: 4 },
    { path: 'audio.smoothing', label: 'Ses · Yumuşatma', min: 0, max: 0.95 },
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
    { path: 'feedback.zoom', label: 'Geri Besleme · Yakınlaşma', min: 0.94, max: 1.08 },
    { path: 'feedback.decay', label: 'Geri Besleme · Sönme', min: 0.7, max: 0.999 },
    { path: 'feedback.warp', label: 'Geri Besleme · Bükülme', min: 0, max: 2 },
    { path: 'feedback.rotate', label: 'Geri Besleme · Dönüş', min: -1, max: 1 },
    { path: 'media.opacity', label: 'Medya · Saydamlık', min: 0, max: 1 },
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

  const api = { SCENE_KEYS, SLIDERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVSchema = api;
})();
