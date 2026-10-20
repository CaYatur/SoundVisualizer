/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* AÇILIŞ ANİMASYONU (#537). Videonun başında öğeler tek tek gelir: belirme,
   kayma, büyüme ya da perde; her öğenin kendi süresi ve gecikmesi var, hepsi
   aynı anda inmesin.

   Saf modül: DOM yok. Çizici (layers.js) katmanı birleştirirken buradan
   o karenin saydamlığını, kaymasını, ölçeğini ve kırpmasını alır; canlı
   çıktı ve dışa aktarım aynı yoldan geçer (#539).

   SAAT: öğenin ilk çizildiği an (katman o anda kuruldu ya da ayarı
   değişti). Dışa aktarımda bu ilk kare, yani t = 0 — belirlenimli. Canlıda
   sahne yüklenince ya da "Girişleri Oynat" ile (cfg.revealReplay sayacı)
   baştan oynar.

   Ayarın yeri: katman yığınında katmanın kendisi (`layer.reveal`);
   katmansız kipte sentezlenen katmanın geldiği bölüm (`cfg.text.reveal`
   gibi) — sentez her yapılandırmada yeniden kurulduğu için katmana yazılan
   kaybolurdu. */
(function () {
  const TYPES = ['none', 'fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'scale', 'wipe'];
  const EASES = ['out', 'smooth', 'linear', 'back'];
  const DEFAULTS = { type: 'none', duration: 0.6, delay: 0, ease: 'out', distance: 0.08 };

  // Katmansız kipte sentezlenen katmanların bölümleri (layers.js synthesize)
  const CLASSIC_SECTIONS = {
    ly_bg: 'background', ly_media: 'media', ly_spr_back: 'images', ly_spr_front: 'images',
    ly_vis: 'visualizer', ly_text: 'text', ly_logo: 'logo',
  };

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function normalize(spec) {
    const s = Object.assign({}, DEFAULTS, spec || {});
    if (TYPES.indexOf(s.type) < 0) s.type = 'none';
    if (EASES.indexOf(s.ease) < 0) s.ease = 'out';
    s.duration = clamp(num(s.duration, DEFAULTS.duration), 0, 10);
    s.delay = clamp(num(s.delay, 0), 0, 60);
    s.distance = clamp(num(s.distance, DEFAULTS.distance), 0, 0.5);
    return s;
  }

  function active(spec) {
    return !!(spec && spec.type && spec.type !== 'none' && TYPES.indexOf(spec.type) > 0);
  }

  /* Ayarı tutan nesne: katman yığınında katman, katmansız kipte bölüm.
     `stack` çağıranın stackOn sonucu (kural tek yerde kalsın). */
  function holderOf(layer, cfg, stack, create) {
    if (!layer) return null;
    if (stack) return layer;
    const sec = CLASSIC_SECTIONS[layer.id];
    if (!sec || !cfg) return null;
    if (!cfg[sec]) { if (!create) return null; cfg[sec] = {}; }
    return cfg[sec];
  }

  function specOf(layer, cfg, stack) {
    const h = holderOf(layer, cfg, stack, false);
    return h && active(h.reveal) ? h.reveal : null;
  }

  // Ayarın imzası: değişince animasyon baştan oynar (düzenlerken görülsün)
  function sig(spec) {
    const s = normalize(spec);
    return [s.type, s.duration, s.delay, s.ease, s.distance].join('|');
  }

  function ease(name, k) {
    if (name === 'linear') return k;
    if (name === 'smooth') return k * k * (3 - 2 * k);
    if (name === 'back') {
      // Hafif aşma (easeOutBack, c1 = 1.70158)
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
    }
    return 1 - Math.pow(1 - k, 3);
  }

  /* Bu karenin hâli. `elapsed` öğenin saatinden geçen saniye, `box` çizicinin
     bildirdiği normalize kutu (yoksa kare), `aspect` genişlik/yükseklik.
     Kayma mesafesi karenin yüksekliği cinsinden: yatay ve dikey kayma
     ekranda aynı boyda görünsün.

     Dönen: { alpha, dx, dy, scale, cx, cy, clip, done }. dx/dy karenin
     oranı; clip { x0, y0, x1, y1 } ya da null; done = animasyon bitti. */
  function frame(spec, elapsed, box, aspect) {
    const s = normalize(spec);
    const idle = { alpha: 1, dx: 0, dy: 0, scale: 1, cx: 0.5, cy: 0.5, clip: null, done: true };
    if (s.type === 'none') return idle;
    const local = num(elapsed, 0) - s.delay;
    const k = local <= 0 ? 0 : s.duration > 0 ? clamp(local / s.duration, 0, 1) : 1;
    if (k >= 1) return idle;
    const e = ease(s.ease, k);
    const a = aspect > 0 ? aspect : 16 / 9;
    const b = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: 1, h: 1 };
    const out = { alpha: clamp(e, 0, 1), dx: 0, dy: 0, scale: 1, cx: b.x + b.w / 2, cy: b.y + b.h / 2, clip: null, done: false };
    const rest = 1 - e;
    if (s.type === 'slideUp') out.dy = rest * s.distance;
    else if (s.type === 'slideDown') out.dy = -rest * s.distance;
    else if (s.type === 'slideLeft') out.dx = rest * s.distance / a;
    else if (s.type === 'slideRight') out.dx = -rest * s.distance / a;
    else if (s.type === 'scale') out.scale = 0.85 + 0.15 * e;
    else if (s.type === 'wipe') {
      // Soldan sağa: kutunun sol kenarından sağ kenarına; dışı da kırpılır
      out.alpha = k > 0 ? 1 : 0;
      out.clip = { x0: 0, y0: 0, x1: k > 0 ? clamp(b.x + b.w * clamp(e, 0, 1), 0, 1) : 0, y1: 1 };
    }
    return out;
  }

  /* SIRAYLA: öğelere sırayla artan gecikme (ilk 0). Animasyonu olmayan
     öğeye `type` verilir. Değişen tutucuları döndürür. */
  function stagger(items, step, type) {
    const st = clamp(num(step, 0.25), 0, 10);
    let i = 0;
    const out = [];
    (items || []).forEach((h) => {
      if (!h) return;
      const cur = h.reveal && active(h.reveal) ? h.reveal : Object.assign({}, DEFAULTS, { type: type || 'slideUp' });
      h.reveal = Object.assign({}, cur, { delay: Math.round(i * st * 1000) / 1000 });
      out.push(h);
      i++;
    });
    return out;
  }

  const api = { TYPES, EASES, DEFAULTS, CLASSIC_SECTIONS, normalize, active, holderOf, specOf, sig, ease, frame, stagger };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVReveal = api;
})();
