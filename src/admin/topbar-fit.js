/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Üst çubuk sığdırma (#957). Önceden yalnız pencere genişliğine bakan medya
   sorguları vardı; sağ taraf değişince (çıkış açıkken "Kapat" + "Ekranları
   Uygula" gelir) sayfa kapsülü komşularının üstüne taşıyordu. Burada GERÇEK
   genişlik ölçülüyor: çakışma varsa bir sonraki sıkıştırma düzeyine geçilir
   (yazı → ikon), hiçbir zaman üst üste binmez. Ölçüm yalnız boyut ya da
   içerik değişince yapılır; her karede değil. */
(function () {
  const MAX = 6;
  const GAP = 6;

  // Saf: üç kutunun sınırları çakışıyor mu (yatay, px)
  function overlaps(left, mid, right, gap) {
    const g = gap == null ? GAP : gap;
    if (!left || !mid || !right) return false;
    return left.right + g > mid.left || mid.right + g > right.left || left.right + g > right.left;
  }
  // Saf: ölçüm işlevi verilince sığan en düşük düzey
  function fitLevel(measure, max) {
    const m = max == null ? MAX : max;
    for (let lv = 0; lv < m; lv++) if (!measure(lv)) return lv;
    return m;
  }

  function apply(bar, lv) {
    for (let i = 1; i <= MAX; i++) bar.classList.toggle('tb-fit' + i, lv >= i);
    bar.setAttribute('data-fit', String(lv));
    // Yalnız ikon kalan düğmelerin adı ipucunda kalsın
    if (lv >= 4) {
      bar.querySelectorAll('.sv-tools .btn').forEach((b) => {
        const t = (b.textContent || '').trim();
        if (t && !b.getAttribute('title')) { b.setAttribute('title', t); b.setAttribute('data-fit-title', '1'); }
        if (t && !b.getAttribute('aria-label')) b.setAttribute('aria-label', t);
      });
    }
  }

  function collides(bar) {
    const L = bar.querySelector('.sv-top-left');
    const M = bar.querySelector('.sv-pages');
    const R = bar.querySelector('.sv-tools');
    if (!L || !M || !R) return false;
    const r = (e) => e.getBoundingClientRect();
    const tight = (e) => e.scrollWidth > e.clientWidth + 1;
    return overlaps(r(L), r(M), r(R)) || tight(M) || tight(R) || tight(L);
  }

  function fit(bar) {
    if (!bar || !bar.isConnected) return 0;
    const lv = fitLevel((n) => { apply(bar, n); return collides(bar); });
    apply(bar, lv);
    return lv;
  }

  function install(bar) {
    if (!bar || bar._svFit) return null;
    let pending = 0;
    const run = () => { pending = 0; fit(bar); };
    const later = () => { if (!pending) pending = requestAnimationFrame(run); };
    bar._svFit = later;
    if (typeof ResizeObserver === 'function') new ResizeObserver(later).observe(bar);
    // Sağ taraftaki düğmeler açılıp kapanınca, yazılar değişince, Basit kip
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver((list) => {
        // Kendi düzey sınıflarımız ve canlı ölçer değişimleri ölçüm tetiklemez
        if (list.some((m) => m.target !== bar && !(m.target.closest && m.target.closest('.sv-vu')))) later();
      });
      mo.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class'] });
      new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', later);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(later);
    later();
    return later;
  }

  const api = { overlaps, fitLevel, fit, install, collides, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SVTopbarFit = api;
    const go = () => install(document.querySelector('.topbar'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
