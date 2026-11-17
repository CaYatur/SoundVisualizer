/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KATMAN ÜRETİCİSİ: yeni katmanın panelde ve telefonda aynı kurulması (Faz 3.3, #1054).

   Masaüstünün katman ekleme yolu (src/admin/scene-panels.js) yalnız normalizeLayer
   değil: görselleştirici katmanı fabrika değerleriyle tohumlanıyor, MilkDrop katmanı
   gömülü paketten varsayılan presetle geliyor (ikinci MilkDrop kendi presetini alıyor),
   metin katmanları hazır kalıplardan. Telefon aynı katmanı kursun diye bu bilgi burada.

   Masaüstündeki kopyalar yerinde kaldı: panelin testleri scene-panels.js'i metin
   olarak dilimleyip okuyor. Aynı kalmaları android/js-tests/layer-factory.test.js'te
   denetleniyor (etiket listeleri, kalıplar ve tohumlama aynı girdide aynı sonuç).

   Bu dosya mod küçük resimlerinin anahtarına girmiyor (src/thumbs/modes.html onu
   yüklemiyor); değiştirmek resimleri eskitmez. */
(function () {
  const BLEND_LABELS = [
    ['normal', 'Normal'], ['add', 'Toplama'], ['screen', 'Ekran\u200B'], ['multiply', 'Çarpma'],
    ['overlay', 'Kaplama'], ['darken', 'Koyulaştır'], ['lighten', 'Açıklaştır'],
    ['color-dodge', 'Renk Soldurma'], ['color-burn', 'Renk Yakma'],
    ['hard-light', 'Sert Işık'], ['soft-light', 'Yumuşak Işık'],
    ['difference', 'Fark'], ['exclusion', 'Dışlama'],
    ['hue', 'Renk Tonu'], ['saturation', 'Doygunluk'], ['color', 'Renk'], ['luminosity', 'Parlaklık'],
  ];

  const BAND_LABELS = [['bass', 'Bas'], ['mid', 'Orta'], ['treble', 'Tiz'], ['level', 'Genel']];

  const TEXT_ADD_PRESETS = [
    { label: 'Metin', spec: { name: 'Metin', source: 'static' } },
    { label: 'Şarkı Sözü', spec: { name: 'Şarkı Sözü', source: 'lyrics' } },
    {
      label: 'Sanatçı Adı',
      spec: {
        name: 'Sanatçı Adı', source: 'now', field: 'artist',
        content: 'SANATÇI ADI', placeholder: true, size: 0.032, weight: 500, y: 0.83,
      },
    },
  ];

  const W = () => (typeof window !== 'undefined' ? window : {});
  const L = () => W().SVLayers;

  /* Yeni görselleştirici katmanı fabrika değerleriyle başlar: katman yazmadığı
     alanlarda sahnenin görselleştiricisini miras alıyor (layers.js layerConfig).
     Yalnız sahnede farklı olan düz alanlar yazılır. (scene-panels.js'teki aynısı.) */
  function seedFactoryVisualizer(layer, cfgIn, defIn) {
    const cfg = cfgIn || {};
    const def = defIn || ((W().SV && W().SV.defaultConfig) ? W().SV.defaultConfig() : {});
    const fv = (def && def.visualizer) || {};
    const sv = (cfg && cfg.visualizer) || {};
    layer.settings = layer.settings || {};
    const vs = (layer.settings.visualizer = layer.settings.visualizer || {});
    for (const k of Object.keys(fv)) {
      if (k === 'type' || vs[k] !== undefined) continue;
      const f = fv[k];
      if (f !== null && typeof f === 'object') continue;
      if (sv[k] === undefined || sv[k] === f) continue;
      vs[k] = f;
    }
    return layer;
  }

  /* Gömülü paketten preset (panel varsa önce onun dizini). */
  function milkdropPreset(id) {
    const MP = W().SVMilkdropPanel;
    const hit = MP && MP.presetById ? MP.presetById(id) : null;
    if (hit && typeof hit.source === 'string') return hit;
    const pack = (W().SVMilkdropBuiltins || W().SVMilkdropPack || []);
    return pack.find((p) => p && p.id === id) || hit || null;
  }

  /* Yeni katman. what:
       { kind: 'visualizer' | 'background', type }   bir mod
       { kind: 'milkdrop' }                           varsayılan MilkDrop presetiyle
       { kind: 'text', preset: 0..2 }                 TEXT_ADD_PRESETS'ten
       { kind: 'nowplaying' }
     name verilmezse modun / kalıbın adı. cfg: sahnenin ayarı (okunur; MilkDrop'ta
     ortak preset boşsa cfg.milkdrop'a yazılır, panelin yaptığı gibi). */
  function make(what, cfg, opts) {
    const S = L();
    const o = opts || {};
    const w = what || {};
    if (!S) throw new Error('SVLayers yok');
    if (w.kind === 'milkdrop') {
      const made = S.makeMilkdropLayer(cfg, { preset: milkdropPreset(S.MD_DEFAULT_PRESET), name: w.name || 'MilkDrop' });
      return seedFactoryVisualizer(made, cfg, o.defaults);
    }
    if (w.kind === 'text') {
      const preset = TEXT_ADD_PRESETS[w.preset | 0] || TEXT_ADD_PRESETS[0];
      const spec = preset.spec.source === 'lyrics' ? Object.assign({}, preset.spec, { lyricsFollow: !!o.lyricsFollow }) : preset.spec;
      return S.makeTextLayer(spec);
    }
    if (w.kind === 'nowplaying') return S.makeNowPlayingLayer({ name: w.name || 'Çalan Parça' });
    const made = S.normalizeLayer({ kind: w.kind, name: w.name || '', type: w.type });
    if (w.kind === 'visualizer') seedFactoryVisualizer(made, cfg, o.defaults);
    return made;
  }

  /* Katmanın kopyası (panelin "Çoğalt"ı): yeni kimlik, solo kapalı, ad "(kopya)". */
  function duplicate(layer) {
    const copy = JSON.parse(JSON.stringify(layer));
    copy.id = null;
    copy.name = (layer.name || layer.kind) + ' (kopya)';
    copy.solo = false;
    return L().normalizeLayer(copy);
  }

  const api = { BLEND_LABELS, BAND_LABELS, TEXT_ADD_PRESETS, seedFactoryVisualizer, milkdropPreset, make, duplicate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLayerFactory = api;
})();
