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

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

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
      const own = layer.settings && layer.settings.logo;
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
    return num(sectionOf(layer, cfg, false)[key], f.def);
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

  const api = {
    SAFE, KINDS, frameGuides, elementGuides, mergeGuides, snapBox,
    kindOf: kindOf2, stackOn, sectionOf, moveBy, getField, setField, fallbackBox, normBox,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLayout = api;
})();
