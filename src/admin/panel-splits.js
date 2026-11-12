/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PANEL AYRAÇLARI. Sahne sayfasında rafın yüksekliği ile Katmanlar ve Denetçi panellerinin
   genişliği, aralarındaki ayraç sürüklenerek değişiyor.

   Değer piksel değil PAY olarak saklanıyor (rafın ortadaki sütundaki, yan panelin sahnedeki
   payı): pencere büyüyüp küçülünce paneller seçilen payla birlikte ölçekleniyor. Piksel
   sınırları CSS'te (shell.css, clamp): başka bir pencere boyunda da pay önizlemeyi ya da bir
   paneli yok edemiyor. Ayraca çift tıklamak yalnız o ayracı, Ayarlar → Uygulama → Panel →
   "Panel Boyutlarını Sıfırla" hepsini varsayılana döndürüyor. Ok tuşları da çalışıyor.

   Makineye özgü görünüm tercihi: kart boyu gibi localStorage'da; ayar dosyasına, tam yedeğe
   ve yedek makineye gitmiyor. */
(function () {
  const GAP = 10;
  const MIN_SHELF = 150;
  const MIN_STAGE = 150;
  const MIN_CENTER = 420;
  const SPLITS = {
    shelf: { key: 'sv-split-shelf', host: 'svCenter', prop: '--sv-shelf-frac', axis: 'y', min: 0.05, max: 0.95 },
    left: { key: 'sv-split-left', host: 'svScene', prop: '--sv-lw-frac', axis: 'x', min: 0.05, max: 0.32 },
    right: { key: 'sv-split-right', host: 'svScene', prop: '--sv-rw-frac', axis: 'x', min: 0.05, max: 0.38 },
  };
  const NAMES = Object.keys(SPLITS);
  const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* depo yok */ } };

  /* Saklanan pay: sayı değilse ya da sınırın dışındaysa yok sayılır (elle bozulmuş depo). */
  function parse(name, raw) {
    const s = SPLITS[name];
    if (!s || raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < s.min || n > s.max) return null;
    return Math.round(n * 10000) / 10000;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hostOf = (name) => (typeof document !== 'undefined' ? document.getElementById(SPLITS[name].host) : null);
  const attr = (name) => 'data-split-' + name;
  function innerWidth(el) {
    const cs = getComputedStyle(el);
    return el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }

  /* Payı uygula (null: varsayılan). Kaydetmeden: sürüklerken her harekette çağrılıyor. */
  function apply(name, frac) {
    const host = hostOf(name);
    if (!host) return;
    const s = SPLITS[name];
    if (frac === null) {
      host.style.removeProperty(s.prop);
      host.removeAttribute(attr(name));
    } else {
      host.style.setProperty(s.prop, String(frac));
      host.setAttribute(attr(name), '');
    }
  }

  /* Şu an ekranda görünen pay: kullanıcı hiç dokunmadıysa varsayılan yerleşimin payı. */
  function measured(name) {
    const host = hostOf(name);
    if (!host) return null;
    if (name === 'shelf') {
      const box = host.querySelector('.sv-stagebox');
      const h = host.clientHeight;
      return box && h ? (h - box.offsetHeight) / h : null;
    }
    const w = innerWidth(host);
    const pane = document.getElementById(name === 'left' ? 'svLayers' : 'svInspector');
    return pane && w ? pane.offsetWidth / w : null;
  }

  /* İmlecin yerinden pay. Sınırlar: raf ve önizleme en az 150 px, orta sütun en az 420 px;
     önizleme 16:9 genişliğinden uzun olamadığı için ondan büyük önizleme payı da istenmiyor
     (ayraç imleçle birlikte gitsin, görünmeyen bir pay saklanmasın). */
  function fracAt(name, x, y) {
    const host = hostOf(name);
    if (!host) return null;
    const r = host.getBoundingClientRect();
    if (name === 'shelf') {
      const h = r.height;
      if (!(h > MIN_SHELF + MIN_STAGE)) return null;
      let stage = y - r.top - GAP / 2;
      stage = clamp(stage, MIN_STAGE, Math.min(h - MIN_SHELF, r.width * 0.5625));
      return clamp((h - stage) / h, SPLITS.shelf.min, SPLITS.shelf.max);
    }
    const w = innerWidth(host);
    if (!(w > 0)) return null;
    const left = r.left + (parseFloat(getComputedStyle(host).paddingLeft) || 0);
    const other = document.getElementById(name === 'left' ? 'svInspector' : 'svLayers');
    const otherW = other ? other.offsetWidth : 0;
    let px = name === 'left' ? x - left - GAP / 2 : left + w - x - GAP / 2;
    px = Math.min(px, w - otherW - 2 * GAP - MIN_CENTER);
    return clamp(px / w, SPLITS[name].min, SPLITS[name].max);
  }

  function syncAria(name) {
    if (typeof document === 'undefined') return;
    const h = document.querySelector('.sv-split[data-split="' + name + '"]');
    if (!h) return;
    const m = measured(name);
    h.setAttribute('aria-valuemin', '0');
    h.setAttribute('aria-valuemax', '100');
    if (m !== null) h.setAttribute('aria-valuenow', String(Math.round(m * 100)));
  }

  function set(name, frac) {
    const v = frac === null ? null : parse(name, frac);
    apply(name, v);
    write(SPLITS[name].key, v === null ? null : String(v));
    syncAria(name);
    notify();
  }
  function get(name) { return parse(name, read(SPLITS[name].key)); }
  function customized() { return NAMES.some((n) => get(n) !== null); }
  function reset(name) {
    for (const n of name ? [name] : NAMES) set(n, null);
  }
  const listeners = new Set();
  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function notify() { listeners.forEach((cb) => { try { cb(); } catch (e) { /* dinleyici */ } }); }

  function drag(handle, e) {
    const name = handle.getAttribute('data-split');
    if (!SPLITS[name] || e.button !== 0) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* yakalama yok */ }
    const axis = SPLITS[name].axis;
    handle.classList.add('drag');
    document.body.classList.add('sv-splitting', 'sv-splitting-' + axis);
    let last = null;
    const move = (ev) => {
      const f = fracAt(name, ev.clientX, ev.clientY);
      if (f === null) return;
      last = f;
      apply(name, f);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      handle.removeEventListener('lostpointercapture', end);
      handle.classList.remove('drag');
      document.body.classList.remove('sv-splitting', 'sv-splitting-' + axis);
      if (last !== null) set(name, last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
  }

  /* Klavye: ok tuşu ayracı o yöne %2 (Shift ile %8) taşır; Home varsayılana döndürür. */
  function key(handle, e) {
    const name = handle.getAttribute('data-split');
    if (!SPLITS[name]) return;
    if (e.key === 'Home') { e.preventDefault(); reset(name); return; }
    const y = SPLITS[name].axis === 'y';
    const keys = y ? { ArrowUp: 1, ArrowDown: -1 } : name === 'left' ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowLeft: 1, ArrowRight: -1 };
    const dir = keys[e.key];
    if (!dir) return;
    e.preventDefault();
    // Ekranda görünen pay: saklanan pay CSS sınırına takılmış olabilir
    const m = measured(name);
    const cur = m !== null ? m : get(name);
    if (cur === null) return;
    const host = hostOf(name);
    const r = host.getBoundingClientRect();
    const step = (e.shiftKey ? 0.08 : 0.02) * dir;
    // İmleç gibi aynı sınırlardan geçsin: payı ayracın yerine çevirip fracAt'e veriyoruz
    let f;
    if (y) f = fracAt(name, 0, r.top + r.height * (1 - cur - step) + GAP / 2);
    else {
      const w = innerWidth(host);
      const left = r.left + (parseFloat(getComputedStyle(host).paddingLeft) || 0);
      const want = (cur + step) * w;
      f = fracAt(name, name === 'left' ? left + want + GAP / 2 : left + w - want - GAP / 2, 0);
    }
    if (f !== null) set(name, f);
  }

  function init() {
    if (typeof document === 'undefined') return;
    for (const n of NAMES) apply(n, get(n));
    document.querySelectorAll('.sv-split[data-split]').forEach((h) => {
      if (h.dataset.svSplitBound) return;
      h.dataset.svSplitBound = '1';
      h.addEventListener('pointerdown', (e) => drag(h, e));
      h.addEventListener('dblclick', () => reset(h.getAttribute('data-split')));
      h.addEventListener('keydown', (e) => key(h, e));
      // Ekran okuyucu değeri: odaklanınca güncel (pencere boyu değişmiş olabilir)
      h.addEventListener('focus', () => syncAria(h.getAttribute('data-split')));
    });
    NAMES.forEach(syncAria);
  }

  const api = { SPLITS, MIN_SHELF, MIN_STAGE, MIN_CENTER, parse, get, set, reset, customized, onChange, init, fracAt, measured };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.SVPanelSplits = api;
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();
    }
  }
})();
