/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Katman kompozit motoru.

   Sahne artık sabit bir yığın (arkaplan → görselleştirici → logo) değil,
   sıralı bir KATMAN listesidir. Her katmanın kendi kaynağı, karışım modu,
   saydamlığı, dönüşümü ve kendi ayar geçersiz kılmaları vardır — yani aynı
   sahnede farklı renklerde iki "bars" katmanı ya da bir shader'ın üstüne
   bindirilmiş bir çember olabilir.

   İki kompozit yolu var, ikisi de AYNI katman listesini okur:

   • Canlı pencereler (görselleştirici, panel önizlemesi, OBS katmanı) her
     katmanı kendi <canvas>'ına çizer ve karıştırmayı CSS mix-blend-mode ile
     TARAYICININ GPU kompozitörüne bırakır. Elle drawImage yapmaya göre çok
     daha ucuz; dönüşüm ve saydamlık da bedavaya gelir.

   • Çevrimdışı dışa aktarıcı tek bir tuvale yazmak zorunda olduğu için aynı
     katmanları globalCompositeOperation ile elle birleştirir. Canvas 2D'nin
     karışım adları CSS ile birebir aynı olduğu için iki yol aynı görüntüyü
     üretir.

   Geriye dönük uyum: cfg.layers boşsa liste eski alanlardan (background /
   media / images / visualizer / logo) SENTEZLENİR. v2.0 ayarları, sahneleri
   ve preset paketleri hiçbir değişiklik olmadan aynı kareyi verir. */
