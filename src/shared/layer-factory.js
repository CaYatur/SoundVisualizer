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

  const SPRITE_MOTIONS = [['static', 'Sabit'], ['float', 'Süzülme'], ['orbit', 'Yörünge'], ['swirl', 'Girdap'],
    ['scatter', 'Saçılma (sese)'], ['rise', 'Yükselme'], ['fall', 'Düşme']];

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

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const copyVal = (v) => (v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  const defaultsOf = (defIn) => defIn || ((W().SV && W().SV.defaultConfig) ? W().SV.defaultConfig() : {});

  /* Katmanın yazmadığı alanı motor sahneden okuyor (layers.js layerConfig). Sahne fabrika
     değerinden uzaklaşmışsa (şablon, Otomatik VJ, içe alınan yedek) yeni katman o değerlerle
     başlıyordu. Yalnız sahnede FARKLI olan alanlara fabrika değeri yazılır; katmanın kendi
     değerine dokunulmaz. */
  function seedSection(own, scene, fact, skip) {
    for (const k of Object.keys(fact || {})) {
      if (own[k] !== undefined || (skip && skip.indexOf(k) >= 0)) continue;
      const s = scene ? scene[k] : undefined;
      if (s === undefined || sameVal(s, fact[k])) continue;
      own[k] = copyVal(fact[k]);
    }
    return own;
  }

  /* Arkaplan katmanı. Renk paleti (gradient.colors) tohumlanmaz: tema kipinde motor sahnenin
     canlı paletini kullanıyor, renk teması sahnenin ortak ayarı.
     modeOnly: var olan katmanın modu değişiyor; yalnız yeni modun kendi ayarları. */
  function seedFactoryBackground(layer, cfgIn, defIn, opts) {
    const fb = defaultsOf(defIn).background || {};
    const sb = (cfgIn && cfgIn.background) || {};
    const modeOnly = !!(opts && opts.modeOnly);
    const type = layer.type;
    layer.settings = layer.settings || {};
    const own = Object.assign({}, layer.settings.background);
    if (!modeOnly) seedSection(own, sb, { colorMode: fb.colorMode, solidColor: fb.solidColor });
    if (!modeOnly || type === 'gradient') {
      const g = seedSection(Object.assign({}, own.gradient), sb.gradient, fb.gradient, ['colors']);
      if (Object.keys(g).length) own.gradient = g;
    }
    if (type !== 'gradient' && isObj(fb[type])) {
      const m = seedSection(Object.assign({}, own[type]), sb[type], fb[type]);
      if (Object.keys(m).length) own[type] = m;
    }
    if (Object.keys(own).length) layer.settings.background = own;
    return layer;
  }

  /* Metin katmanı: yazmadığı alanlar sahnenin metin ayarından geliyor. */
  function seedFactoryText(layer, cfgIn, defIn) {
    const def = defaultsOf(defIn);
    const text = layer.settings.text;
    seedSection(text, (cfgIn && cfgIn.text) || {}, def.text, ['enabled']);
    const fv = def.visualizer || {};
    const sv = (cfgIn && cfgIn.visualizer) || {};
    if (text.colorMode === undefined && sv.colorMode !== undefined && sv.colorMode !== fv.colorMode) text.colorMode = fv.colorMode;
    return seedFactoryVisualizer(layer, cfgIn, def);
  }

  /* Çalan parça katmanı: aynı miras sahnenin nowplaying ayarından. */
  function seedFactoryNowPlaying(layer, cfgIn, defIn) {
    const def = defaultsOf(defIn);
    const np = layer.settings.nowplaying;
    seedSection(np, (cfgIn && cfgIn.nowplaying) || {}, def.nowplaying, ['enabled', 'source']);
    const fv = def.visualizer || {};
    const sv = (cfgIn && cfgIn.visualizer) || {};
    if (np.colorMode === undefined && sv.colorMode !== undefined && sv.colorMode !== fv.colorMode) np.colorMode = fv.colorMode;
    return seedFactoryVisualizer(layer, cfgIn, def);
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
       { kind: 'visualizer' | 'background', type, presetId? }   bir mod (Studio: type 'custom')
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
      return seedFactoryText(S.makeTextLayer(spec), cfg, o.defaults);
    }
    if (w.kind === 'nowplaying') return seedFactoryNowPlaying(S.makeNowPlayingLayer({ name: w.name || 'Çalan Parça' }), cfg, o.defaults);
    const spec = { kind: w.kind, name: w.name || '', type: w.type };
    if (w.presetId) spec.presetId = w.presetId;
    const made = S.normalizeLayer(spec);
    if (w.kind === 'visualizer') seedFactoryVisualizer(made, cfg, o.defaults);
    if (w.kind === 'background') seedFactoryBackground(made, cfg, o.defaults);
    return made;
  }

  /* Galeriden seçilen dosyadan katman (telefon; masaüstünde panel aynı alanları yazıyor):
       'video' { url, name }      → medya katmanı, kaynak dosya
       'image' { dataUrl, name }  → görsel nesne katmanı, tek görsel
       'logo'  { dataUrl, name }  → logo katmanı, elle seçilen resim */
  function makeMedia(kind, file, defIn) {
    const S = L();
    const def = defIn || ((W().SV && W().SV.defaultConfig) ? W().SV.defaultConfig() : {});
    const f = file || {};
    if (kind === 'video') {
      return S.normalizeLayer({
        kind: 'media', name: f.name || 'Video',
        settings: { media: Object.assign({}, def.media, { enabled: true, source: 'file', file: f.url || '', fileName: f.name || '', libraryId: '' }) },
      });
    }
    // Kamera (telefon: { deviceId, label } boşsa varsayılan kamera; izin ilk açılışta sorulur)
    if (kind === 'camera') {
      return S.normalizeLayer({
        kind: 'media', name: f.label || 'Kamera',
        settings: { media: Object.assign({}, def.media, { enabled: true, source: 'webcam', deviceId: f.deviceId || '', deviceLabel: f.label || '', file: null, fileName: '', libraryId: '' }) },
      });
    }
    if (kind === 'logo') {
      return S.normalizeLayer({
        kind: 'logo', name: 'Logo',
        settings: { logo: Object.assign({}, def.logo, { enabled: true, source: 'manual', src: f.dataUrl || null, libraryId: '', kind: /^data:image\/gif/i.test(f.dataUrl || '') ? 'gif' : 'image' }) },
      });
    }
    const item = W().SV && W().SV.imageItem ? W().SV.imageItem({ src: f.dataUrl || null, name: f.name || 'Görsel' }) : { src: f.dataUrl || null };
    return S.normalizeLayer({ kind: 'sprites', type: 'back', name: f.name || 'Görsel Nesneler', settings: { images: { enabled: true, items: [item] } } });
  }

  /* Katmanın kopyası (panelin "Çoğalt"ı): yeni kimlik, solo kapalı, ad "(kopya)". */
  function duplicate(layer) {
    const copy = JSON.parse(JSON.stringify(layer));
    copy.id = null;
    copy.name = (layer.name || layer.kind) + ' (kopya)';
    copy.solo = false;
    return L().normalizeLayer(copy);
  }

  const api = { BLEND_LABELS, BAND_LABELS, SPRITE_MOTIONS, TEXT_ADD_PRESETS, seedFactoryVisualizer, seedFactoryBackground, milkdropPreset, make, makeMedia, duplicate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLayerFactory = api;
})();
