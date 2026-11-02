/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
/* DÜŞÜK GÜÇ KİPİ (#458). Pildeki dizüstü ve gözetimsiz uzun koşular için kare
   hızını sınırlar, en pahalı geçişleri kapatır.

   Kayıtlı ayara dokunmuyor: yalnız çıkış penceresinin ve önizlemenin çizdiği
   kopya değişiyor, kip kapanınca her şey olduğu gibi dönüyor. Dışa aktarıcı ve
   web çıkışı bu dosyayı yüklemiyor: video ve OBS kaynağı aynı kalıyor.

   Değerler yalnız AŞAĞI çekiyor: kullanıcı daha düşük bir sınır seçtiyse o kalır.
   Efektler silinmiyor, kapatılıyor: modülasyon ve zaman çizelgesi onlara sırayla
   ulaşıyor (`postfx.0.params…`), dizi kısalsa yanlış efekte yazarlardı. */
(function () {
  const FPS = 30;
  const RENDER_SCALE = 0.75;
  const MD_MAX_SIZE = 1280;
  const MD_MESH = 32;

  const below = (value, limit) => (Number(value) > 0 ? Math.min(Number(value), limit) : limit);
  const effectsOff = (list) => (Array.isArray(list) ? list.map((f) => Object.assign({}, f, { enabled: false })) : list);

  function active(cfg, onBattery) {
    const mode = cfg && cfg.power && cfg.power.lowPower;
    return mode === 'on' || (mode === 'battery' && onBattery === true);
  }

  // Kapalıyken aynı nesne döner: varsayılan kurulumda hiçbir şey değişmesin
  function apply(cfg, onBattery) {
    if (!active(cfg, onBattery)) return cfg;
    const out = Object.assign({}, cfg);
    out.power = Object.assign({}, cfg.power, {
      fpsCap: below(cfg.power.fpsCap, FPS),
      renderScale: below(cfg.power.renderScale, RENDER_SCALE),
      previewRate: 'low',
    });
    out.postfx = effectsOff(cfg.postfx);
    if (cfg.milkdrop) {
      out.milkdrop = Object.assign({}, cfg.milkdrop, {
        maxSize: below(cfg.milkdrop.maxSize, MD_MAX_SIZE),
        mesh: below(cfg.milkdrop.mesh, MD_MESH),
        renderScale: below(cfg.milkdrop.renderScale, 1),
      });
    }
    if (Array.isArray(cfg.layers)) {
      out.layers = cfg.layers.map((l) => (l && Array.isArray(l.postfx) && l.postfx.length
        ? Object.assign({}, l, { postfx: effectsOff(l.postfx) }) : l));
    }
    return out;
  }

  const api = { active, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLowPower = api;
})();