(function () {
  // CSS mix-blend-mode ve canvas globalCompositeOperation'ın ortak kümesi
  const BLEND_MODES = [
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light',
    'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
  ];
  // 'add' CSS'te yok; canvas'ta 'lighter'. Canlı yolda 'screen'e en yakın
  // görsel karşılığıyla eşlenir (ikisi de aydınlatır).
  const CSS_BLEND = (b) => (b === 'add' ? 'screen' : BLEND_MODES.indexOf(b) >= 0 ? b : 'normal');
  const CANVAS_BLEND = (b) => (b === 'add' ? 'lighter' : BLEND_MODES.indexOf(b) >= 0 ? b : 'source-over');

  const KINDS = ['background', 'visualizer', 'media', 'sprites', 'logo', 'nowplaying'];

  /* Bağlamı kaybolan bir yüzey en çok bu aralıkla yeniden kuruluyor (#594). */
  const REVIVE_MS = 2000;

  let layerIdSeq = 0;
  function newLayerId() {
    // Aynı milisaniyede eklenen katmanlar çakışmasın (bkz. presets.js newId)
    layerIdSeq = (layerIdSeq + 1) % 0x7fffffff;
    return 'ly_' + Date.now().toString(36) + '_' + layerIdSeq.toString(36) + Math.floor(Math.random() * 0xffff).toString(36);
  }

  const LAYER_DEFAULTS = {
    id: null,
    name: '',
    enabled: true,
    kind: 'visualizer',
    type: 'bars', // arkaplan/görselleştirici mod adı
    presetId: null, // type === 'custom' iken Studio preseti
    blend: 'normal',
    opacity: 1,
    transform: { scale: 1, rotate: 0, x: 0, y: 0, flipX: false, flipY: false },
    // Sese bağlı modülasyon: seçilen bant katmanın saydamlığını/ölçeğini sürer
    audio: { band: 'bass', opacity: 0, scale: 0, rotate: 0 },
    // Katmana özel ayar geçersiz kılmaları (genel yapılandırmanın üstüne biner)
    settings: {},

    /* Solo / sessiz / kilit.

       Üçü de farklı sorunu çözüyor ve üçü de bir kompozitörde beklenen
       davranışlar: solo bir katmanı yalnız bırakır (diğerlerini silmeden),
       sessiz katmanı ayarlarını kaybetmeden gizler, kilit ise kazara
       düzenlemeyi engeller. */
    solo: false,
    muted: false,
    locked: false,

    // Katman grubu adı. Aynı gruptaki katmanlar tek fader'la yönetilir.
    group: '',

    /* Maske. Katmanın hangi bölgesinin görüneceğini belirler.
         type: 'none' | 'rect' | 'ellipse' | 'linear' | 'radial' | 'layer'
         invert: maskeyi tersine çevirir
         feather: kenar yumuşaklığı (0..1)
         from: type === 'layer' iken maske olarak kullanılacak katmanın kimliği */
    mask: { type: 'none', x: 0.5, y: 0.5, w: 0.6, h: 0.6, angle: 0, feather: 0.1, invert: false, from: '' },

    // Katmana özel efekt zinciri (bileşik zincirden ayrı)
    postfx: [],
  };

  function normalizeLayer(l) {
    const out = Object.assign({}, LAYER_DEFAULTS, l || {});
    out.transform = Object.assign({}, LAYER_DEFAULTS.transform, (l && l.transform) || {});
    out.audio = Object.assign({}, LAYER_DEFAULTS.audio, (l && l.audio) || {});
    out.mask = Object.assign({}, LAYER_DEFAULTS.mask, (l && l.mask) || {});
    out.postfx = Array.isArray(l && l.postfx) ? l.postfx : [];
    out.settings = (l && l.settings) || {};
    if (KINDS.indexOf(out.kind) < 0) out.kind = 'visualizer';
    if (out.kind === 'nowplaying') out.type = 'nowplaying';
    if (!out.id) out.id = newLayerId();
    return out;
  }

  /* Metin katmanı fabrikası.

     Metin bir kind değil, visualizer türünün bir alt tipi. Katman ekleme
     sırası yalnızca kind düğmeleri ürettiği için yazı / şarkı sözü /
     sanatçı adı şablon dışında eklenemiyordu. Panel bu yardımcıyı
     kullanır; şablonlardaki textLayer() ile aynı kaynak sözleşmesini
     üretir (settings.text.enabled + source/field). */
  function makeTextLayer(spec) {
    const s = spec || {};
    const source = s.source || 'static';
    const align = s.align || (source === 'now' ? 'left' : 'center');
    const text = {
      enabled: true,
      source,
      content: s.content != null ? s.content : (source === 'static' ? 'CAYADEV' : ''),
      size: s.size == null ? (source === 'static' ? 0.09 : source === 'lyrics' ? 0.07 : 0.06) : s.size,
      align,
      x: s.x == null ? (align === 'left' ? 0.2 : 0.5) : s.x,
      y: s.y == null ? (source === 'static' ? 0.5 : source === 'lyrics' ? 0.82 : 0.78) : s.y,
      weight: s.weight == null ? (source === 'now' ? 800 : 700) : s.weight,
      animation: s.animation || 'fade',
      audioScale: s.audioScale == null ? (source === 'now' ? 0 : 0.12) : s.audioScale,
    };
    if (source === 'now') {
      text.field = s.field || 'both';
      text.nowSource = s.nowSource || 'system';
      text.nowPlaying = { title: '', artist: '' };
      text.showArtwork = s.showArtwork !== false;
      /* Yer tutucu (ör. "SANATÇI ADI") elle girilen parça bilgisi sayılmaz:
         boş kalır ki çıkış onu arayüz dilinde çizsin (modes/text.js). */
      if (s.placeholder) text.placeholder = true;
      else if (text.field === 'title') text.nowPlaying.title = text.content;
      else if (text.field === 'artist') text.nowPlaying.artist = text.content;
    }
    if (source === 'lyrics') {
      text.lyricsSource = '';
      text.lyricsName = '';
      text.karaoke = true;
      text.lyricsFollow = false;
      text.lyricsMatch = 'exact';
    }
    return normalizeLayer({
      name: s.name || 'Metin',
      kind: 'visualizer',
      type: 'text',
      settings: { text },
    });
  }

  /* Now Playing layer factory — first-class kind (alongside media/logo).
     Reuses SVModes.nowplaying cover/title rendering + settings.nowplaying. */
  function makeNowPlayingLayer(spec) {
    const s = spec || {};
    const np = Object.assign({
      enabled: true,
      source: s.source || 'system',
      coverOverlay: s.coverOverlay != null ? !!s.coverOverlay : false,
    }, s.nowplaying || {});
    return normalizeLayer({
      name: s.name || 'Çalan Parça',
      kind: 'nowplaying',
      type: 'nowplaying',
      settings: { nowplaying: np },
    });
  }

  /* Eski (katmansız) yapılandırmadan katman listesi üretir.
     Sıra, v2.0'daki z-index yığınının birebir aynısıdır:
       arkaplan → (medya arkada) → sprite arka → görselleştirici →
       sprite ön → (medya önde) → logo */
  function synthesize(cfg) {
    const out = [];
    const bgType = cfg.background && cfg.background.type;
    if (bgType && bgType !== 'transparent') {
      out.push(normalizeLayer({
        id: 'ly_bg', name: 'Arkaplan', kind: 'background',
        type: bgType, presetId: cfg.custom && cfg.custom.backgroundId,
        settings: { background: JSON.parse(JSON.stringify(cfg.background || {})) },
      }));
    }
    const media = cfg.media || {};
    if (media.enabled && media.layer !== 'front') {
      out.push(normalizeLayer({
        id: 'ly_media', name: 'Medya', kind: 'media', blend: media.blend || 'normal',
        settings: { media: JSON.parse(JSON.stringify(media)) },
      }));
    }
    if (cfg.images && cfg.images.enabled) {
      out.push(normalizeLayer({
        id: 'ly_spr_back', name: 'Görsel Nesneler (arka)', kind: 'sprites', type: 'back',
        settings: { images: JSON.parse(JSON.stringify(cfg.images)) },
      }));
    }
    const visType = cfg.visualizer && cfg.visualizer.type;
    if (visType && visType !== 'none') {
      out.push(normalizeLayer({
        id: 'ly_vis', name: 'Görselleştirici', kind: 'visualizer',
        type: visType, presetId: cfg.custom && cfg.custom.visualizerId,
        settings: { visualizer: JSON.parse(JSON.stringify(cfg.visualizer || {})) },
      }));
    }
    if (cfg.images && cfg.images.enabled) {
      out.push(normalizeLayer({
        id: 'ly_spr_front', name: 'Görsel Nesneler (ön)', kind: 'sprites', type: 'front',
        settings: { images: JSON.parse(JSON.stringify(cfg.images)) },
      }));
    }
    if (media.enabled && media.layer === 'front') {
      out.push(normalizeLayer({
        id: 'ly_media', name: 'Medya', kind: 'media', blend: media.blend || 'normal',
        settings: { media: JSON.parse(JSON.stringify(media)) },
      }));
    }
    if (cfg.text && cfg.text.enabled && visType !== 'text') {
      out.push(normalizeLayer({
        id: 'ly_text', name: 'Metin', kind: 'visualizer', type: 'text',
        settings: { text: JSON.parse(JSON.stringify(cfg.text || {})) },
      }));
    }
    if (cfg.logo && cfg.logo.enabled && (cfg.logo.src || cfg.logo.libraryId || (cfg.logo.source || 'auto') !== 'manual')) {
      out.push(normalizeLayer({
        id: 'ly_logo', name: 'Logo', kind: 'logo',
        settings: { logo: JSON.parse(JSON.stringify(cfg.logo || {})) },
      }));
    }
    return out;
  }

  /* Katman yığını açık mı?

     Kapalıyken katman listesi DURUR ama kullanılmaz: sahne yine Arkaplan ve
     Görselleştirici kartlarından sentezlenir. Böylece katmanları kapatmak
     onları silmek anlamına gelmiyor, geri açınca aynı düzen geri geliyor.

     Bayrak hiç yoksa eski davranış: dolu bir liste varsa açık sayılır. Bu,
     v3.0.0 öncesi ayar dosyalarının sahnesini bozmadan açılmasını sağlıyor. */
  /* Havuz anahtarı. Aynı dosya veya aynı kamera tek akış paylaşır;
     farklı deviceId iki getUserMedia demektir. */
  function mediaSourceKey(m) {
    if (!m) return 'cam|';
    if (m.source === 'file') return 'file|' + (m.loop === false ? '0|' : '1|') + (m.file || '');
    return 'cam|' + (m.deviceId || '');
  }

  function stackOn(cfg) {
    const s = cfg && cfg.layerStack;
    if (s && typeof s.enabled === 'boolean') return s.enabled;
    return !!(cfg && Array.isArray(cfg.layers) && cfg.layers.length);
  }

  /* SAYDAM MOD — "şeffaf arkaplan".

     İki ayrı saydamlık var ve ikisi de aynı şeyi istiyor: katmanların
     arkasında hiçbir şey boyanmasın.
       - `background.type === 'transparent'`: saydam şablonlar; arkaplan
         katmanı hiç kurulmuyor.
       - `background.transparent`: "Şeffaf Arkaplan"; pencere şeffaf doğuyor.
         Yayın katmanı (OBS) ve Spout/Syphon AYNI bayrağı kullanır.
       - Katman yığınında bir arkaplan katmanının `settings.background.transparent`
         bayrağı da yeter: yığın açıkken kök kart gizli olduğu için ayar
         katmandan açılır.
     Karartma sürerken siyah kalıyor — saydam bir karartma ekranı söndürmek
     yerine masaüstünü gösterirdi. */
  /* Sıfır boyutlu bir tuvalin bileşime katacağı bir şey yok, `drawImage` ise
     onu istisnayla reddediyor. Atılan katman tuvali sıfıra iniyor (#621) ve
     pencere henüz boyutlanmamışken kurulan tuval de sıfır doğuyor; ikisi de
     kareyi yarıda kesmemeli. Uygulamada ölçüldü: bütün modları sırayla
     çizen bir taramada ara sıra, geçiş sırasında. */
  function drawable(c) {
    return !!(c && c.width > 0 && c.height > 0);
  }

  function seeThrough(cfg) {
    const bg = cfg && cfg.background;
    if (!bg) return false;
    if (bg.type === 'transparent') return true;
    if (cfg.isBlackout === true) return false;
    if (bg.transparent) return true;
    if (stackOn(cfg) && Array.isArray(cfg.layers)) {
      for (let i = 0; i < cfg.layers.length; i++) {
        const l = cfg.layers[i];
        if (l && l.kind === 'background' && l.enabled !== false && !l.muted
            && l.settings && l.settings.background && l.settings.background.transparent) {
          return true;
        }
      }
    }
    return false;
  }

  /* Bu arkaplan katmanının koyu yerleri saydamlaşsın mı?
     Yığın açıkken katmanın kendi bayrağı, klasik yolda kök ayar. */
  function layerWantsKey(layer, cfg) {
    if (!layer || layer.kind !== 'background') return false;
    if (cfg && cfg.isBlackout === true) return false;
    const s = layer.settings && layer.settings.background;
    if (s && typeof s.transparent === 'boolean') return !!s.transparent;
    return !!(cfg && cfg.background && cfg.background.transparent);
  }

  /* Sayfanın (body) zemini.

     Saydam modda boyanmamalı. Masaüstünde boyanıyordu: `.sv-transparent body`
     kuralı vardı ama görselleştirici body'ye SATIR İÇİ renk yazıyordu (düz
     renk ya da siyah) ve satır içi stil her kuralı ezer. Pencere şeffaf doğsa
     bile arkası hiçbir sürümde görünmüyordu, ve her ayar değişikliği rengi
     yeniden yazıyordu. */
  function pageBackground(cfg) {
    if (seeThrough(cfg)) return 'transparent';
    const bg = (cfg && cfg.background) || {};
    return bg.type === 'solid' ? (bg.solidColor || '#000') : '#000';
  }

  /* ARKAPLAN EFEKTİNİN KOYU YERLERİ SAYDAM.

     Şeffaf arkaplan açıkken bir arkaplan efekti (sıvı metal, nebula...)
     pencerenin her pikselini boyuyor, masaüstü hiç görünmüyordu. Artık
     efektin koyu yerleri saydamlaşıyor:
         görünürlük = parlaklık / eşik   (0..1'e kırpılmış)
     Eşiğin üstü tam görünür, siyah tam saydam; eşik 0'da bile saf siyah
     saydam kalıyor (alt sınır 1/255).

     Parlaklık üç kanalın ORTALAMASI: süzgeç bir SVG renk matrisi ve doğrusal
     olmak zorunda (en büyük kanal alınamıyor); Rec.709 ağırlıkları ise
     doygun maviyi neredeyse görünmez yapardı (0,07). */
  const KEY_DEFAULT = 0.2;
  const KEY_MIN = 1 / 255;
  function keyThreshold(cfg) {
    const v = Number(cfg && cfg.background && cfg.background.transparentKey);
    return Math.max(KEY_MIN, Math.min(1, isFinite(v) ? v : KEY_DEFAULT));
  }

  // feColorMatrix değerleri: renk aynen, alfa = (r + g + b) / (3 * eşik)
  function keyMatrix(cfg) {
    const w = +(1 / (3 * keyThreshold(cfg))).toFixed(6);
    return '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 ' + w + ' ' + w + ' ' + w + ' 0 0';
  }

  /* Katman yığını anahtarını ve bağımlı klasik kök alanları yönetir.
     Katmanlar açıldığında (enabled = true):
       1. Henüz katman listesi yoksa mevcut klasik ayarlardan sentezlenir.
       2. Klasik alanlar (visualizer, logo, images, media, text) aktif ise
          yedeklenir ve devre dışı (pasif) bırakılır. Böylece arka planda
          çakışma ve gereksiz render/kaynak tüketimi olmaz.
     Katmanlar kapatıldığında (enabled = false):
       Klasik alanlar önceki aktif durumlarına geri yüklenir. */
  function snapshotClassic(cfg) {
    const curVis = cfg.visualizer && cfg.visualizer.type;
    return {
      /* 'none' de bir seçim: görselleştiricisiz (yalnız arkaplanlı) bir
         sahne, yığın açılıp kapanınca 'bars' ile geri geliyordu. */
      visualizerType: curVis || 'none',
      logoEnabled: !!(cfg.logo && cfg.logo.enabled),
      imagesEnabled: !!(cfg.images && cfg.images.enabled),
      mediaEnabled: !!(cfg.media && cfg.media.enabled),
      textEnabled: !!(cfg.text && cfg.text.enabled),
    };
  }

  function restoreClassic(cfg, b) {
    if (!b) return;
    if (cfg.visualizer && b.visualizerType) cfg.visualizer.type = b.visualizerType;
    if (cfg.logo && b.logoEnabled !== undefined) cfg.logo.enabled = !!b.logoEnabled;
    if (cfg.images && b.imagesEnabled !== undefined) cfg.images.enabled = !!b.imagesEnabled;
    if (cfg.media && b.mediaEnabled !== undefined) cfg.media.enabled = !!b.mediaEnabled;
    if (cfg.text && b.textEnabled !== undefined) cfg.text.enabled = !!b.textEnabled;
  }

  function clearClassicOverlays(cfg) {
    if (cfg.visualizer) cfg.visualizer.type = 'none';
    if (cfg.logo) cfg.logo.enabled = false;
    if (cfg.images) cfg.images.enabled = false;
    if (cfg.media) cfg.media.enabled = false;
    if (cfg.text) cfg.text.enabled = false;
  }

  function setStackEnabled(cfg, enabled) {
    if (!cfg) return;
    cfg.layerStack = cfg.layerStack || {};
    const on = !!enabled;
    if (on) {
      /* Zaten açıksa klasik alanlar temizlenmiş durumda ('none'); yeniden
         yedeklemek gerçek klasik sahneyi silerdi. Boş liste yine sentezlenir:
         "Katmanlara Geç" düğmesi tam bu durumda (açık, liste boş) görünüyor. */
      const already = cfg.layerStack.enabled === true;
      if (!Array.isArray(cfg.layers) || !cfg.layers.length) {
        cfg.layers = synthesize(cfg);
      }
      if (already) return;
      /* Fresh snapshot every time the stack is turned on — do not ratchet
         previous backup flags to true. Overlay modes added as layers while
         the stack is on must not leak into classic roots on the way back. */
      cfg.layerStack.classicBackup = snapshotClassic(cfg);
      clearClassicOverlays(cfg);
      cfg.layerStack.enabled = true;
    } else {
      cfg.layerStack.enabled = false;
      const b = cfg.layerStack.classicBackup;
      if (b) {
        restoreClassic(cfg, b);
      } else {
        /* No snapshot (legacy / template): keep the scene lit via the
           visualizer type from the layer list, but do NOT promote logo /
           text / images / media layers into classic toggles — those stay
           at whatever the classic roots already are (usually off). */
        const list = Array.isArray(cfg.layers) ? cfg.layers : [];
        const vis = list.find((l) => l && l.kind === 'visualizer'
          && l.type !== 'text' && l.type !== 'nowplaying');
        /* kind nowplaying is a dedicated overlay, not a classic visualizer type. */
        if (cfg.visualizer && cfg.visualizer.type === 'none') {
          cfg.visualizer.type = vis ? vis.type : 'bars';
        }
      }
    }
  }

  /* Canlı görselleştirici.
     Yığın açıkken resolve() yalnız cfg.layers'a bakar. Studio ve MCP
     cfg.visualizer.type yazınca liste, çıkış ve önizleme eski katmanda
     kalıyordu; düzeltme paneli kapatıp açınca ya da uygulamayı yeniden
     başlatınca geliyordu. Aynı değişiklik ilk görselleştirici katmanına
     da yazılır ve katman hemen açılır. Yığın kapalıyken ve liste boşken
     klasik alan yeter; sentez onu çizer.
  */
  const OVERLAY_VIS = { text: 1, nowplaying: 1 };
  function liveVisualizerLayers(cfg) {
    const list = cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    return list.filter((l) => l && l.kind === 'visualizer' && !OVERLAY_VIS[l.type]);
  }
  function adoptVisualizer(cfg, spec) {
    if (!cfg) return null;
    const s = spec || {};
    const type = s.type ? String(s.type) : ((cfg.visualizer && cfg.visualizer.type) || 'bars');
    const hasPreset = Object.prototype.hasOwnProperty.call(s, 'presetId');
    const presetId = hasPreset ? s.presetId : (cfg.custom && cfg.custom.visualizerId) || null;
    cfg.visualizer = Object.assign({}, cfg.visualizer, { type: type });
    if (type === 'custom') {
      cfg.custom = Object.assign({}, cfg.custom);
      if (presetId) cfg.custom.visualizerId = presetId;
    }
    const hadLayers = Array.isArray(cfg.layers) && cfg.layers.length > 0;
    if (!stackOn(cfg) && !hadLayers) return null;
    if (!stackOn(cfg)) setStackEnabled(cfg, true);
    if (!Array.isArray(cfg.layers)) cfg.layers = [];
    let layer = liveVisualizerLayers(cfg)[0];
    if (!layer) {
      layer = normalizeLayer({
        name: 'Görselleştirici',
        kind: 'visualizer',
        type: type,
        presetId: type === 'custom' ? (presetId || null) : null,
        enabled: true,
        settings: s.visualizer ? { visualizer: JSON.parse(JSON.stringify(s.visualizer)) } : {},
      });
      cfg.layers.push(layer);
      return layer;
    }
    layer.type = type;
    if (type === 'custom') layer.presetId = presetId || layer.presetId || null;
    else if (hasPreset) layer.presetId = presetId;
    layer.enabled = true;
    layer.muted = false;
    if (s.visualizer) {
      layer.settings = layer.settings || {};
      const prev = layer.settings.visualizer || {};
      layer.settings.visualizer = Object.assign({}, prev, JSON.parse(JSON.stringify(s.visualizer)), { type: type });
    } else if (layer.settings && layer.settings.visualizer) {
      layer.settings.visualizer.type = type;
    }
    return layer;
  }
  /* Katmanı göstermek, bayrağı yazmak değildir. Yığın kapalıyken resolve()
     listeyi kullanmaz; anahtar açılır, sessiz kalkar, katman çizilir. */
  function revealLayer(cfg, layer) {
    if (!cfg || !layer) return;
    if (!stackOn(cfg)) setStackEnabled(cfg, true);
    layer.enabled = true;
    layer.muted = false;
  }

  /* GENEL KONTROLLER YIĞINDA.

     Yığın açıkken ekranı katmanların kendi ayarları çiziyor ve yığın ilk
     açıldığında sentezlenen katmanlar klasik bölümün TAM kopyasını taşıyor.
     MIDI/OSC kaydırıcısı, telefon kumandası, modülasyon ve zaman çizelgesi
     ise `visualizer.barCount` gibi genel yola yazıyordu: değer kopyanın
     altında kalıyor, ekranda hiçbir şey değişmiyordu. Yalıtılmış kopyada
     ölçüldü: klasik kipte bar sayısı 160→30 oldu, yığında 160 kaldı; mod
     ve arkaplan düğmeleri de yığında hiçbir şey değiştirmedi.

     Kural: genel bir yol, o türdeki ilk canlı katmana gider (Studio ve
     MCP'nin görselleştirici seçimi adoptVisualizer ile zaten böyleydi).
     Katmanın o alanda kendi değeri yoksa genel değer layerConfig'te zaten
     akıyor; yol olduğu gibi kalır. Tür (`type`) burada değil,
     adoptVisualizer / adoptBackground ile değişir. */
  const SECTION_KIND = { visualizer: 'visualizer', background: 'background', logo: 'logo', media: 'media' };
  // Önce görünen (açık, susturulmamış) ilk katman; yoksa o türün ilki
  function firstLayerIndex(cfg, section) {
    const kind = SECTION_KIND[section];
    const list = cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    let first = -1;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (!l || l.kind !== kind) continue;
      if (kind === 'visualizer' && OVERLAY_VIS[l.type]) continue;
      if (l.enabled !== false && !l.muted) return i;
      if (first < 0) first = i;
    }
    return first;
  }
  function pathValue(obj, keys) {
    let cur = obj;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[k];
    }
    return cur;
  }
  /* Genel yolun ekranda karşılığı olan yol: yığın kapalıyken ya da katman
     o değeri taşımıyorken kendisi, aksi halde
     `layers.<i>.settings.<bölüm>.<alt yol>`. */
  function effectivePath(cfg, path) {
    if (typeof path !== 'string' || !stackOn(cfg)) return path;
    const keys = path.split('.');
    const section = keys[0];
    if (!SECTION_KIND[section] || keys.length < 2 || keys[1] === 'type') return path;
    const i = firstLayerIndex(cfg, section);
    if (i < 0) return path;
    const own = cfg.layers[i].settings && cfg.layers[i].settings[section];
    if (!own || pathValue(own, keys.slice(1)) === undefined) return path;
    return 'layers.' + i + '.settings.' + path;
  }
  /* Genel alana yazılan değeri ekrandaki katmana da yazar (yerinde). Genel
     alanı çağıran yazar; burada yalnız katmanın kopyası. */
  function setEffective(cfg, path, value) {
    const eff = effectivePath(cfg, path);
    if (eff === path) return false;
    const keys = eff.split('.');
    let cur = cfg;
    for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
    cur[keys[keys.length - 1]] = value;
    return true;
  }

  /* Ekranda görünen tür. Yığın açıkken klasik `visualizer.type` bilerek
     'none'; sıradaki moda geçen bir eylem onu okursa listenin başına
     atlıyordu. */
  function currentType(cfg, section) {
    if (stackOn(cfg)) {
      const i = firstLayerIndex(cfg, section);
      return i >= 0 ? cfg.layers[i].type : null;
    }
    return (cfg && cfg[section] && cfg[section].type) || null;
  }
  /* adoptVisualizer'ın arkaplan karşılığı. Bir farkla: yığın kapalıyken
     yalnız klasik alan yazılır, yığın açılmaz. */
  function adoptBackground(cfg, spec) {
    if (!cfg) return null;
    const s = spec || {};
    const type = s.type ? String(s.type) : ((cfg.background && cfg.background.type) || 'gradient');
    const hasPreset = Object.prototype.hasOwnProperty.call(s, 'presetId');
    const presetId = hasPreset ? s.presetId : (cfg.custom && cfg.custom.backgroundId) || null;
    cfg.background = Object.assign({}, cfg.background, { type: type });
    if (type === 'custom') {
      cfg.custom = Object.assign({}, cfg.custom);
      if (presetId) cfg.custom.backgroundId = presetId;
    }
    if (!stackOn(cfg)) return null;
    if (!Array.isArray(cfg.layers)) cfg.layers = [];
    const i = firstLayerIndex(cfg, 'background');
    let layer = i >= 0 ? cfg.layers[i] : null;
    if (!layer) {
      layer = normalizeLayer({
        name: 'Arkaplan',
        kind: 'background',
        type: type,
        presetId: type === 'custom' ? (presetId || null) : null,
        enabled: true,
        settings: s.background ? { background: JSON.parse(JSON.stringify(s.background)) } : {},
      });
      cfg.layers.unshift(layer); // arkaplan en altta
      return layer;
    }
    layer.type = type;
    if (type === 'custom') layer.presetId = presetId || layer.presetId || null;
    else if (hasPreset) layer.presetId = presetId;
    layer.enabled = true;
    layer.muted = false;
    if (s.background) {
      layer.settings = layer.settings || {};
      const prev = layer.settings.background || {};
      layer.settings.background = Object.assign({}, prev, JSON.parse(JSON.stringify(s.background)), { type: type });
    } else if (layer.settings && layer.settings.background) {
      layer.settings.background.type = type;
    }
    return layer;
  }
  function syncStackState(cfg) {
    if (!cfg || !cfg.layerStack || !cfg.layerStack.enabled) return;
    const curVis = cfg.visualizer && cfg.visualizer.type;
    const curLogo = !!(cfg.logo && cfg.logo.enabled);
    const curImgs = !!(cfg.images && cfg.images.enabled);
    const curMedia = !!(cfg.media && cfg.media.enabled);
    const curText = !!(cfg.text && cfg.text.enabled);

    const hasActive = (curVis && curVis !== 'none') || curLogo || curImgs || curMedia || curText;
    if (!hasActive) return;
    /* Classic roots briefly became active while the stack is on (template
       apply, import). Refresh the snapshot from those roots, then clear
       them again so the stack remains the only driver. */
    cfg.layerStack.classicBackup = snapshotClassic(cfg);
    clearClassicOverlays(cfg);
  }

  // Etkin katman listesi: kullanıcı tanımlıysa o, değilse sentez
  function resolve(cfg) {
    const list = stackOn(cfg) && cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    const used = list.length ? list.map(normalizeLayer) : synthesize(cfg);
    /* Solo varsa yalnızca solo katmanlar çizilir. Bir kompozitörde solo,
       "diğerlerini kapat" demenin geri alınabilir yoludur; katmanları tek tek
       kapatıp sonra geri açmak zorunda kalmamak için var. */
    const soloed = used.filter((l) => l.solo);
    const visible = soloed.length ? soloed : used;
    return visible.filter((l) => l.enabled !== false && !l.muted);
  }

  /* Grup çarpanı: katman opaklığı, ait olduğu grubun fader'ıyla çarpılır.
     Gruplar yapılandırmada cfg.layerGroups altında adla saklanır. */
  function groupGain(cfg, layer) {
    if (!layer || !layer.group) return 1;
    let gain = 1;
    const groups = (cfg && cfg.layerGroups) || {};
    const g = groups[layer.group];
    if (g) {
      if (g.muted) return 0;
      gain = g.opacity == null ? 1 : Math.max(0, Math.min(1, g.opacity));
    }
    /* A/B çapraz geçiş.

       "A" ve "B" adlı gruplar özel: aralarındaki fader klasik VJ
       çapraz geçişidir. Eşit güç eğrisi kullanılıyor — doğrusal karışımda
       ortada toplam parlaklık düşer ve geçişin ortasında görüntü sönük
       görünür; kök-kosinüs çifti bunu önler. */
    const x = cfg && cfg.crossfade;
    if (x && x.enabled !== false && (layer.group === 'A' || layer.group === 'B')) {
      const v = Math.max(0, Math.min(1, x.value == null ? 0.5 : x.value));
      gain *= layer.group === 'A' ? Math.cos(v * Math.PI / 2) : Math.sin(v * Math.PI / 2);
    }
    return gain;
  }

  /* Katmanın gördüğü yapılandırma: genel ayarların üstüne katmanın kendi
     geçersiz kılmaları biner. Böylece iki "bars" katmanı farklı renk ve bar
     sayısıyla aynı sahnede durabilir.

     HER KAREDE, HER KATMAN İÇİN ÇAĞRILIYOR (#621). Burada eskiden
     `deepMerge(cfg, over)` vardı ve katmanın dokunmadığı her bölümü de
     JSON üzerinden kopyalıyordu: kayıtlı sahneler, MilkDrop kütüphanesinin
     puan/etiket kayıtları, Studio presetleri. Ölçüldü: 842 KB'lık gerçek bir
     ayar dosyasında görselleştirici penceresinin CPU süresinin %87'si bu
     kopyaydı ve pencere 74 Hz ekranda 33 fps çiziyordu. Sahne kaydettikçe,
     kütüphane büyüdükçe her kare pahalılaşıyordu — "zamanla kasıyor"
     şikâyetinin kaynağı. Klasik (katmansız) yol da ödüyordu: sentezlenen
     arkaplan ve görselleştirici katmanlarının ayarı var.

     Artık yalnız katmanın ezdiği bölümler birleştiriliyor; geri kalanı
     `cfg`nin kendisiyle paylaşılıyor. Değerler aynı (bkz.
     tests/layers-config-cost.test.js); ayarı olmayan katman zaten `cfg`nin
     kendisini görüyordu. */
  function overlay(cfg, over) {
    const out = Object.assign({}, cfg);
    for (const k of Object.keys(over)) {
      out[k] = window.SV.deepMerge(cfg ? cfg[k] : undefined, over[k]);
    }
    return out;
  }

  /* Varsayılanlar yalnız eksik bölüm için yedek olarak okunuyor; her
     çağrıda bütün varsayılan yapılandırmayı kopyalamaya gerek yok. */
  let DEF_CACHE = null;
  function defaultsOnce() {
    if (!DEF_CACHE && window.SV && window.SV.defaultConfig) DEF_CACHE = window.SV.defaultConfig();
    return DEF_CACHE;
  }

  function layerConfig(cfg, layer) {
    const over = layer.settings;
    const hasOverrides = over && Object.keys(over).length;
    const base = hasOverrides ? overlay(cfg, over) : cfg;
    const def = defaultsOnce();

    if (layer.kind === 'background') {
      const defBg = def ? def.background : {};
      const baseBg = (cfg && cfg.background) || defBg;
      const bgSettings = (layer.settings && layer.settings.background) || {};
      const mergedBg = window.SV.deepMerge(baseBg, bgSettings);
      /* Canlı tema paleti aşağıda, kip tema iken katmanın eski gradyanını ezer.
         Rengin kipi ve düz renk katmanın kendisindeyse orada kalır; sahne
         değeri yalnız katman seçmemişse devralınır. */
      if (cfg && cfg.background) {
        if (bgSettings.colorMode == null && cfg.background.colorMode != null) mergedBg.colorMode = cfg.background.colorMode;
        if (bgSettings.solidColor == null && cfg.background.solidColor != null) mergedBg.solidColor = cfg.background.solidColor;
      }
      if (mergedBg.gradient) {
        const mode = mergedBg.colorMode || 'theme';
        if (mode === 'theme') {
          const live = (cfg && cfg.background && cfg.background.gradient && cfg.background.gradient.colors)
            || (baseBg.gradient && baseBg.gradient.colors);
          if (live && live.length) mergedBg.gradient.colors = live.slice();
        } else if (window.SV && typeof window.SV.resolveBackgroundColors === 'function') {
          mergedBg.gradient.colors = window.SV.resolveBackgroundColors({ background: mergedBg });
        } else {
          const paletteColors = (cfg && cfg.background && cfg.background.gradient && cfg.background.gradient.colors)
            || (baseBg.gradient && baseBg.gradient.colors);
          mergedBg.gradient.colors = (bgSettings.gradient && bgSettings.gradient.colors) || paletteColors;
        }
      }
      mergedBg.type = layer.type || (cfg && cfg.background && cfg.background.type) || 'solid';
      return Object.assign({}, base, {
        background: mergedBg,
        custom: Object.assign({}, base.custom, { backgroundId: layer.presetId || (base.custom && base.custom.backgroundId) }),
      });
    }

    if (layer.kind === 'nowplaying') {
      const npSettings = (layer.settings && layer.settings.nowplaying) || {};
      const defNp = (cfg && cfg.nowplaying) || (def ? def.nowplaying : {});
      const baseVis = (cfg && cfg.visualizer) || (def ? def.visualizer : {}) || {};
      const visSettings = (layer.settings && layer.settings.visualizer) || {};
      const vis = Object.assign({}, baseVis, { type: 'nowplaying' });
      if (visSettings.glow != null) vis.glow = visSettings.glow;
      if (visSettings.colorMode != null) vis.colorMode = visSettings.colorMode;
      else if (npSettings.colorMode != null) vis.colorMode = npSettings.colorMode;
      if (visSettings.rainbow != null) vis.rainbow = visSettings.rainbow;
      else if (npSettings.colorMode != null) vis.rainbow = npSettings.colorMode === 'rainbow';
      return Object.assign({}, base, {
        visualizer: vis,
        nowplaying: Object.assign({}, defNp, base.nowplaying, npSettings, { enabled: layer.enabled !== false }),
      });
    }

    if (layer.kind === 'visualizer') {
      const defVis = def ? def.visualizer : {};
      const baseVis = (cfg && cfg.visualizer) || defVis;
      const visSettings = (layer.settings && layer.settings.visualizer) || {};
      const mergedVis = window.SV.deepMerge(baseVis, visSettings);
      mergedVis.type = layer.type || (cfg && cfg.visualizer && cfg.visualizer.type) || 'bars';
      const res = Object.assign({}, base, {
        visualizer: mergedVis,
        custom: Object.assign({}, base.custom, { visualizerId: layer.presetId || (base.custom && base.custom.visualizerId) }),
      });
      if (layer.type === 'text') {
        const textSettings = (layer.settings && layer.settings.text) || {};
        const defText = (cfg && cfg.text) || (def ? def.text : {});
        res.text = Object.assign({}, defText, base.text, textSettings, { enabled: layer.enabled !== false });
        if (textSettings.colorMode) {
          mergedVis.colorMode = textSettings.colorMode;
          mergedVis.rainbow = textSettings.colorMode === 'rainbow';
        }
      }
      if (layer.type === 'nowplaying') {
        const npSettings = (layer.settings && layer.settings.nowplaying) || {};
        const defNp = (cfg && cfg.nowplaying) || (def ? def.nowplaying : {});
        res.nowplaying = Object.assign({}, defNp, base.nowplaying, npSettings, { enabled: layer.enabled !== false });
        if (visSettings.colorMode == null && npSettings.colorMode) {
          mergedVis.colorMode = npSettings.colorMode;
          mergedVis.rainbow = npSettings.colorMode === 'rainbow';
        }
      }
      return res;
    }

    if (layer.kind === 'media') {
      const defMedia = (cfg && cfg.media) || (def ? def.media : {});
      const mediaSettings = (layer.settings && layer.settings.media) || {};
      return Object.assign({}, base, {
        media: Object.assign({}, defMedia, base.media, mediaSettings, { enabled: layer.enabled !== false }),
      });
    }

    return base;
  }

  /* Sahne imzası.

     Geçiş her yapılandırma değişikliğinde değil, SAHNE değiştiğinde
     tetiklenmeli. Kullanıcı bir kaydırıcıyı sürüklerken geçiş başlatmak
     paneli kullanılmaz hale getirirdi. İmza yalnızca sahnenin kimliğini
     belirleyen alanlardan üretilir: mod ve arkaplan türü, Studio preset
     kimlikleri, katman listesinin yapısı, palet ve 3B formül. Kaydırıcılar
     imzayı değiştirmez. */
  function sceneSignature(cfg) {
    if (!cfg) return '';
    const v = cfg.visualizer || {};
    const b = cfg.background || {};
    const c = cfg.custom || {};
    const g = cfg.geometry || {};
    const layers = Array.isArray(cfg.layers)
      ? cfg.layers.map((l) => (l.kind || '') + '.' + (l.type || '') + '.' + (l.presetId || '') + '.' + (l.enabled !== false ? '1' : '0')).join(',')
      : '';
    const grad = ((b.gradient && b.gradient.colors) || []).join(',');
    const stackState = stackOn(cfg) ? 'stack' : 'classic';
    const black = (cfg.isBlackout === true || (cfg.isBlackout !== false && (
      cfg.background &&
      (cfg.background.type === 'transparent' || (cfg.background.type === 'solid' && cfg.background.solidColor === '#000000')) &&
      cfg.visualizer && cfg.visualizer.type === 'none' &&
      (!cfg.layers || cfg.layers.every((l) => !l.enabled))
    ))) ? 'blackout' : '';
    return [v.type, b.type, c.visualizerId, c.backgroundId, g.family, g.formula, layers, grad, stackState, black].join('|');
  }

  function bandValue(audio, band) {
    if (!audio) return 0;
    if (band === 'mid') return audio.mid;
    if (band === 'treble') return audio.treble;
    if (band === 'level') return audio.level;
    return audio.bass;
  }

  /* Logo / Resim katmanı için etkin görsel kaynağını belirler.
     - 'manual': Yalnızca kullanıcının seçtiği resim (lg.src).
     - 'track': Yalnızca çalan şarkının resmi (varsa).
     - 'auto' (varsayılan): Şarkı sözü / çalan parça sistemi açıksa ve şarkı resmi varsa
       şarkı resmi kullanılır; şarkı çalmıyorsa, sistem kapalıysa veya şarkı resmi
       yoksa kullanıcının seçtiği logo/özel resim (lg.src) kullanılır. */
  function resolveLogoSrc(lg, cfg) {
    if (!lg) return null;
    const mode = lg.source || 'auto';
    /* macOS/Linux albüm kapağını okuyamaz. auto ve track orada özel resmi
       göstermeli; aksi halde çalan parça kapağı logonun yerine geçer. */
    const winOk = !(typeof window !== 'undefined' && window.SV_PLATFORM && window.SV_PLATFORM.isWindows === false);
    if (mode === 'manual' || !winOk) return logoFileSrc(lg);

    const live = (typeof window !== 'undefined' && window.SVNowLive && window.SVNowLive.state && window.SVNowLive.state.has)
      ? window.SVNowLive.state : null;

    let lyricsOrTextActive = false;
    let showArtworkAllowed = true;
    let trackArtwork = (live && live.artwork) || null;

    if (cfg) {
      if (cfg.text && cfg.text.enabled !== false && (cfg.text.source === 'now' || cfg.text.source === 'lyrics')) {
        lyricsOrTextActive = true;
        if (cfg.text.showArtwork === false) showArtworkAllowed = false;
        if (!trackArtwork && cfg.text.nowPlaying && cfg.text.nowPlaying.artwork) {
          trackArtwork = cfg.text.nowPlaying.artwork;
        }
      }
      if (cfg.visualizer && (cfg.visualizer.type === 'text' || cfg.visualizer.type === 'nowplaying')) {
        lyricsOrTextActive = true;
      }
      if (Array.isArray(cfg.layers)) {
        for (const l of cfg.layers) {
          if (!l || l.enabled === false) continue;
          if (l.type === 'text') {
            const t = (l.settings && l.settings.text) || cfg.text;
            if (t && t.enabled !== false && (t.source === 'now' || t.source === 'lyrics')) {
              lyricsOrTextActive = true;
              if (t.showArtwork === false) showArtworkAllowed = false;
              if (!trackArtwork && t.nowPlaying && t.nowPlaying.artwork) {
                trackArtwork = t.nowPlaying.artwork;
              }
            }
          } else if (l.type === 'nowplaying' || l.kind === 'nowplaying') {
            lyricsOrTextActive = true;
            const np = (l.settings && l.settings.nowplaying) || cfg.nowplaying;
            if (np && np.showArtwork === false) showArtworkAllowed = false;
          }
        }
      }
      if (!trackArtwork && cfg.nowplaying && cfg.nowplaying.enabled && cfg.nowplaying.manual && cfg.nowplaying.manual.artwork) {
        trackArtwork = cfg.nowplaying.manual.artwork;
      }
    }

    if (mode === 'track') {
      return showArtworkAllowed && trackArtwork ? trackArtwork : null;
    }
    // 'auto'
    if (lyricsOrTextActive && showArtworkAllowed && trackArtwork) {
      return trackArtwork;
    }
    return logoFileSrc(lg);
  }

  function logoFileSrc(lg) {
    if (typeof window !== 'undefined' && window.SVGif && window.SVGif.logoFileSrc) {
      return window.SVGif.logoFileSrc(lg);
    }
    if (!lg) return null;
    if (typeof window !== 'undefined' && window.SVLogoRuntime && window.SVLogoRuntime.displaySrc) {
      const ready = window.SVLogoRuntime.displaySrc(lg);
      if (ready) return ready;
      if (lg.libraryId) return null;
    }
    if (lg.src) return lg.src;
    if (lg.libraryId) return 'sv-logo://lib/' + encodeURIComponent(lg.libraryId);
    return null;
  }

  // ==========================================================================
  // Katman yığını
  // ==========================================================================
  class LayerStack {
    /* container: katman tuvallerinin ekleneceği öğe (canlı yol).
       Çevrimdışı kullanımda (dışa aktarıcı) container verilmez; tuvaller
       belgeye eklenmez, yalnızca drawTo() ile birleştirilir. */
    constructor(container, opts) {
      this.container = container || null;
      this.opts = opts || {};
      this.entries = []; // { layer, canvas, ctx, mode, key }
      /* K1 admin signal: true while any gradient entry is on the silent
         2D solid path after WebGL ctor failure. */
      this._gradientWebGLFallback = false;
      this.width = 2;
      this.height = 2;
      this.sprites = null; // paylaşılan sprite motoru
      this.media = null; // yığın kapalıyken tek medya (klasik kart)
      /* Yığın açıkken her kamera / dosya kendi oynatıcısı. Aynı kaynak
         iki katmana verilirse tek akış paylaşılır; farklı kameralar
         aynı anda açık kalır. */
      this._mediaPool = null;
      this._mediaByLayer = null;
      this._ownsMedia = false;
      this._mediaHold = null;
      this.logoEl = this.opts.logoEl || null;
      if (this.logoEl) this.logoEl.style.display = 'none';
      this._imageCache = {};
      this.signature = '';
      // Son-işlem zinciri (varsa sahne tek yüzeye birleştirilip GPU'ya verilir)
      this.postfx = null;
      this.compCanvas = null;
      this.compCtx = null;
      this._fxMode = false;
      this._surface = null;
      // Projeksiyon haritalaması açıkken sahne tek yüzeye inmeli: bükme
      // katman katman değil, birleştirilmiş görüntüye uygulanır
      this._mapping = false;
      this._forceSingle = false;
      // Sahne geçişi durumu (bkz. beginTransition)
      this.trans = null;
      this.lastSig = '';
      if (this.container) this.container.style.isolation = 'isolate';
    }

    _getImage(src) {
      if (!src) return null;
      if (this._imageCache[src]) return this._imageCache[src];
      const img = new Image();
      img.src = src;
      this._imageCache[src] = img;
      const keys = Object.keys(this._imageCache);
      if (keys.length > 30) delete this._imageCache[keys[0]];
      return img;
    }

    /* Efekt zincirini kur. Boş zincir = CSS kompozit yolu (en ucuz).
       Dolu zincir = tek yüzeye birleştirme + GPU geçişleri. */
    setPostFX(chain) {
      const list = Array.isArray(chain) ? chain.filter((f) => f && f.enabled !== false) : [];
      if (!list.length) {
        if (this.postfx) this.postfx.setChain([]);
        return;
      }
      if (!this.postfx && window.SVPostFX) this.postfx = new window.SVPostFX.PostFX();
      if (this.postfx) this.postfx.setChain(list);
    }

    _ensureComp() {
      if (this.compCanvas) return;
      this.compCanvas = document.createElement('canvas');
      this.compCtx = this.compCanvas.getContext('2d');
    }

    /* Görünür yüzeyi belirle.

       Normalde her katman kendi tuvaline çizer ve karıştırmayı tarayıcının
       kompozitörü yapar — en ucuz yol. İki durumda tek bir yüzeye inmek
       gerekiyor: efekt zinciri doluyken (GPU geçişleri tek dokuya uygulanır)
       ve sahne geçişi sürerken (iki sahne birleştirilir). İkisi de aynı
       mekanizmayı kullanır; ayrı kod yollarına gerek yok. */
    _setSurface(canvas) {
      const prev = this._surface;
      this._surface = canvas || null;
      this._fxMode = !!canvas;
      if (!this.container) return;
      /* Görünürlük her çağrıda senkron: setConfig yeni tuval eklediğinde
         _surface aynı kalsa bile katman tuvali + birleşik yüzey birlikte
         dururdu (çift çizim). */
      for (const e of this.entries) {
        if (e.canvas) e.canvas.style.display = canvas ? 'none' : 'block';
      }
      if (prev === canvas) return;
      if (prev && prev !== canvas && prev.parentNode) prev.parentNode.removeChild(prev);
      if (canvas) {
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.zIndex = '999';
        if (!canvas.parentNode) this.container.appendChild(canvas);
      }
      if (this.logoEl) {
        this.logoEl.style.display = 'none';
      }
    }

    _logoDrawable(lg, src, audio, t) {
      const animated = (typeof window !== 'undefined' && window.SVGif)
        ? window.SVGif.isAnimatedLogo(lg, src)
        : false;
      if (animated && typeof window !== 'undefined' && window.SVGifPlayer) {
        const entry = window.SVGifPlayer.get(src);
        if (entry && entry.status === 'ready' && entry.frames && entry.frames.length) {
          const av = bandValue(audio, (lg && lg.audioBand) || 'bass');
          const speed = lg && lg.speed > 0 ? lg.speed : 1;
          const mul = 1 + Math.min(1, (lg && lg.audioSpeed) || 0) * av * 1.5;
          const ms = (t || 0) * 1000 * speed * mul;
          const idx = window.SVGifPlayer.frameAt(entry, ms, (lg && lg.loop) || 'loop', !!(lg && lg.reverse));
          const bmp = entry.frames[idx];
          if (bmp) return { source: bmp, width: entry.width || bmp.width, height: entry.height || bmp.height };
        }
      }
      return null;
    }

    _paintLogo(ctx, drawable, lg, audio, W, H) {
      const minDim = Math.min(W, H);
      const av = bandValue(audio, (lg && lg.audioBand) || 'bass');
      const level = audio ? audio.level : 0;
      const scale = Math.max(0.02, Math.min(1.5, lg.scale == null ? 0.22 : lg.scale));
      const pulse = 1 + av * (lg.pulse == null ? 0.3 : lg.pulse);
      const size = minDim * scale * pulse;
      const aspect = (drawable.height || 1) / (drawable.width || 1);
      const w = size;
      const h = w * aspect;
      const x = (lg.x == null ? 0.5 : lg.x) * W;
      const y = (lg.y == null ? 0.5 : lg.y) * H;
      let opacity = Math.max(0, Math.min(1, lg.opacity == null ? 1 : lg.opacity));
      if (lg.audioOpacity > 0) {
        opacity *= (1 - lg.audioOpacity) + lg.audioOpacity * Math.min(1, level * 1.5);
      }
      const bright = (lg.brightness > 0 ? lg.brightness : 1)
        + Math.min(1, lg.audioBrightness || 0) * av * 0.8
        + Math.min(1, lg.beatFlash || 0) * Math.max(0, av - 0.6) * 2;
      const hue = (lg.hue || 0) + Math.min(1, lg.audioHue || 0) * av;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
      if (lg.blend === 'add') ctx.globalCompositeOperation = 'lighter';
      else if (lg.blend === 'screen') ctx.globalCompositeOperation = 'screen';
      ctx.imageSmoothingEnabled = lg.smooth !== false;
      const filters = [];
      if (bright !== 1) filters.push('brightness(' + bright.toFixed(3) + ')');
      if (hue) filters.push('hue-rotate(' + Math.round(hue * 360) + 'deg)');
      if (lg.saturate != null && lg.saturate !== 1) filters.push('saturate(' + lg.saturate + ')');
      if (filters.length) ctx.filter = filters.join(' ');
      const cr = Math.max(0, Math.min(0.5, lg.cornerRadius == null ? 0 : lg.cornerRadius));
      const rad = cr > 0.0001 ? cr * Math.min(w, h) : 0;
      const glowBlur = (lg.glow && lg.glow > 0) ? lg.glow * 40 * (minDim / 1080) : 0;
      /* Beyaz shadowBlur kareyi perde gibi kaldırır. Parlama, opak kenarın dışında lighter hale olarak basılır. */
      if (window.SVRoundImage && window.SVRoundImage.drawImage) {
        window.SVRoundImage.drawImage(ctx, drawable.source, x - w / 2, y - h / 2, w, h, {
          radiusPx: rad,
          glowBlur,
          glowAmount: lg.glow,
          edgeBloom: true,
          owner: this,
        });
      } else {
        /* SVRoundImage yoksa beyaz shadowBlur yine perde basar; parlamayı atla. */
        if (rad > 0) {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, rad);
          else ctx.rect(x - w / 2, y - h / 2, w, h);
          ctx.clip();
        }
        ctx.drawImage(drawable.source, x - w / 2, y - h / 2, w, h);
      }
      ctx.restore();
    }

    // Logo'yu birleştirme yüzeyine çizer (efekt modunda ve dışa aktarımda,
    // logonun da efektlerden geçmesi için)
    _drawLogoToCanvas(ctx, cfg, audio, t) {
      if (stackOn(cfg)) return;
      const l = cfg && cfg.logo;
      if (!l || !l.enabled) return;
      const effectiveSrc = resolveLogoSrc(l, cfg);
      if (!effectiveSrc) {
        this._lastLogoImg = null;
        this._lastLogoSrc = '';
        return;
      }
      const gif = this._logoDrawable(l, effectiveSrc, audio, t);
      if (gif) {
        this._paintLogo(ctx, gif, l, audio, this.width, this.height);
        return;
      }
      /* GIF_LIB_NO_IMG_FALLBACK */
      if (typeof window !== 'undefined' && window.SVGif && window.SVGif.isAnimatedLogo(l, effectiveSrc)) {
        return;
      }
      let img = (this.logoEl && this.logoEl.naturalWidth && this.logoEl.src === effectiveSrc)
        ? this.logoEl
        : this._getImage(effectiveSrc);
      if (!img || !img.naturalWidth) {
        if (this._lastLogoSrc === effectiveSrc && this._lastLogoImg && this._lastLogoImg.naturalWidth) {
          img = this._lastLogoImg;
        } else {
          return;
        }
      } else {
        this._lastLogoImg = img;
        this._lastLogoSrc = effectiveSrc;
      }
      this._paintLogo(ctx, { source: img, width: img.naturalWidth, height: img.naturalHeight }, l, audio, this.width, this.height);
    }

    setSprites(s) { this.sprites = s; }
    setMedia(m) { this.media = m; }

    /* Katmanın çizimde kullanacağı oynatıcı. Havuz yoksa klasik tekil
       örneğe düşer (yığın kapalıyken veya dışa aktarıcı havuzu kurmadıysa). */
    mediaOf(layer) {
      const id = layer && layer.id;
      const key = id && this._mediaByLayer && this._mediaByLayer.get(id);
      const inst = key && this._mediaPool && this._mediaPool.get(key);
      return inst || this.media;
    }

    /* Shader'ların tek sv_media girişi: alttan ilk açık medya katmanı.
       Katmanların kendi görüntüsü mediaOf ile ayrılır. */
    shaderVideo() {
      if (this._mediaByLayer && this._mediaByLayer.size && this._mediaPool) {
        const key = this._mediaByLayer.values().next().value;
        const inst = key && this._mediaPool.get(key);
        if (inst && inst.drawable) return inst.drawable();
        if (inst && inst.video) return inst.video;
      }
      if (this.media && this.media.drawable) return this.media.drawable();
      return this.media && this.media.video ? this.media.video : null;
    }

    /* Açık medya katmanlarının kaynaklarını havuza kurar. Yeni kamera
       eskisinin yerine yazılmaz; kullanılmayan akış kapanır. */
    syncMedia(cfg) {
      this._ownsMedia = true;
      if (!this._mediaPool) this._mediaPool = new Map();
      const byLayer = new Map();
      const wanted = new Map();
      if (stackOn(cfg) && cfg && Array.isArray(cfg.layers)) {
        const defMedia = cfg.media || {};
        cfg.layers.forEach((l, i) => {
          if (!l || l.kind !== 'media' || l.enabled === false) return;
          const mediaSettings = (l.settings && l.settings.media) || {};
          const m = Object.assign({}, defMedia, mediaSettings, { enabled: true });
          const key = mediaSourceKey(m);
          wanted.set(key, m);
          byLayer.set(l.id || ('media-' + i), key);
        });
      }
      for (const [key, m] of wanted) {
        let inst = this._mediaPool.get(key);
        if (!inst && typeof window !== 'undefined' && window.SVMedia) {
          inst = new window.SVMedia();
          this._mediaPool.set(key, inst);
        }
        if (inst) inst.apply(m);
      }
      this._mediaByLayer = byLayer;
      this._dropMedia(new Set(wanted.keys()));
      return this.shaderVideo();
    }

    _dropMedia(keep) {
      if (!this._mediaPool) return;
      for (const [key, inst] of [...this._mediaPool]) {
        if (keep.has(key)) continue;
        this._mediaPool.delete(key);
        this._retireMedia(inst);
      }
    }

    /* Geçişteki giden sahne aynı oynatıcıyı hâlâ çiziyor olabilir.
       Onu hemen kesmek eski kareyi kararır; geçiş bitince bırakılır. */
    _retireMedia(inst) {
      const outgoing = this.trans && this.trans.stack && this.trans.stack._mediaPool;
      if (outgoing) {
        for (const v of outgoing.values()) {
          if (v === inst) {
            if (!this._mediaHold) this._mediaHold = [];
            this._mediaHold.push(inst);
            return;
          }
        }
      }
      try { inst.dispose(); } catch { /* akış zaten kapalı */ }
    }

    _flushHeldMedia() {
      const hold = this._mediaHold || [];
      this._mediaHold = [];
      for (const inst of hold) {
        let live = false;
        if (this._mediaPool) {
          for (const v of this._mediaPool.values()) if (v === inst) live = true;
        }
        if (!live) {
          try { inst.dispose(); } catch { /* akış zaten kapalı */ }
        }
      }
    }

    // Katmanın kimliği: değişirse mod örneği yeniden kurulur
    _key(l) {
      return [l.id, l.kind, l.type, l.presetId || ''].join('|');
    }

    _makeCanvas() {
      const c = document.createElement('canvas');
      c.width = this.width;
      c.height = this.height;
      c.style.position = 'absolute';
      c.style.inset = '0';
      c.style.width = '100%';
      c.style.height = '100%';
      c.style.display = 'block';
      return c;
    }

    /* BAĞLAMI KAYBOLAN YÜZEY (#594).

       Sürücü sıfırlanınca ya da GPU süreci çökünce bütün WebGL bağlamları
       birden gidiyor. MilkDrop kendini geri kuruyor (#572); gradyan
       arkaplan, 3B geometri, shader modları ve efekt zincirleri kurmuyordu
       ve uygulama yeniden açılana kadar siyah kalıyordu. Bunların hiçbiri
       geri besleme ya da birikmiş durum taşımıyor: aynı ayarlarla yeni bir
       örnek kurmak yetiyor.

       Kaybolan bir bağlam kendiliğinden geri gelmiyor — bu yüzeyler olayı
       geri çevirmiyor — yani soru her karede aynı cevabı verir. Yeniden
       kurma yüzey başına iki saniyede bir: GPU süreci henüz kalkmadıysa
       yeni bağlam da hemen kaybolur ve her karede bir tuval açılırdı. */
    _lostNow(obj, key, holder) {
      if (!obj || typeof obj.contextLost !== 'function' || !obj.contextLost()) return false;
      const h = holder || this;
      const k = key || '_revivedAt';
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (h[k] && now - h[k] < REVIVE_MS) return false;
      h[k] = now;
      return true;
    }

    /* Katmanı YERİNDE yeniden kurar: yeni tuval eskisinin DOM'daki yerine
       ve onun satır içi stiliyle (z-sırası, karışım kipi, saydamlık) giriyor;
       giriş nesnesi aynı kalıyor, çünkü geçiş ve vekil kayıtları ona
       bağlı. */
    _revive(e, cfg) {
      const fresh = this._create(e.layer, e.key, cfg);
      const old = e.canvas;
      if (old && fresh.canvas) {
        if (old.parentNode) old.parentNode.insertBefore(fresh.canvas, old);
        fresh.canvas.style.cssText = old.style.cssText;
        fresh.canvas.className = old.className;
      }
      this._disposeEntry(e);
      for (const k of ['canvas', 'ctx', 'mode', 'gl', 'solid', 'webglFallback']) e[k] = fresh[k];
      this._syncGradientWebGLFallback();
      this._sizeEntry(e);
      this.revived = (this.revived || 0) + 1;
    }

    _disposeEntry(e) {
      // Vekilin tuvali canlı bir katmanın tuvali; ona dokunmak onu silerdi
      if (e.proxyOf) return;
      if (e.mode && e.mode.dispose) {
        try { e.mode.dispose(); } catch { /* motor zaten kapanmış */ }
      }
      if (e.canvas && e.canvas.parentNode) e.canvas.parentNode.removeChild(e.canvas);
      /* Tuvalin arka belleği çöp toplayıcıyı beklemeden bırakılıyor (#621):
         her sahne/Otomatik VJ değişimi katman başına tam ekran bir tuval
         atıyor (1080p'de 8 MB) ve tarayıcı onları ancak bir sonraki büyük
         toplamada geri alıyordu. Sıfır boyut belleği hemen bırakır. */
      if (e.canvas && typeof e.canvas.width === 'number') {
        try { e.canvas.width = 0; e.canvas.height = 0; } catch { /* kapanmış bağlam */ }
      }
    }

    /* Yapılandırmayı uygula. Yalnızca DEĞİŞEN katmanların mod örneği yeniden
       kurulur; sürükleme sırasında her karede WebGL bağlamı yeniden yaratmak
       hem pahalı hem de görsel olarak sıçramalı olurdu. */
    setConfig(cfg) {
      /* Sahne değiştiyse ve geçiş açıksa, mevcut katmanları giden yığına
         devret. Bu, aşağıdaki yeniden kurulumdan ÖNCE olmalı — sonrasında
         eski katmanlar çoktan atılmış olurdu. */
      const scnSig = sceneSignature(cfg);
      const T = window.SVTransition;
      const spec = cfg && cfg.transition;

      const isBlackoutNow = cfg.isBlackout === true || (cfg.isBlackout !== false && cfg &&
        (
          (cfg.background && cfg.background.type === 'solid' && cfg.background.solidColor === '#000000') ||
          (cfg.background && cfg.background.type === 'transparent')
        ) &&
        cfg.visualizer && cfg.visualizer.type === 'none' &&
        (!cfg.layers || cfg.layers.every((l) => !l.enabled)));

      const wasBlackout = !!(this.prevCfg && (
        this.prevCfg.isBlackout === true || (this.prevCfg.isBlackout !== false && (
          this.prevCfg.background && (
            (this.prevCfg.background.type === 'solid' && this.prevCfg.background.solidColor === '#000000') ||
            (this.prevCfg.background.type === 'transparent')
          ) &&
          this.prevCfg.visualizer && this.prevCfg.visualizer.type === 'none' &&
          (!this.prevCfg.layers || this.prevCfg.layers.every((l) => !l.enabled))
        ))
      ));

      const bothBlackout = isBlackoutNow && wasBlackout;
      const isBlackoutTrans = isBlackoutNow !== wasBlackout;
      const transType = isBlackoutTrans ? (spec && spec.blackoutType || 'crossfade') : (spec && spec.type || 'crossfade');
      const transDur = isBlackoutTrans
        ? (spec && spec.blackoutDuration != null ? spec.blackoutDuration : 0.4)
        : (T ? T.durationSeconds(cfg, this.bpm || (spec && spec.bpm || 0)) : 0.7);

      /* Karartmanın kendi animasyon türü ve süresi var; genel geçiş anahtarı
         kapalıyken de çalışmalı. Aksi halde “Karartma Animasyonu” ayarı
         sessizce yok sayılır ve panik düğmesi kesme yapar. */
      const transOn = isBlackoutTrans || (spec && spec.enabled !== false);
      /* Varış sahnesinin katmanları geçişten ÖNCE çözülüyor: hangi katmanın
         iki sahnede de durduğunu geçiş bilmek zorunda (beginTransition). */
      const wanted = resolve(cfg);
      const wantedKeys = new Set(wanted.map((l) => this._key(l)));
      if (T && spec && transOn && !bothBlackout && transType && transType !== 'cut' && transDur > 0 &&
          this.lastSig && scnSig !== this.lastSig && this.prevCfg) {
        this.beginTransition(this.prevCfg, {
          type: transType,
          duration: transDur,
          opts: isBlackoutTrans
            ? Object.assign({}, spec.params || {}, { isBlackout: true, blackoutDirection: isBlackoutNow ? 'out' : 'in' })
            : (spec.params || {}),
          ease: isBlackoutTrans ? 'smooth' : (spec.ease || 'smooth'),
        }, wantedKeys);
      }
      this.lastSig = scnSig;
      this.prevCfg = cfg;
      /* Kitaplık logolarını blob'a ısıt — sv-logo:// ile çizim donmasına yol açıyordu. */
      if (typeof window !== 'undefined' && window.SVLogoRuntime && window.SVLogoRuntime.warm) {
        const ids = new Set();
        if (cfg && cfg.logo && cfg.logo.libraryId) ids.add(cfg.logo.libraryId);
        (cfg && cfg.layers || []).forEach((l) => {
          const lg = l && l.settings && l.settings.logo;
          if (lg && lg.libraryId) ids.add(lg.libraryId);
        });
        ids.forEach((id) => window.SVLogoRuntime.warm(id));
      }

      const sig = wanted.map((l) => this._key(l)).join(';');
      const oldEntries = this.entries;
      const next = [];

      for (const layer of wanted) {
        const key = this._key(layer);
        const reuse = oldEntries.find((e) => e.key === key && !e.taken);
        if (reuse) {
          reuse.taken = true;
          reuse.layer = layer;
          next.push(reuse);
          continue;
        }
        next.push(this._create(layer, key, cfg));
      }

      for (const e of oldEntries) if (!e.taken) this._disposeEntry(e);
      for (const e of next) e.taken = false;
      this.entries = next;
      this.signature = sig;

      // z-sırası: liste sırası
      if (this.container) {
        this.entries.forEach((e, i) => {
          if (!e.canvas) return;
          e.canvas.style.zIndex = String(i + 1);
          if (this._fxMode) e.canvas.style.display = 'none';
          if (!e.canvas.parentNode) this.container.appendChild(e.canvas);
        });
        if (this.logoEl) {
          // Logo LayerStack tuvali tarafından çizilir; DOM öğesi gizli tutulur
          this.logoEl.style.display = 'none';
        }
      }
      this._applyStatic();
      this._syncGradientWebGLFallback();
    }

    /* Informational only: admin shows a non-blocking notice when the K1
       silent 2D solid path is active. Never throws / never dialogs. */
    _syncGradientWebGLFallback() {
      const active = this.entries.some((e) => !!(e && e.webglFallback));
      if (this._gradientWebGLFallback === active) return;
      this._gradientWebGLFallback = active;
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('sv-gradient-webgl-fallback', { detail: { active } }));
        }
      } catch { /* DOM-less / test host */ }
    }

    hasGradientWebGLFallback() {
      return !!this._gradientWebGLFallback;
    }

    _create(layer, key, cfg) {
      const e = { layer, key, canvas: null, ctx: null, mode: null };
      e.canvas = this._makeCanvas();
      /* Arkaplan tuvali işaretli: şeffaf arkaplanda koyu yerleri saydamlaşan
         yalnız o (visualizer.css, `.sv-bgkey`). */
      if (layer.kind === 'background') e.canvas.classList.add('sv-bg');
      if (this.container) this.container.appendChild(e.canvas);

      if (layer.kind === 'logo') {
        e.ctx = e.canvas.getContext('2d');
        this._sizeEntry(e);
        return e;
      }

      const lcfg = layerConfig(cfg, layer);
      if (layer.kind === 'background') {
        if (layer.type === 'gradient') {
          // WebGL gradyan kendi tuvalini surer. WebGL yoksa (blocklist)
          // kurucu firlatir: e.gl=true + e.ctx=null birakmamali — fillStyle
          // TypeError spam'i olur. 2D duz renk yedegine dus.
          try {
            e.mode = new window.SVModes.gradient(e.canvas);
            e.gl = true;
            e.webglFallback = false;
          } catch {
            e.mode = null;
            e.gl = false;
            e.ctx = e.canvas.getContext('2d');
            e.solid = true;
            /* Silent K1 path: solid 2D fill. Flag drives admin info notice. */
            e.webglFallback = true;
          }
        } else if (window.SVBackgrounds && window.SVBackgrounds[layer.type]) {
          e.mode = new window.SVBackgrounds[layer.type]();
          e.ctx = e.canvas.getContext('2d');
        } else {
          e.ctx = e.canvas.getContext('2d');
          e.solid = true; // 'solid' ya da bilinmeyen tür: düz renk
        }
      } else if (layer.kind === 'visualizer' || layer.kind === 'nowplaying') {
        const modeType = layer.kind === 'nowplaying' ? 'nowplaying' : layer.type;
        if (window.SVModes[modeType]) e.mode = new window.SVModes[modeType](e.canvas);
        e.ctx = e.canvas.getContext('2d');
      } else {
        e.ctx = e.canvas.getContext('2d');
      }
      this._sizeEntry(e);
      return e;
    }

    _sizeEntry(e) {
      if (!e.canvas) return;
      if (e.gl && e.mode && e.mode.resize) {
        e.canvas.style.width = '100%';
        e.canvas.style.height = '100%';
        e.mode.resize(this.width, this.height);
        return;
      }
      if (e.canvas.width !== this.width || e.canvas.height !== this.height) {
        e.canvas.width = this.width;
        e.canvas.height = this.height;
        if (e.mode && e.mode.resize) e.mode.resize();
      }
    }

    resize(w, h) {
      this.width = Math.max(2, w | 0);
      this.height = Math.max(2, h | 0);
      for (const e of this.entries) this._sizeEntry(e);
    }

    // Sese bağlı OLMAYAN stil (karışım modu) — yalnızca yapılandırma değişince
    _applyStatic() {
      if (!this.container) return;
      const cfg = this.prevCfg;
      for (const e of this.entries) {
        if (!e.canvas) continue;
        e.canvas.style.mixBlendMode = CSS_BLEND(e.layer.blend);
        if (e.layer.kind === 'background') {
          e.canvas.classList.toggle('sv-bgkey', !!(this.keyFilter && layerWantsKey(e.layer, cfg)));
        }
      }
    }

    // Katmanın o karedeki dönüşümü ve saydamlığı
    /* Çizim anındaki katman nesnesi.

       setConfig() sırasında yakalanan kopya durağandır; opaklık, karışım ve
       dönüşüm alanları modülasyon matrisi tarafından kare kare
       değiştirilebildiği için çizimde yapılandırmadaki taze nesne kullanılır.
       Kimlik önbelleği sayesinde değişmeyen katmanda normalleştirme tekrar
       çalışmaz. */
    _live(e, cfg) {
      if (!stackOn(cfg)) {
        if (e.layer && e.layer.id === 'ly_vis' && cfg && cfg.visualizer) {
          e.layer.settings = e.layer.settings || {};
          e.layer.settings.visualizer = cfg.visualizer;
          if (cfg.visualizer.type && cfg.visualizer.type !== 'none') {
            e.layer.type = cfg.visualizer.type;
          }
        } else if (e.layer && e.layer.id === 'ly_bg' && cfg && cfg.background) {
          e.layer.settings = e.layer.settings || {};
          e.layer.settings.background = cfg.background;
          if (cfg.background.type) {
            e.layer.type = cfg.background.type;
          }
        }
        return e.layer;
      }
      const list = cfg && Array.isArray(cfg.layers) ? cfg.layers : null;
      if (!list || !list.length) return e.layer;
      let src = null;
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === e.layer.id) { src = list[i]; break; }
      }
      if (!src) return e.layer;
      if (e._liveSrc === src && e._liveCache) {
        if (src.transform) Object.assign(e._liveCache.transform, src.transform);
        if (src.audio) Object.assign(e._liveCache.audio, src.audio);
        if (src.mask) Object.assign(e._liveCache.mask, src.mask);
        if (src.opacity !== undefined) e._liveCache.opacity = src.opacity;
        if (src.settings) e._liveCache.settings = src.settings;
        if (src.enabled !== undefined) e._liveCache.enabled = src.enabled;
        return e._liveCache;
      }
      e._liveSrc = src;
      e._liveCache = normalizeLayer(src);
      return e._liveCache;
    }

    _dynamics(layer, audio, cfg) {
      const t = layer.transform;
      const a = layer.audio;
      const band = bandValue(audio, a.band);
      /* Opaklık eğrisi: fader'ın hissini belirler. Doğrusal bir fader
         görsel olarak doğrusal davranmaz — algı yaklaşık karesel olduğu için
         üstel seçenek gerçek bir kısma hissi verir. */
      let base = Math.max(0, Math.min(1, layer.opacity));
      if (layer.opacityCurve === 'exp') base = base * base;
      else if (layer.opacityCurve === 'log') base = Math.sqrt(base);
      base *= groupGain(cfg, layer);
      const opacity = Math.max(0, Math.min(1, base * (1 + (a.opacity || 0) * (band * 2 - 1))));
      const scale = t.scale * (1 + (a.scale || 0) * band);
      const rotate = t.rotate + (a.rotate || 0) * band * 180;
      return { opacity, scale, rotate, x: t.x, y: t.y, flipX: t.flipX, flipY: t.flipY };
    }

    _hasTransform(d) {
      return d.scale !== 1 || d.rotate !== 0 || d.x !== 0 || d.y !== 0 || d.flipX || d.flipY;
    }

    /* ÖRTÜLEN KATMANLAR ÇİZİLMİYOR (#560, madde 8).

       Katmansız kipte MilkDrop seçilince arkaplan yine kuruluyor ve her
       karede çiziliyordu; MilkDrop tuvalin tamamını opak kapladığı için
       hiç görünmüyordu. Ölçüldü (1920x1080, kare hızı sınırsız): 2D aurora
       arkaplanı kare başına ~0,43 ms, WebGL gradyan gürültü düzeyinde; tuvali
       gizlemek birleştiricinin payını da alıyor.

       Bir katman altındakileri ancak hepsi doğruysa örtüyor: motoru son
       karesinin tuvali opak kapladığını söylüyor (`covers()`), karışımı
       normal, opaklığı tam, dönüşümü, maskesi ve katman efekti yok;
       görselleştiriciyse ses hazır — değilse tuvali bu karede temizleniyor.
       Döndürdüğü sıranın altındakiler atlanıyor; -1 hiçbiri.

       Işıklar arkaplandan renk örnekliyorsa (`palette()`, son 1,5 sn)
       arkaplan katmanları çizilmeye devam ediyor: örneklenen tuval donardı. */
    _coverFloor(audio, cfg) {
      for (let i = this.entries.length - 1; i > 0; i--) {
        const e = this.entries[i];
        if (e.proxyOf || !e.mode || typeof e.mode.covers !== 'function') continue;
        const l = this._live(e, cfg);
        if (l.enabled === false || (l.blend || 'normal') !== 'normal') continue;
        if (l.mask && l.mask.type && l.mask.type !== 'none') continue;
        if (Array.isArray(l.postfx) && l.postfx.some((f) => f && f.enabled !== false)) continue;
        if (l.kind === 'visualizer' && !(audio && audio.ready)) continue;
        const d = this._dynamics(l, audio, cfg);
        if (d.opacity < 1 || this._hasTransform(d)) continue;
        if (e.mode.covers()) return i;
      }
      return -1;
    }

    _covered(e, i, floor) {
      if (i >= floor) return false;
      return !(e.layer.kind === 'background' && this._paletteAt > 0 && performance.now() - this._paletteAt < 1500);
    }

    /* Şeffaf arkaplanda arkaplan katmanlarına uygulanacak süzgeç
       ('url(#sv-bg-key)') ya da null. Yalnız görselleştirici penceresi
       veriyor — süzgeç o sayfada tanımlı; önizleme ve dışa aktarıcı
       vermiyor, onlarda hiçbir şey değişmiyor. */
    setKeyFilter(f) {
      this.keyFilter = f || null;
    }

    // Haritalama aşaması tek yüzey ister; görselleştirici bunu bildirir
    setMapping(on) {
      this._mapping = !!on;
    }

    /* Kayıt da tek yüzey ister: MediaRecorder tek bir tuvalin akışını alır,
       katman katman CSS kompoziti yakalayamaz. */
    setForceSingle(on) {
      this._forceSingle = !!on;
    }

    // Görünür tek yüzey (haritalama aşaması bunu kaynak olarak kullanır)
    surface() {
      return this._surface || null;
    }

    /* Sahne geçişini başlat.

       Giden sahnenin donmuş bir fotoğrafı yerine, KATMANLARI olduğu gibi
       devralan ikinci bir yığın kuruyoruz: geçiş boyunca eski sahne de canlı
       kalıyor. Donmuş kare yarım saniyelik bir geçişte açıkça fark edilirdi.

       Devralınan tuvaller DOM'dan çıkarılır; giden yığın container'sız çalışıp
       yalnızca drawTo() ile çizer. */
    /* SÜREKLİ KATMANLAR GEÇİŞTE YENİDEN DOĞMUYOR.

       Geçiş eski sahnenin katmanlarını giden yığına devrediyor ve varış
       sahnesinin hepsini SIFIRDAN kuruyordu. Çoğu mod için fark etmez;
       MilkDrop için yıkım: o bir simülasyon — geri besleme izi, çalışan
       preset, otomatik geçiş sayacı. Yeniden kurulunca preset baştan
       başlıyor, iz siliniyor, otomatik geçiş elle seçilen presete geri
       dönüyordu. Dinamik renk teması her parça değişiminde paleti
       değiştiriyor ve palet sahne imzasında; yani dinamik tema açık bir
       kullanıcıda bu HER PARÇADA oluyordu — oysa MilkDrop o renkleri hiç
       okumuyor.

       Mod `keepAcrossTransitions` diyorsa ve katman varış sahnesinde de
       duruyorsa (`keep`), örnek varış yığınında KALIYOR. Giden yığına bir
       VEKİL gidiyor: modu yok, aynı tuvali gösteriyor. Varış yığını önce
       çiziliyor, yani vekil aynı karede yeni çizilmiş tuvali bileşime
       katıyor; iki bileşimde de aynı görüntü var ve katman kesintisiz
       akarken çevresindekiler geçiş yapıyor. Geçiş bitince vekil atılırken
       tuvale dokunulmuyor. Katman varış sahnesinde yoksa eskisi gibi giden
       yığına gidip sönüyor. */
    beginTransition(oldCfg, spec, keep) {
      if (this.trans) this.endTransition();
      const out = new LayerStack(null, this.opts);
      const kept = [];
      out.entries = (this.entries || []).map((e) => {
        if (keep && keep.has(e.key) && e.mode && e.mode.keepAcrossTransitions) {
          kept.push(e);
          return { layer: e.layer, key: e.key, canvas: e.canvas, ctx: e.ctx, mode: null, proxyOf: e };
        }
        return e;
      });
      out.width = this.width;
      out.height = this.height;
      out.sprites = this.sprites;
      out.media = this.media;
      out._ownsMedia = false;
      out._mediaPool = this._mediaPool ? new Map(this._mediaPool) : null;
      out._mediaByLayer = this._mediaByLayer ? new Map(this._mediaByLayer) : null;
      // Giden sahnenin arkaplanı da geçiş boyunca aynı süzgeçle saydamlaşsın
      out.keyFilter = this.keyFilter;
      for (const e of out.entries) {
        if (!e.proxyOf && e.canvas && e.canvas.parentNode) e.canvas.parentNode.removeChild(e.canvas);
      }
      this.entries = kept;
      this.trans = {
        stack: out,
        cfg: oldCfg,
        elapsed: 0,
        dur: Math.max(0.02, spec.duration),
        type: spec.type,
        opts: spec.opts || {},
        ease: spec.ease || 'smooth',
      };
    }

    endTransition() {
      if (!this.trans) return;
      const out = this.trans.stack;
      for (const e of out.entries) if (!e.proxyOf) out._disposeEntry(e);
      out.entries = [];
      this.trans = null;
      this._flushHeldMedia();
    }

    // Geçiş sürüyorsa bu karedeki ilerlemesini döndürür, yoksa null
    _tickTransition(dt) {
      const tr = this.trans;
      if (!tr) return null;
      tr.elapsed += Math.max(0, dt || 0);
      const raw = Math.min(1, tr.elapsed / tr.dur);
      if (raw >= 1) { this.endTransition(); return null; }
      const T = window.SVTransition;
      return { p: T ? T.easeOf(tr.ease)(raw) : raw, tr };
    }

    _ensureTrans() {
      if (!this.transOut) {
        this.transOut = document.createElement('canvas');
        this.transOutCtx = this.transOut.getContext('2d');
        this.transSurface = document.createElement('canvas');
        this.transCtx = this.transSurface.getContext('2d');
        this.compositor = new window.SVTransition.Compositor();
      }
      for (const c of [this.transOut, this.transSurface]) {
        if (c.width !== this.width || c.height !== this.height) {
          c.width = this.width;
          c.height = this.height;
        }
      }
    }

    draw(audio, cfg, t, dt) {
      const tick = this._tickTransition(dt);
      const isBlackout = cfg.isBlackout === true || (cfg.isBlackout !== false && cfg &&
        (
          (cfg.background && cfg.background.type === 'solid' && cfg.background.solidColor === '#000000') ||
          (cfg.background && cfg.background.type === 'transparent')
        ) &&
        cfg.visualizer && cfg.visualizer.type === 'none' &&
        (!cfg.layers || cfg.layers.every((l) => !l.enabled)));
      /* Efekt zinciri son görüntüyü çiziyor: bağlamı kaybolursa (#594) bütün
         sahne kararırdı. Aynı zincirle yeni bir örnek kuruluyor. */
      if (this.postfx && this._lostNow(this.postfx, '_fxRevivedAt')) {
        const chain = this.postfx.chain;
        try { this.postfx.dispose(); } catch { /* bağlam zaten gitti */ }
        this.postfx = new window.SVPostFX.PostFX();
        this.postfx.setChain(chain);
        this.revived = (this.revived || 0) + 1;
      }
      const fxOn = !!(this.postfx && this.postfx.hasWork());
      const single = fxOn || !!tick || this._mapping || this._forceSingle || isBlackout;

      if (single) {
        this._ensureComp();
        if (this.compCanvas.width !== this.width || this.compCanvas.height !== this.height) {
          this.compCanvas.width = this.width;
          this.compCanvas.height = this.height;
        }
        this.drawTo(this.compCtx, audio, cfg, t, dt, (ctx) => this._drawLogoToCanvas(ctx, cfg, audio, t));

        let src = this.compCanvas;
        if (tick) {
          const tr = tick.tr;
          this._ensureTrans();
          tr.stack.width = this.width;
          tr.stack.height = this.height;
          for (const e of tr.stack.entries) {
            if (e.canvas && (e.canvas.width !== this.width || e.canvas.height !== this.height)) {
              e.canvas.width = this.width;
              e.canvas.height = this.height;
              if (e.mode && e.mode.resize) e.mode.resize();
            }
          }
          tr.stack.drawTo(this.transOutCtx, audio, tr.cfg, t, dt,
            (ctx) => tr.stack._drawLogoToCanvas(ctx, tr.cfg, audio, t));
          this.compositor.compose(this.transCtx, this.transOut, this.compCanvas,
            this.width, this.height, tr.type, tick.p, tr.opts);
          src = this.transSurface;
        }

        if (fxOn) {
          this.postfx.resize(this.width, this.height);
          this.postfx.render(src, audio, t, dt, seeThrough(cfg));
          this._setSurface(this.postfx.canvas);
        } else if (tick) {
          this._setSurface(this.transSurface);
        } else {
          // Yalnızca haritalama ya da kayıt için tek yüzeye indik
          this._setSurface(this.compCanvas);
        }
        return;
      }

      this._setSurface(null);
      if (this.logoEl) this.logoEl.style.display = 'none';

      const floor = this._coverFloor(audio, cfg);
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        /* Örtülen tuval gizleniyor da: birleştirici onu da her karede
           harmanlıyordu. Açılınca aynı karede yeniden çiziliyor. */
        const hide = this._covered(e, i, floor);
        if (e.canvas && e.canvas.style && !!e._coverHidden !== hide) {
          e.canvas.style.visibility = hide ? 'hidden' : '';
          e._coverHidden = hide;
        }
        if (hide) continue;
        const l = this._live(e, cfg);
        this._drawEntry(e, audio, cfg, t, dt, l);

        if (this.container && e.canvas) {
          const d = this._dynamics(l, audio, cfg);
          e.canvas.style.opacity = d.opacity === 1 ? '' : d.opacity.toFixed(3);
          e.canvas.style.transform = this._hasTransform(d)
            ? `translate(${d.x * 100}%, ${d.y * 100}%) rotate(${d.rotate}deg) scale(${d.flipX ? -d.scale : d.scale}, ${d.flipY ? -d.scale : d.scale})`
            : '';
          if (l.kind === 'background') {
            e.canvas.classList.toggle('sv-bgkey', !!(this.keyFilter && layerWantsKey(l, cfg)));
          }
        }
      }
    }

    /* Maskeyi katmanın kendi tuvaline uygular.

       Maskeleme kompozit aşamasında değil KATMANDA yapılıyor: böylece maske
       katmanın dönüşümüyle birlikte hareket etmiyor (ekranda sabit kalıyor)
       ve karışım modundan bağımsız çalışıyor. Alternatif, maskeyi kompozit
       sırasında uygulamak olurdu ama o zaman her katman için ayrı bir ara
       yüzey gerekirdi. */
    _applyMask(e, l) {
      const m = l.mask;
      if (!m || !m.type || m.type === 'none' || !e.ctx) return;
      const W = this.width;
      const H = this.height;
      const ctx = e.ctx;
      const feather = Math.max(0.001, m.feather == null ? 0.1 : m.feather);
      ctx.save();
      ctx.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
      const cx = (m.x == null ? 0.5 : m.x) * W;
      const cy = (m.y == null ? 0.5 : m.y) * H;
      const w = (m.w == null ? 0.6 : m.w) * W;
      const h = (m.h == null ? 0.6 : m.h) * H;

      if (m.type === 'rect') {
        const fx = feather * Math.min(w, h);
        const g = ctx.createLinearGradient(cx - w / 2, 0, cx - w / 2 + fx, 0);
        // Dikdörtgen maskede yumuşama dört kenardan gelir; en ucuz yol
        // kenarları ayrı ayrı silmek yerine gölge kullanmak
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = fx;
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - w / 2 + fx / 2, cy - h / 2 + fx / 2, Math.max(1, w - fx), Math.max(1, h - fx));
        ctx.shadowBlur = 0;
        void g;
      } else if (m.type === 'ellipse') {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
        g.addColorStop(Math.max(0, 1 - feather), 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, h / Math.max(1, w));
        ctx.translate(-cx, -cy);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(w, h) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (m.type === 'linear') {
        const a = (m.angle || 0) * Math.PI * 2;
        const dx = Math.cos(a) * W;
        const dy = Math.sin(a) * H;
        const g = ctx.createLinearGradient(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(Math.min(1, feather * 2), 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (m.type === 'radial') {
        const r = Math.max(w, h) / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(Math.max(0, 1 - feather), 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (m.type === 'layer' && m.from) {
        // Başka bir katmanın parlaklığı maske olur
        const src = this.entries.find((x) => x.layer.id === m.from);
        if (src && drawable(src.canvas)) ctx.drawImage(src.canvas, 0, 0, W, H);
      }
      ctx.restore();
    }

    /* Katmanı çizer, ardından maskesini ve varsa kendi efekt zincirini
       uygular.

       Çizim gövdesi ayrı bir metotta çünkü içinde birden çok erken `return`
       var; maskeyi her birinin sonrasına ayrı ayrı eklemek yerine sarmalamak
       hem kısa hem de yeni bir katman türü eklendiğinde unutulamaz. */
    _drawEntry(e, audio, cfg, t, dt, live) {
      /* Vekil çizilmiyor: tuvalini bu karede varış yığını zaten çizdi.
         Maske ve katman efekti de uygulanmıyor — uygulansaydı eski sahnenin
         efekti canlı tuvalin üstüne İKİNCİ kez binerdi. */
      if (e.proxyOf) return;
      const l = live || e.layer;
      if (e.mode && this._lostNow(e.mode, null, e)) this._revive(e, cfg);
      /* BİR KATMANIN HATASI KAREYİ DÜŞÜRMÜYOR. Çizimde atılan bir istisna
         döngüden çıkıyordu: üstteki katmanlar, efekt zinciri ve ışıklar o
         karede hiç çizilmiyor, her karede tekrarlandığı için de sahne
         donmuş ya da yarım görünüyordu (parçacıklar tema renginde tanımsız
         bir adla her karede patlıyordu). Hata tür başına bir kez yazılıyor;
         sessizce yutulsaydı bir sonraki böyle hata hiç görülmezdi. */
      try {
        this._drawEntryRaw(e, audio, cfg, t, dt, l);
      } catch (err) {
        const key = (l && l.kind) + ':' + (l && l.type);
        const seen = this._drawErrors || (this._drawErrors = new Set());
        if (!seen.has(key)) {
          seen.add(key);
          console.error('[layers] ' + key + ' çizilemedi:', err);
        }
        return;
      }
      this._applyMask(e, l);
      /* KATMAN EFEKTİ HEP SAYDAM KİPTE (#590). Katman alttakilerin ÜSTÜNE
         biniyor; efekt zinciri opak kipte her pikselin alfasını 1 yazıyor ve
         katmanın boş yerleri siyah bir örtüye dönüyordu — tek katmana
         verilen bir efekt, sahne şeffaf değilse, altındaki her şeyi
         kapatıyordu. Saydam kipte örtü katmanın kendi alfasından geliyor;
         parlama gibi yayılan efektin boş alana taşan ışığı da örtüye
         katılıyor. Genel zincir sahnenin son hâli olduğu için orada
         `seeThrough(cfg)` doğru soru; burada değil. */
      this._applyLayerFX(e, l, audio, t, dt, true);
    }

    /* Katmana özel efekt zinciri.

       Tek bir paylaşılan PostFX örneği sırayla kullanılıyor: katman başına
       ayrı bir WebGL bağlamı açmak, on katmanlı bir sahnede on bağlam demek
       olurdu ve tarayıcılar eşzamanlı bağlam sayısını sınırlıyor. */
    _applyLayerFX(e, l, audio, t, dt, see) {
      const chain = Array.isArray(l.postfx) ? l.postfx.filter((f) => f && f.enabled !== false) : [];
      if (!chain.length || !e.canvas || !window.SVPostFX) return;
      if (this.layerFx && this._lostNow(this.layerFx, '_layerFxRevivedAt')) {
        try { this.layerFx.dispose(); } catch { /* bağlam zaten gitti */ }
        this.layerFx = null;
        this.revived = (this.revived || 0) + 1;
      }
      if (!this.layerFx) this.layerFx = new window.SVPostFX.PostFX();
      const fx = this.layerFx;
      fx.setChain(chain);
      if (!fx.hasWork()) return;
      fx.resize(this.width, this.height);
      if (!fx.render(e.canvas, audio, t, dt, !!see)) return;
      const ctx = e.ctx || (e.canvas.getContext ? e.canvas.getContext('2d') : null);
      if (!ctx || !drawable(fx.canvas)) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.globalAlpha = 1;
      ctx.drawImage(fx.canvas, 0, 0, this.width, this.height);
      ctx.restore();
    }

    // Katmanı kendi tuvaline çizer (her iki yol da bunu kullanır)
    _drawEntryRaw(e, audio, cfg, t, dt, live) {
      const l = live || e.layer;
      const lcfg = layerConfig(cfg, l);
      const W = this.width;
      const H = this.height;

      if (l.kind === 'background') {
        if (e.gl && e.mode) { e.mode.draw(audio, lcfg, t); return; }
        if (e.mode) { e.mode.draw(e.ctx, audio, lcfg, t, W, H, dt); return; }
        /* WebGL fallback / solid: ctx yoksa fillStyle'a dokunma. */
        if (!e.ctx) return;
        /* Şeffaf arkaplanda düz renk BOYANMAZ; boyasaydık pencerenin
           şeffaflığı bir işe yaramaz, altındaki masaüstü görünmezdi. */
        if (lcfg.background && lcfg.background.transparent) {
          e.ctx.clearRect(0, 0, W, H);
          return;
        }
        // düz renk
        e.ctx.fillStyle = (lcfg.background && lcfg.background.solidColor) || '#000000';
        e.ctx.fillRect(0, 0, W, H);
        return;
      }

      if (l.kind === 'visualizer' || l.kind === 'nowplaying') {
        if (!e.mode) { if (e.ctx) e.ctx.clearRect(0, 0, W, H); return; }
        if (!audio) { if (e.ctx) e.ctx.clearRect(0, 0, W, H); return; }
        /* Ses karesi gelmeden de ciz: MilkDrop/Studio WebGL kurulumu ilk
           draw'da. audio.ready yalnizca ingestFrame'de true; aygitsiz ortamda
           clear+return GL'yi hic acmiyordu. AudioEngine sifir tamponlarla
           baslar; gercek kare gelince ayni yol canli sinyali surer. */
        e.mode.draw(audio, lcfg, t, dt);
        return;
      }

      if (l.kind === 'media') {
        e.ctx.clearRect(0, 0, W, H);
        const inst = this.mediaOf(l);
        if (inst) inst.draw(e.ctx, audio, lcfg, W, H, t);
        return;
      }

      if (l.kind === 'sprites') {
        e.ctx.clearRect(0, 0, W, H);
        if (l.enabled === false) return;
        if (!e.sprites && window.SVSprites) e.sprites = new window.SVSprites();
        const spr = e.sprites || this.sprites;
        if (spr && audio && audio.ready) {
          const sImgs = (l.settings && l.settings.images) || (cfg && cfg.images);
          const items = (sImgs && sImgs.items) || [];
          if (items.length) {
            const mapped = items.map((it) => Object.assign({}, it, { layer: l.type }));
            spr.setItems(mapped);
            spr.draw(e.ctx, audio, t, W, H, l.type);
          } else if (this.sprites && this.sprites.hasLayer(l.type)) {
            this.sprites.draw(e.ctx, audio, t, W, H, l.type);
          }
        }
        return;
      }

      if (l.kind === 'logo') {
        e.ctx.clearRect(0, 0, W, H);
        if (l.enabled === false) return;
        const lg = (l.settings && l.settings.logo) || (cfg && cfg.logo);
        if (!lg) return;
        if (l.settings && l.settings.logo && l.settings.logo.enabled === false) return;
        const effectiveSrc = resolveLogoSrc(lg, cfg);
        if (!effectiveSrc) {
          e._lastImg = null;
          e._lastImgSrc = '';
          return;
        }
        const gif = this._logoDrawable(lg, effectiveSrc, audio, t);
        if (gif) {
          this._paintLogo(e.ctx, gif, lg, audio, W, H);
          return;
        }
        if (typeof window !== 'undefined' && window.SVGif && window.SVGif.isAnimatedLogo(lg, effectiveSrc)) {
          return;
        }
        let img = (this.logoEl && this.logoEl.naturalWidth && this.logoEl.src === effectiveSrc)
          ? this.logoEl
          : this._getImage(effectiveSrc);
        if (!img || !img.naturalWidth) {
          if (e._lastImgSrc === effectiveSrc && e._lastImg && e._lastImg.naturalWidth) {
            img = e._lastImg;
          } else {
            return;
          }
        } else {
          e._lastImg = img;
          e._lastImgSrc = effectiveSrc;
        }
        this._paintLogo(e.ctx, { source: img, width: img.naturalWidth, height: img.naturalHeight }, lg, audio, W, H);
        return;
      }
    }

    /* Çevrimdışı birleştirme (dışa aktarıcı). Katmanlar tek bir hedef tuvale
       CSS ile aynı karışım adlarıyla basılır. */
    drawTo(ctx, audio, cfg, t, dt, drawLogo) {
      const W = this.width;
      const H = this.height;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      /* Çizilecek katman yoksa yüzey SAYDAM kalırdı. Karartma tam bunu
         üretir: bütün katmanlar kapanır, geçişin varış sahnesi saydam olur
         ve çapraz geçiş görünürde hiçbir şey yapmaz — süre dolunca sahne
         birden kararır. Kompozisyonun zemini siyahtır; saydam mod (yayın
         katmanı ya da şeffaf arkaplan) bunun tek istisnasıdır. */
      if (!this.entries.length && !seeThrough(cfg)) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();

      const floor = this._coverFloor(audio, cfg);
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        if (this._covered(e, i, floor)) continue;
        const l = this._live(e, cfg);
        this._drawEntry(e, audio, cfg, t, dt, l);
        if (!drawable(e.canvas)) continue;

        const d = this._dynamics(l, audio, cfg);
        ctx.save();
        ctx.globalCompositeOperation = CANVAS_BLEND(l.blend);
        ctx.globalAlpha = d.opacity;
        /* Tek yüzey yolunda (efekt zinciri, sahne geçişi) katman tuvalleri
           gizli, CSS süzgeci onlara ulaşmıyor: arkaplanın koyu yerleri burada,
           çizerken saydamlaşıyor — aynı süzgeç, aynı görüntü. */
        if (this.keyFilter && layerWantsKey(l, cfg)) ctx.filter = this.keyFilter;
        if (this._hasTransform(d)) {
          ctx.translate(W / 2 + d.x * W, H / 2 + d.y * H);
          ctx.rotate((d.rotate * Math.PI) / 180);
          ctx.scale(d.flipX ? -d.scale : d.scale, d.flipY ? -d.scale : d.scale);
          ctx.drawImage(e.canvas, -W / 2, -H / 2, W, H);
        } else {
          ctx.drawImage(e.canvas, 0, 0, W, H);
        }
        ctx.restore();
      }
    }

    /* Çevrimdışı birleştirme + sahne geçişi.

       Dışa aktarıcı bunu çağırır: drawTo() ham birleştirmeyi yapar, burada
       üstüne varsa geçiş biner. Geçiş ilerlemesi dt üzerinden hesaplandığı ve
       dışa aktarıcıda dt = 1/fps olduğu için sonuç kare kare belirlenimlidir. */
    composeTo(ctx, audio, cfg, t, dt, drawLogo) {
      const tick = this._tickTransition(dt);
      if (!tick) { this.drawTo(ctx, audio, cfg, t, dt, drawLogo); return; }
      const tr = tick.tr;
      this._ensureComp();
      if (this.compCanvas.width !== this.width || this.compCanvas.height !== this.height) {
        this.compCanvas.width = this.width;
        this.compCanvas.height = this.height;
      }
      this.drawTo(this.compCtx, audio, cfg, t, dt, drawLogo);
      this._ensureTrans();
      tr.stack.width = this.width;
      tr.stack.height = this.height;
      tr.stack.drawTo(this.transOutCtx, audio, tr.cfg, t, dt, drawLogo);
      this.compositor.compose(ctx, this.transOut, this.compCanvas,
        this.width, this.height, tr.type, tick.p, tr.opts);
    }

    // Shader tabanlı katmanlara medya görüntüsünü bağla (sv_media / iChannel3)
    bindMedia(videoEl) {
      for (const e of this.entries) {
        if (e.mode && e.mode.host && e.mode.host.setMedia) e.mode.host.setMedia(videoEl);
      }
    }

    // Dynamic Lighting arkaplan rengi ister: en alttaki arkaplan katmanı bildirir
    palette(cfg) {
      // Örneklenen arkaplan örtülse de çizilmeye devam etsin (_covered)
      this._paletteAt = performance.now();
      for (const e of this.entries) {
        if (e.layer.kind !== 'background') continue;
        if (e.gl && e.mode && typeof e.mode.sampleColors === 'function') return e.mode.sampleColors(48);
        if (e.mode && typeof e.mode.palette === 'function') return e.mode.palette(layerConfig(cfg, e.layer));
      }
      return [];
    }

    /* MilkDrop presetinin `monitor` değişkeni — YAZAR ARACI.

       Preset dili kare başına yazılabilen bir `monitor` değişkeni
       tanımlıyor ve tek işi bu: yazarın kendi denklemine koyduğu hata
       ayıklama probu. Render girdisi değil, yani okunmadığı sürece o
       satırlar ölü. Korpusta 4.489 preset (%43,4) yazıyor.

       Yığın üstünde duruyor çünkü değeri motor biliyor ama panel motora
       erişemiyor; `palette()` ile aynı desen. İlk MilkDrop katmanı
       kazanıyor: birden fazla varsa hangisinin izlendiği belirsiz kalırdı,
       ve pratikte yığında bir tane oluyor. */
    milkdropMonitor() {
      for (const e of this.entries) {
        if (e.mode && typeof e.mode.monitorValue === 'function') {
          const v = e.mode.monitorValue();
          if (v !== null) return v;
        }
      }
      return null;
    }

    /* O an çizilen MilkDrop preseti. Otomatik geçiş seçimini AYARA
       yazmıyor (bkz. milkdrop-cycle.js), yani panel yalnız yapılandırmaya
       bakarak ekranda ne olduğunu bilemez. `milkdropMonitor` ile aynı
       desen ve aynı ~30 Hz mesaja biniyor. null = yığında MilkDrop yok;
       `id: null` = MilkDrop var ama ayardaki preseti çiziyor. */
    milkdropPreset() {
      for (const e of this.entries) {
        if (e.mode && typeof e.mode.livePreset === 'function') return e.mode.livePreset();
      }
      return null;
    }

    /* O an çizilen MilkDrop görüntüsünün renkleri, soldan sağa (#589).
       Işıklar bunları arkaplan paleti yerine alıyor. Yığında MilkDrop yoksa
       boş dizi: çağıran arkaplanın renklerine düşüyor. */
    milkdropColors(n) {
      for (const e of this.entries) {
        if (e.mode && typeof e.mode.sampleColors === 'function') return e.mode.sampleColors(n);
      }
      return [];
    }

    /* Yüklenmekte olan dokular (#586). Yalnız dışa aktarıcı soruyor: bir
       sonraki kareyi çizmeden önce bekliyor, böylece dokunun hangi karede
       yerleştiği diskin hızına değil kare sırasına bağlı kalıyor. Geçişte
       giden sahnenin katmanları da sayılıyor. */
    _assetModes() {
      const out = [];
      const add = (list) => {
        for (const e of list || []) {
          if (e.mode && typeof e.mode.texturesPending === 'function') out.push(e.mode);
        }
      };
      add(this.entries);
      if (this.trans && this.trans.stack) add(this.trans.stack.entries);
      return out;
    }

    assetsPending() {
      let n = 0;
      for (const m of this._assetModes()) n += m.texturesPending();
      return n;
    }

    whenAssetsSettled() {
      return Promise.all(this._assetModes().map((m) => m.whenTexturesSettled()));
    }

    dispose() {
      for (const e of this.entries) this._disposeEntry(e);
      this.entries = [];
      if (this.postfx) { this.postfx.dispose(); this.postfx = null; }
      if (this._ownsMedia) {
        this._dropMedia(new Set());
        this._flushHeldMedia();
      }
    }
  }

  function isGradientWebGLFallback() {
    try {
      if (typeof window !== 'undefined' && window.SVPreview && typeof window.SVPreview.stack === 'function') {
        const st = window.SVPreview.stack();
        if (st && typeof st.hasGradientWebGLFallback === 'function') return !!st.hasGradientWebGLFallback();
      }
    } catch { /* preview not ready */ }
    return false;
  }

  const api = {
    LayerStack,
    isGradientWebGLFallback,
    BLEND_MODES,
    KINDS,
    normalizeLayer,
    makeTextLayer,
    makeNowPlayingLayer,
    newLayerId,
    synthesize,
    resolve,
    stackOn,
    setStackEnabled,
    adoptVisualizer,
    revealLayer,
    effectivePath,
    setEffective,
    currentType,
    firstLayerIndex,
    adoptBackground,
    syncStackState,
    layerConfig,
    sceneSignature,
    groupGain,
    LAYER_DEFAULTS,
    resolveLogoSrc,
    logoFileSrc,
    seeThrough,
    layerWantsKey,
    pageBackground,
    keyThreshold,
    keyMatrix,
  };
  /* Saf yardımcılar (katman çözümleme, sıra, grup kazancı) Node'da test
     edilebilsin diye ayrıca dışa aktarılıyor; LayerStack sınıfı tuval
     gerektirdiği için testlerde kullanılmaz. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLayers = api;
})();
