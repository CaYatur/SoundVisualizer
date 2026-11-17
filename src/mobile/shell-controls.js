/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOBİL ARAYÜZÜN AYAR DENETİMLERİ (Faz 3, onaylı taslak 3 "Katman ayarları").

   Kaydırıcı, seçim kutusu, anahtar, parçalı seçim, renk ve metin satırları. Her
   satır en az 48 dp; etiket solda (104 px), değer sağda. Denetimler YEREL öğeler
   (range, select, button[role=switch]): ekran okuyucu ve klavye kendiliğinden
   çalışıyor, select Android'in kendi seçicisini açıyor.

   Metinler Türkçe yazılıyor; i18n.js sayfadaki metni ve aria-label'ı çeviriyor.
   Sayılar dilin ondalık ayıracıyla ("0,70" / "0.70"), yüzde "%55" (EN: "55%"). */
(function () {
  if (typeof window === 'undefined' || !window.SVShell) return;
  const { h, icon } = window.SVShell;

  const en = () => !!(window.SVI18n && window.SVI18n.locale === 'en');
  function num(v, digits) {
    const s = (+v).toFixed(digits == null ? 2 : digits);
    return en() ? s : s.replace('.', ',');
  }
  function decimalsOf(step) {
    const s = String(step || 1);
    const i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(3, s.length - i - 1);
  }
  /* Gösterilen değer: yüzde ise "%55", tam sayı adımında "160", yoksa adımın basamağı. */
  function formatter(o) {
    if (o.format) return o.format;
    if (o.percent) return (v) => '%' + Math.round(v * 100);
    const d = decimalsOf(o.step);
    return (v) => (d ? num(v, d) : String(Math.round(v)));
  }

  function row(label, kids, cls) {
    return h('div', { class: 'ctl-row' + (cls ? ' ' + cls : '') }, [label ? h('div', { class: 'ctl-label', text: label }) : null].concat(kids));
  }

  /* Kaydırıcı. onInput sürüklerken (canlı), onChange bırakınca. */
  function slider(o) {
    const fmt = formatter(o);
    const min = o.min == null ? 0 : o.min;
    const max = o.max == null ? 1 : o.max;
    const val = h('div', { class: 'ctl-val', 'aria-hidden': 'true' });
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(o.step || 0.01), 'aria-label': o.label });
    const paint = (v) => {
      const p = max > min ? ((v - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--p', Math.max(0, Math.min(100, p)) + '%');
      val.textContent = fmt(v);
      input.setAttribute('aria-valuetext', fmt(v));
    };
    const set = (v) => { const n = Math.max(min, Math.min(max, +v)); input.value = String(n); paint(n); };
    set(o.value == null ? min : o.value);
    input.addEventListener('input', () => { const v = +input.value; paint(v); if (o.onInput) o.onInput(v); });
    input.addEventListener('change', () => { if (o.onChange) o.onChange(+input.value); });
    const r = row(o.label, [input, val]);
    r.set = set;
    r.input = input;
    return r;
  }

  /* Seçim kutusu: dokununca kabuğun seçenek listesi açılır (SVShell.choose). Yerel
     <select> kullanılmıyor: uygulama bağlamıyla kurulan WebView'de Android'in seçicisi
     açılmıyordu. Değer düğmenin data-v'sinde, görünen ad seçeneğin metni. */
  function select(o) {
    const opts = (o.options || []).map(([v, t]) => [String(v), t]);
    const text = h('span', { class: 'select-text' });
    const btn = h('button', { class: 'select-btn', 'aria-haspopup': 'listbox' }, [text, icon('chevron-down')]);
    let value = '';
    const set = (v) => {
      value = String(v);
      btn.dataset.v = value;
      const hit = opts.find(([k]) => k === value);
      text.textContent = hit ? hit[1] : value;
    };
    set(o.value);
    btn.addEventListener('click', async () => {
      if (btn.disabled || !window.SVShell.choose) return;
      const v = await window.SVShell.choose(o.label, opts, value);
      if (v == null || v === value) return;
      set(v);
      if (o.onChange) o.onChange(v);
    });
    const box = h('div', { class: 'select' }, [btn]);
    const r = row(o.label, [box]);
    r.set = set;
    r.input = btn;
    return r;
  }

  function toggle(o) {
    const b = h('button', { class: 'toggle', role: 'switch', 'aria-label': o.label, 'aria-checked': o.value ? 'true' : 'false' });
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      if (o.onChange) o.onChange(on);
    });
    const r = row(o.label, [b], 'sw-row');
    r.set = (v) => b.setAttribute('aria-checked', v ? 'true' : 'false');
    r.input = b;
    return r;
  }

  /* Parçalı seçim: az seçenekli ayarlar (Renk modu, Bant). */
  function seg(o) {
    const btns = (o.options || []).map(([v, t]) => h('button', { 'data-v': String(v), text: t }));
    const box = h('div', { class: 'seg', role: 'group', 'aria-label': o.label }, btns);
    const set = (v) => {
      for (const b of btns) {
        const on = b.dataset.v === String(v);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    for (const b of btns) b.addEventListener('click', () => { set(b.dataset.v); if (o.onChange) o.onChange(b.dataset.v); });
    set(o.value);
    const r = row(o.label, [box], 'col');
    r.set = set;
    return r;
  }

  /* Renk: dokununca kabuğun renk seçicisi (SVShell.pickColor); input type=color'ın
     Android penceresi de uygulama bağlamlı WebView'de açılmıyordu. Sürüklerken onInput
     (canlı), Tamam'da onChange; Vazgeç ilk rengi onInput ile geri koyar. */
  function color(o) {
    let value = o.value || '#ffffff';
    const btn = h('button', { class: 'swatch', 'aria-label': o.label });
    const set = (v) => { value = v || '#ffffff'; btn.style.background = value; btn.dataset.v = value; };
    set(value);
    btn.addEventListener('click', async () => {
      if (btn.disabled || !window.SVShell.pickColor) return;
      const live = o.onInput || o.onChange;
      const v = await window.SVShell.pickColor(o.label, value, (x) => { btn.style.background = x; if (live) live(x); });
      if (v == null) { btn.style.background = value; return; }
      set(v);
      if (o.onChange) o.onChange(v);
    });
    const r = row(o.label, [h('div', { class: 'spacer' }), btn]);
    r.set = set;
    r.input = btn;
    return r;
  }

  function text(o) {
    const input = h('input', { type: 'text', class: 'field', 'aria-label': o.label, placeholder: o.placeholder || '', value: o.value || '' });
    input.addEventListener('input', () => o.onInput && o.onInput(input.value));
    input.addEventListener('change', () => o.onChange && o.onChange(input.value));
    const r = row(o.label, [input]);
    r.set = (v) => { if (document.activeElement !== input) input.value = v; };
    return r;
  }

  function card(kids, cls) {
    return h('div', { class: 'card' + (cls ? ' ' + cls : '') }, [h('div', { class: 'ctl' }, kids.filter(Boolean))]);
  }

  /* Sekmeler (Kaynak / Dönüşüm / Ses tepkisi / Efektler). */
  function tabs(list, current, onPick) {
    const btns = list.map(([id, t]) => h('button', { role: 'tab', 'data-id': id, text: t }));
    const set = (id) => {
      for (const b of btns) {
        const on = b.dataset.id === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    };
    for (const b of btns) b.addEventListener('click', () => { set(b.dataset.id); onPick(b.dataset.id); });
    set(current);
    return h('div', { class: 'tabs', role: 'tablist' }, btns);
  }

  window.SVShellUI = Object.freeze({ num, formatter, row, slider, select, toggle, seg, color, text, card, tabs });
})();
