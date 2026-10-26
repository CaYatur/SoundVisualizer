/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YAYIN DÜZENİ (#534): güvenli alanlar, yakalama ve konumlanabilir öğeler.

   Saf modül: DOM yok. Editör (panel) ve testler kullanıyor.

   Öğenin KUTUSU çizicinin kendisinden gelir (mod `layoutBounds` bildirir):
   yazı genişliği yazı tipine, içeriğe, kapağa ve en büyük genişliğe bağlı;
   ayardan tahmin edilen bir kutu çizilene uymaz. Buradaki `fallbackBox`
   yalnız henüz çizilmemiş öğe için.

   Konum öğenin KENDİ parametrelerine yazılır (barlar barCenterX/baseline,
   kart ve metin x/y, logo x/y), katman dönüşümüne değil: bir konumun tek
   kaynağı olsun, mevcut denetimler aynı sayıyı göstersin ve canlı çıktı ile
   dışa aktarım aynı yoldan çizilsin (#539).

   Kutular çıktı karesine göre normalize: { x, y, w, h }, 0..1. */
(function () {
  /* GÜVENLİ ALANLAR. SMPTE ST 2046-1:2009 §5.1: Safe Action Area genişlik ve
     yüksekliğin %93'ü, Safe Title Area %90'ı, görüntüyle eş merkezli.
     EBU R 95 v1.1 madde 5: aksiyon güvenli alanı %3,5, grafik güvenli alanı
     %5 — üst, alt ve yanlarda. İkisi aynı çifti veriyor. Kenar payı olarak
     tutuluyor; her en-boy oranında karenin kendisine göre. */
  const SAFE = { action: 0.035, title: 0.05 };

  /* PLATFORM ARAYÜZ ALANLARI (#838). Dikey kısa video uygulamaları videonun
     üstüne kendi arayüzünü çiziyor: üstte sekme ve başlık çubuğu, sağda
     beğen/yorum/paylaş sütunu, altta açıklama, ses adı ve gezinme. Ortak,
     yayımlanmış bir standart yok ve yerleşim uygulama sürümüyle oynuyor;
     buradaki değerler büyük üç platformun arayüzlerinin birleşimi, bilerek
     geniş (1080×1920'de üst 230, alt 480, sağ 150, sol 60 piksel). Kare
     gönderiyi profil ızgarası 3:4 kırparak gösteriyor: ızgarada sol ve
     sağdan %12,5 görünmüyor. Yalnız kılavuz, çıktıya hiçbir şey girmiyor.
     Kutular arayüzün KAPLADIĞI bölgeler, kareye göre: { id, x, y, w, h }. */
  const PLATFORM_ZONES = {
    '9:16': [
      { id: 'top', x: 0, y: 0, w: 1, h: 0.12 },
      { id: 'bottom', x: 0, y: 0.75, w: 1, h: 0.25 },
      { id: 'right', x: 0.86, y: 0.12, w: 0.14, h: 0.63 },
      { id: 'left', x: 0, y: 0.12, w: 0.055, h: 0.63 },
    ],
    '1:1': [
      { id: 'grid-left', x: 0, y: 0, w: 0.125, h: 1 },
      { id: 'grid-right', x: 0.875, y: 0, w: 0.125, h: 1 },
    ],
  };
  function platformZones(aspectKey) {
    return (PLATFORM_ZONES[aspectKey] || []).map((z) => Object.assign({}, z));
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  /* null / undefined / boş metin "değer yok" demek: varsayılana düşer.
     Number(null) sonlu bir 0 verdiği için eskiden null alanlar (barSpan,
     barCenterX, barHeight, baseline) 0 sayılıyor, ilk sürüklemede barlar
     küçük bir simgeye çöküyordu. */
  function num(v, d) {
    if (v == null || v === '') return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  // Yakalama çizgileri: karenin kenarları ve merkezi, güvenli alan kenarları
  function frameGuides() {
    const v = [0, 0.5, 1, SAFE.action, 1 - SAFE.action, SAFE.title, 1 - SAFE.title];
    return {
      x: v.map((p) => ({ at: p, kind: kindOf(p) })),
      y: v.map((p) => ({ at: p, kind: kindOf(p) })),
    };
  }
  function kindOf(p) {
    if (p === 0 || p === 1) return 'edge';
    if (p === 0.5) return 'center';
    if (Math.abs(p - SAFE.action) < 1e-9 || Math.abs(p - (1 - SAFE.action)) < 1e-9) return 'action';
    return 'title';
  }

  /* Bir kutuyu yakalar. Kutunun sol/orta/sağ kenarı dikey çizgilere, üst/
     orta/alt kenarı yatay çizgilere bakar; eşik içindeki en yakın çizgi
     kazanır. Diğer öğelerin kenarları ve merkezleri de çizgi olarak verilir.
     tolX/tolY normalize (ekran pikseli / önizleme boyu). Dönen kutu
     kaydırılmış hâl ve hangi çizgilere oturduğu (kılavuz çizimi için). */
  function snapBox(box, guides, tolX, tolY) {
    const pick = (edges, lines, tol) => {
      let best = null;
      for (const e of edges) {
        for (const l of lines) {
          const d = l.at - e.at;
          if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l, edge: e.name };
        }
      }
      return best;
    };
    const ex = [{ name: 'start', at: box.x }, { name: 'center', at: box.x + box.w / 2 }, { name: 'end', at: box.x + box.w }];
    const ey = [{ name: 'start', at: box.y }, { name: 'center', at: box.y + box.h / 2 }, { name: 'end', at: box.y + box.h }];
    const sx = pick(ex, guides.x || [], tolX);
    const sy = pick(ey, guides.y || [], tolY);
    return {
      box: { x: box.x + (sx ? sx.d : 0), y: box.y + (sy ? sy.d : 0), w: box.w, h: box.h },
      x: sx ? sx.line : null,
      y: sy ? sy.line : null,
    };
  }

  // Diğer öğelerin kenar ve merkezleri yakalama çizgisi olur
  function elementGuides(boxes) {
    const x = [];
    const y = [];
    (boxes || []).forEach((b) => {
      if (!b) return;
      x.push({ at: b.x, kind: 'element' }, { at: b.x + b.w / 2, kind: 'element' }, { at: b.x + b.w, kind: 'element' });
      y.push({ at: b.y, kind: 'element' }, { at: b.y + b.h / 2, kind: 'element' }, { at: b.y + b.h, kind: 'element' });
    });
    return { x, y };
  }

  function mergeGuides(a, b) {
    return { x: (a.x || []).concat(b.x || []), y: (a.y || []).concat(b.y || []) };
  }

  /* KONUMLANABİLİR ÖĞELER. Her biri hangi ayar bölümünde, hangi
     parametrelerle durduğunu biliyor. `section` katmanın kendi ayarındaki
     bölüm (layer.settings[section]); katmansız kipte genel yapılandırmanın
     aynı bölümü. */
  const KINDS = {
    bars: {
      section: 'visualizer',
      // Barların yerleşim alanı: ses değişse de kutu sabit
      fields: [
        { key: 'barCenterX', label: 'Yatay Merkez', min: 0, max: 1, step: 0.005, def: 0.5 },
        { key: 'baseline', label: 'Taban Çizgisi', min: 0, max: 1, step: 0.005, def: 1 },
        { key: 'barSpan', label: 'Genişlik', min: 0.05, max: 1, step: 0.005, def: 1 },
        { key: 'barHeight', label: 'Yükseklik', min: 0.02, max: 1, step: 0.005, def: 0.92 },
      ],
      move(s, dx, dy) {
        s.barCenterX = round(clamp(num(s.barCenterX, 0.5) + dx, 0, 1));
        s.baseline = round(clamp(num(s.baseline, s.position === 'center' ? 0.5 : 1) + dy, 0, 1));
      },
      fallbackBox(s) {
        const span = clamp(num(s.barSpan, 1), 0, 1);
        const cx = clamp(num(s.barCenterX, 0.5), 0, 1);
        const center = s.position === 'center';
        const base = clamp(num(s.baseline, center ? 0.5 : 1), 0, 1);
        const h = clamp(num(s.barHeight, center ? 0.46 : s.position === 'full' ? 0.95 : 0.92), 0, 1);
        return center
          ? { x: cx - span / 2, y: base - h, w: span, h: h * 2 }
          : { x: cx - span / 2, y: base - h, w: span, h };
      },
    },
    nowplaying: {
      section: 'nowplaying',
      fields: [
        { key: 'x', label: 'Yatay', min: 0, max: 1, step: 0.005, def: 0.5 },
        { key: 'y', label: 'Dikey', min: 0, max: 1, step: 0.005, def: 0.86 },
        { key: 'size', label: 'Yazı Boyu', min: 0.01, max: 0.3, step: 0.001, def: 0.042 },
        { key: 'maxWidth', label: 'En Büyük Genişlik', min: 0.1, max: 1, step: 0.01, def: 0.8 },
      ],
      move(s, dx, dy) {
        s.x = round(clamp(num(s.x, 0.5) + dx, 0, 1));
        s.y = round(clamp(num(s.y, 0.86) + dy, 0, 1));
      },
      fallbackBox(s) {
        const w = clamp(num(s.maxWidth, 0.8), 0.1, 1);
        const h = num(s.size, 0.042) * 2;
        const x = num(s.x, 0.5);
        const left = s.align === 'left' ? x : s.align === 'right' ? x - w : x - w / 2;
        return { x: left, y: num(s.y, 0.86) - h / 2, w, h };
      },
    },
    text: {
      section: 'text',
      fields: [
        { key: 'x', label: 'Yatay', min: 0, max: 1, step: 0.005, def: 0.5 },
        { key: 'y', label: 'Dikey', min: 0, max: 1, step: 0.005, def: 0.5 },
        { key: 'size', label: 'Yazı Boyu', min: 0.01, max: 0.4, step: 0.001, def: 0.09 },
        { key: 'maxWidth', label: 'En Büyük Genişlik', min: 0.15, max: 1, step: 0.01, def: 0.9 },
      ],
      move(s, dx, dy) {
        const defX = s.align === 'left' ? 0.06 : s.align === 'right' ? 0.94 : 0.5;
        s.x = round(clamp(num(s.x, defX) + dx, 0, 1));
        s.y = round(clamp(num(s.y, 0.5) + dy, 0, 1));
      },
      fallbackBox(s) {
        const w = clamp(num(s.maxWidth, 0.9), 0.15, 1) * 0.5;
        const h = num(s.size, 0.09) * 1.2;
        const defX = s.align === 'left' ? 0.06 : s.align === 'right' ? 0.94 : 0.5;
        const x = num(s.x, defX);
        const left = s.align === 'left' ? x : s.align === 'right' ? x - w : x - w / 2;
        return { x: left, y: num(s.y, 0.5) - h / 2, w, h };
      },
    },
    logo: {
      section: 'logo',
      fields: [
        { key: 'x', label: 'Yatay', min: 0, max: 1, step: 0.005, def: 0.5 },
        { key: 'y', label: 'Dikey', min: 0, max: 1, step: 0.005, def: 0.5 },
        { key: 'scale', label: 'Boyut', min: 0.02, max: 1.5, step: 0.005, def: 0.22 },
      ],
      move(s, dx, dy) {
        s.x = round(clamp(num(s.x, 0.5) + dx, 0, 1));
        s.y = round(clamp(num(s.y, 0.5) + dy, 0, 1));
      },
      fallbackBox(s, aspect) {
        // Kısa kenara oranlı kare (görselin oranı bilinmiyorsa)
        const sc = clamp(num(s.scale, 0.22), 0.02, 1.5);
        const a = aspect || 16 / 9;
        const w = a >= 1 ? sc / a : sc;
        const h = a >= 1 ? sc : sc * a;
        return { x: num(s.x, 0.5) - w / 2, y: num(s.y, 0.5) - h / 2, w, h };
      },
    },
  };

  function round(v) { return Math.round(v * 10000) / 10000; }

  // layers.js stackOn ile aynı kural: anahtar yoksa katman listesi belirler
  function stackOn(cfg) {
    const s = cfg && cfg.layerStack;
    if (s && typeof s.enabled === 'boolean') return s.enabled;
    return !!(cfg && Array.isArray(cfg.layers) && cfg.layers.length);
  }

  // Açılış modülü (#537): tarayıcıda pencereden, testte modülden
  function reveal() {
    if (typeof window !== 'undefined' && window.SVReveal) return window.SVReveal;
    try { return typeof require === 'function' ? require('./reveal') : null; } catch (e) { return null; }
  }

  /* Öğenin açılış ayarı ve onu tutan nesne: katman yığınında katman,
     katmansız kipte bölüm (shared/reveal.js holderOf). */
  function revealOf(layer, cfg) {
    const R = reveal();
    return R ? R.normalize(R.specOf(layer, cfg, stackOn(cfg)) || { type: 'none' }) : null;
  }
  function revealHolder(layer, cfg) {
    const R = reveal();
    return R ? R.holderOf(layer, cfg, stackOn(cfg), true) : null;
  }

  // Katman hangi öğe türü (yoksa null: düzenlenemez)
  function kindOf2(layer) {
    if (!layer) return null;
    if (layer.kind === 'nowplaying') return 'nowplaying';
    if (layer.kind === 'logo') return 'logo';
    if (layer.kind === 'visualizer' && layer.type === 'bars') return 'bars';
    if (layer.kind === 'visualizer' && layer.type === 'text') return 'text';
    return null;
  }

  /* Öğenin ayar bölümü: katmanın kendi ayarı (katman yığını) ya da genel
     yapılandırma. Yazmak için gerekirse oluşturulur. */
  function sectionOf(layer, cfg, create) {
    const kind = kindOf2(layer);
    if (!kind) return null;
    const sec = KINDS[kind].section;
    /* Logo BİRLEŞTİRİLMİYOR: çizici katmanın logosu varsa yalnız onu,
       yoksa genel logoyu kullanıyor (layers.js `l.settings.logo || cfg.logo`).
       Katmana kısmi bir `{ x }` yazmak logonun kaynağını kaybettirirdi. */
    if (kind === 'logo') {
      /* Katmansız kipte katman sentezlenmiş: `settings.logo` genel logonun
         o anki KOPYASI, bir sonraki yapılandırmada yeniden kuruluyor. Yazılan
         kaybolurdu (sürüklenen logo geri zıplıyordu) — kaynak genel logo. */
      const own = stackOn(cfg) && layer.settings && layer.settings.logo;
      if (own) return own;
      if (!cfg.logo) { if (!create) return {}; cfg.logo = {}; }
      return cfg.logo;
    }
    const stack = stackOn(cfg);
    if (stack) {
      if (!layer.settings) { if (!create) return {}; layer.settings = {}; }
      if (!layer.settings[sec]) { if (!create) return Object.assign({}, cfg && cfg[sec]); layer.settings[sec] = {}; }
      return create ? layer.settings[sec] : Object.assign({}, cfg && cfg[sec], layer.settings[sec]);
    }
    if (!cfg[sec]) { if (!create) return {}; cfg[sec] = {}; }
    return cfg[sec];
  }

  // Öğeyi normalize (dx, dy) kadar taşır; değişen bölümü döndürür
  function moveBy(layer, cfg, dx, dy) {
    const kind = kindOf2(layer);
    if (!kind) return null;
    // Katman ayarı genel ayarın üstüne biniyor: okunan değer birleşik hâl
    const merged = sectionOf(layer, cfg, false);
    const target = sectionOf(layer, cfg, true);
    const tmp = Object.assign({}, merged);
    KINDS[kind].move(tmp, dx, dy);
    KINDS[kind].fields.forEach((f) => { if (tmp[f.key] !== merged[f.key]) target[f.key] = tmp[f.key]; });
    return target;
  }

  // Sayısal alanın değeri (birleşik) ve yazılması
  function getField(layer, cfg, key) {
    const kind = kindOf2(layer);
    const f = kind && KINDS[kind].fields.find((x) => x.key === key);
    if (!f) return null;
    const sec = sectionOf(layer, cfg, false);
    return num(sec[key], defaultOf(kind, f, sec));
  }

  /* Alanın etkin varsayılanı. Barlarda taban çizgisi ve yükseklik konuma
     (center / full) bağlı; bars.js ile aynı değerler, böylece editörün
     gösterdiği sayı çizicinin gerçekten kullandığıyla aynı olur. */
  function defaultOf(kind, f, sec) {
    if (kind === 'bars') {
      const center = sec && sec.position === 'center';
      if (f.key === 'baseline') return center ? 0.5 : 1;
      if (f.key === 'barHeight') return center ? 0.46 : sec && sec.position === 'full' ? 0.95 : 0.92;
    }
    return f.def;
  }
  function setField(layer, cfg, key, value) {
    const kind = kindOf2(layer);
    const f = kind && KINDS[kind].fields.find((x) => x.key === key);
    if (!f) return false;
    const v = Number(value);
    if (!Number.isFinite(v)) return false;
    sectionOf(layer, cfg, true)[key] = round(clamp(v, f.min, f.max));
    return true;
  }

  function fallbackBox(layer, cfg, aspect) {
    const kind = kindOf2(layer);
    if (!kind) return null;
    return KINDS[kind].fallbackBox(sectionOf(layer, cfg, false), aspect);
  }

  // Normalize kutu (piksel dikdörtgenden)
  function normBox(px, py, pw, ph, W, H) {
    if (!(W > 0) || !(H > 0) || !(pw > 0) || !(ph > 0)) return null;
    return { x: px / W, y: py / H, w: pw / W, h: ph / H };
  }

  /* DÜZEN DOSYASI (#538). Sahnedeki yerleştirilebilir öğeler sırayla:
     katman özellikleri ve öğenin kendi ayar bölümü (birleşik hâl, dosya
     kendi başına yetsin). KULLANICI İÇERİĞİ TAŞINMAZ: logo görseli ve
     kitaplık kimliği, elle girilen parça bilgisi, şarkı sözü gövdesi —
     dosya başka bir kurulumda açılacak ve oradaki logo kullanılacak. */
  const LAYOUT_TYPE = 'sv-layout';
  const LAYOUT_VERSION = 1;
  const LAYER_KEYS = ['name', 'blend', 'opacity', 'enabled', 'group'];
  const STRIP = {
    logo: ['source', 'src', 'libraryId', 'kind'],
    nowplaying: ['manual'],
    text: ['lyricsSource', 'lyricsName', 'nowPlaying'],
    bars: [],
  };
  const MAX_ELEMENTS = 32;
  // Nesne değişmezinde `__proto__: 1` anahtar değil prototip atar: küme şart
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  // Düz veri kopyası: işlev, döngü ve tehlikeli anahtar yok; derinlik sınırlı
  function plain(v, depth) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return Number.isNaN(v) ? null : v;
    if (typeof v === 'string') return v.length > 4000 ? v.slice(0, 4000) : v;
    if (depth > 5) return undefined;
    if (Array.isArray(v)) return v.slice(0, 256).map((x) => plain(x, depth + 1)).filter((x) => x !== undefined);
    if (typeof v === 'object') {
      const out = {};
      Object.keys(v).forEach((k) => {
        if (BAD_KEYS.has(k)) return;
        const c = plain(v[k], depth + 1);
        if (c !== undefined) out[k] = c;
      });
      return out;
    }
    return undefined;
  }

  function cleanParams(kind, params) {
    const out = plain(params || {}, 0) || {};
    (STRIP[kind] || []).forEach((k) => { delete out[k]; });
    // Katmansız kipte açılış ayarı bölümde duruyor; dosyada öğenin kendi alanı
    delete out.reveal;
    return out;
  }

  // Dışa aktarım: `layers` etkin katman listesi (katmansız kipte sentezlenen)
  function exportLayout(layers, cfg, meta) {
    const elements = [];
    (layers || []).forEach((l) => {
      const kind = kindOf2(l);
      if (!kind || elements.length >= MAX_ELEMENTS) return;
      const layer = {};
      LAYER_KEYS.forEach((k) => { if (l[k] !== undefined) layer[k] = plain(l[k], 0); });
      const el = { kind, layer, params: cleanParams(kind, sectionOf(l, cfg, false)) };
      // Açılış animasyonu görünüşün parçası (#537); yoksa 'none' (içe aktarım temizlesin)
      const R = reveal();
      if (R) {
        const spec = R.specOf(l, cfg, stackOn(cfg));
        el.reveal = spec ? R.normalize(spec) : { type: 'none' };
      }
      elements.push(el);
    });
    return Object.assign({ type: LAYOUT_TYPE, version: LAYOUT_VERSION }, meta && meta.aspect ? { aspect: String(meta.aspect) } : {}, { elements });
  }

  /* İçe aktarım. Her öğe aynı türdeki sıradaki mevcut katmanı günceller;
     yoksa `make(spec)` ile yeni katman eklenir. Sahnedeki diğer öğelere
     dokunulmaz. Katman yığını açık olmalı (çağıran açar). */
  function importLayout(cfg, data, make) {
    if (!data || data.type !== LAYOUT_TYPE) return { ok: false, error: 'not a layout file' };
    if (data.version !== LAYOUT_VERSION) return { ok: false, error: 'unsupported layout version ' + data.version };
    if (!Array.isArray(data.elements) || !data.elements.length) return { ok: false, error: 'no elements' };
    if (!Array.isArray(cfg.layers)) cfg.layers = [];
    const used = new Set();
    let updated = 0;
    let added = 0;
    let skipped = 0;
    data.elements.slice(0, MAX_ELEMENTS).forEach((el) => {
      const kind = el && el.kind;
      if (!kind || !Object.prototype.hasOwnProperty.call(KINDS, kind)) { skipped++; return; }
      const params = cleanParams(kind, el.params);
      const props = {};
      LAYER_KEYS.forEach((k) => { if (el.layer && el.layer[k] !== undefined) props[k] = plain(el.layer[k], 0); });
      let target = cfg.layers.find((l) => l && !used.has(l) && kindOf2(l) === kind);
      if (!target) {
        if (typeof make !== 'function') { skipped++; return; }
        const spec = kind === 'bars' ? { kind: 'visualizer', type: 'bars' }
          : kind === 'text' ? { kind: 'visualizer', type: 'text' }
          : kind === 'nowplaying' ? { kind: 'nowplaying', type: 'nowplaying' }
          : { kind: 'logo' };
        target = make(Object.assign(spec, { settings: {} }));
        if (!target) { skipped++; return; }
        cfg.layers.push(target);
        added++;
      } else {
        updated++;
      }
      used.add(target);
      Object.keys(props).forEach((k) => { target[k] = props[k]; });
      // Eski dosyada alan yok: hedefinki kalır
      const R = reveal();
      if (R && el.reveal && typeof el.reveal === 'object') {
        const spec = R.normalize(plain(el.reveal, 0));
        if (R.active(spec)) target.reveal = spec; else delete target.reveal;
      }
      if (kind === 'logo') {
        // Logo görseli yerinde kalır: konum ve görünüş onun nesnesine
        const own = target.settings && target.settings.logo;
        Object.assign(own || (cfg.logo || (cfg.logo = {})), params);
      } else {
        const sec = KINDS[kind].section;
        target.settings = target.settings || {};
        target.settings[sec] = Object.assign({}, target.settings[sec] || {}, params);
      }
    });
    return { ok: true, updated, added, skipped };
  }

  /* YAZI BİÇEMLERİ (#536). Ölçülü yayın görünümü: yazı tipi, kalınlık,
     kontur, gölge ve (kartta) büyük harf. RENGE DOKUNULMAZ — renk
     kullanıcının paletinden ya da kendi seçiminden gelir. Metin katmanı ve
     çalan parça kartı aynı biçemi kendi anahtarlarıyla alır. */
  const SYS = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const CONDENSED = 'Bahnschrift, "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';
  const STYLES = {
    clean: { name: 'Sade', text: { font: SYS, weight: 600, outline: 0, shadow: 0.3 }, nowplaying: { font: SYS, weight: 600, outline: 0, shadow: 0.35, uppercase: false, style: 'modern' } },
    lower: { name: 'Alt Bant', text: { font: CONDENSED, weight: 700, outline: 0, shadow: 0.2 }, nowplaying: { font: CONDENSED, weight: 700, outline: 0, shadow: 0.2, uppercase: true, style: 'modern' } },
    label: { name: 'Etiket', text: { font: SYS, weight: 800, outline: 0, shadow: 0 }, nowplaying: { font: SYS, weight: 800, outline: 0, shadow: 0, uppercase: false, style: 'modern' } },
    bold: { name: 'Kalın Ekran', text: { font: SYS, weight: 900, outline: 0.18, shadow: 0.45 }, nowplaying: { font: SYS, weight: 900, outline: 0.18, shadow: 0.45, uppercase: true, style: 'modern' } },
    thin: { name: 'İnce', text: { font: SYS, weight: 400, outline: 0, shadow: 0 }, nowplaying: { font: SYS, weight: 400, outline: 0, shadow: 0, uppercase: false, style: 'modern' } },
  };

  function applyStyle(layer, cfg, id) {
    const kind = kindOf2(layer);
    const st = STYLES[id];
    if (!st || !st[kind]) return false;
    Object.assign(sectionOf(layer, cfg, true), st[kind]);
    return true;
  }

  // Öğenin şu anki biçemi (hiçbiri tutmuyorsa null: kullanıcı değiştirmiş)
  function styleIdOf(layer, cfg) {
    const kind = kindOf2(layer);
    if (kind !== 'text' && kind !== 'nowplaying') return null;
    const cur = sectionOf(layer, cfg, false);
    const hit = Object.keys(STYLES).find((id) => {
      const want = STYLES[id][kind];
      return Object.keys(want).every((k) => cur[k] === want[k]);
    });
    return hit || null;
  }

  /* METİN KAYNAĞI (#536): sabit yazı ya da çalan parçanın başlığı,
     sanatçısı veya ikisi. Elle girilen parça bilgisi (nowPlaying) yedek
     olarak kalır: sistemden parça gelmezse o çizilir. */
  const TEXT_SOURCES = [
    ['static', '', 'Sabit Yazı'],
    ['now', 'title', 'Çalan Parça — Başlık'],
    ['now', 'artist', 'Çalan Parça — Sanatçı'],
    ['now', 'both', 'Çalan Parça — Başlık ve Sanatçı'],
  ];
  function textSourceOf(layer, cfg) {
    const s = sectionOf(layer, cfg, false);
    const src = s.source || 'static';
    if (src !== 'now') return src === 'static' ? 'static' : src;
    return 'now:' + (s.field || 'both');
  }
  function setTextSource(layer, cfg, value) {
    if (kindOf2(layer) !== 'text') return false;
    const [src, field] = String(value).split(':');
    const s = sectionOf(layer, cfg, true);
    if (src === 'static') { s.source = 'static'; return true; }
    if (src === 'now' && ['title', 'artist', 'both'].indexOf(field) >= 0) {
      s.source = 'now';
      s.field = field;
      if (!s.nowSource) s.nowSource = 'system';
      return true;
    }
    return false;
  }

  const api = {
    SAFE, PLATFORM_ZONES, platformZones, KINDS, frameGuides, elementGuides, mergeGuides, snapBox,
    kindOf: kindOf2, stackOn, sectionOf, moveBy, getField, setField, fallbackBox, normBox,
    LAYOUT_TYPE, LAYOUT_VERSION, exportLayout, importLayout,
    STYLES, applyStyle, styleIdOf, TEXT_SOURCES, textSourceOf, setTextSource,
    revealOf, revealHolder,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLayout = api;
})();
