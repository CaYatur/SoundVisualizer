/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* LOGO DEĞİŞİMİ ayarları (#535): logo katmanının kendi logosunda
   (`settings.logo.swap`). Görseller logo kitaplığından seçilir; sıra
   kitaplığın sırası. Kurallar ve belirlenimlilik shared/logo-swap.js'te. */
(function () {
  const P = () => window.SVPanel;
  const SW = () => window.SVLogoSwap;
  const RULE_LABELS = [
    ['seconds', 'Her N saniyede'],
    ['bars', 'Her N ölçüde'],
    ['bass', 'Bas vuruşunda'],
    ['random', 'Rastgele aralıklarla'],
  ];

  function numRow(label, value, min, max, step, onSet) {
    const el = P().el;
    const inp = el('input', { type: 'number', class: 'num', min: String(min), max: String(max), step: String(step) });
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) { inp.value = String(value); return; }
      onSet(Math.max(min, Math.min(max, v)));
    });
    return el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), inp])]);
  }

  function controls(lg, rerender) {
    const el = P().el;
    if (!SW()) return [];
    // Yalnız açılınca ayara yazılır: bakmak yapılandırmayı değiştirmesin
    const on = !!(lg.swap && lg.swap.enabled);
    const out = [];
    const box = el('input', { type: 'checkbox' });
    box.checked = on;
    box.addEventListener('change', () => {
      lg.swap = Object.assign({}, SW().DEFAULTS, lg.swap || {}, { enabled: box.checked });
      P().push(true);
      rerender();
    });
    out.push(el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [
      el('label', { class: 'lbl', text: 'Logo Değişimi' }),
      el('label', { class: 'switch small' }, [box, el('span', { class: 'track' })]),
    ])]));
    if (!on) return out;
    const sw = lg.swap;
    const s = SW().normalize(sw);

    // Kitaplıktan görseller (en az iki)
    const list = el('div', { class: 'swap-items', role: 'group', 'aria-label': 'Değişecek görseller' });
    out.push(el('div', { class: 'group-label', text: 'Değişecek Görseller' }), list);
    if (window.api && window.api.logoLibList) {
      window.api.logoLibList().then((items) => {
        list.textContent = '';
        if (!items || !items.length) {
          list.appendChild(el('div', { class: 'studio-note dim-hint', text: 'Logo kitaplığı boş. Yukarıdaki "Kitaplığa Ekle" ile görsel ekleyin.' }));
          return;
        }
        items.forEach((it) => {
          const c = el('input', { type: 'checkbox' });
          c.checked = sw.items.indexOf(it.id) >= 0;
          c.addEventListener('change', () => {
            // Sıra kitaplığın sırası: seçim değişince yeniden kurulur
            const chosen = new Set(sw.items);
            if (c.checked) chosen.add(it.id); else chosen.delete(it.id);
            sw.items = items.map((x) => x.id).filter((id) => chosen.has(id));
            P().push(true);
            rerender();
          });
          const thumb = window.SVGif && window.SVGif.libraryUrl ? el('img', { class: 'swap-thumb', src: window.SVGif.libraryUrl(it.id), alt: '' }) : null;
          list.appendChild(el('label', { class: 'swap-item' }, [c, thumb, el('span', { text: it.name || it.id, 'data-user-text': '' })].filter(Boolean)));
        });
      }).catch(() => {});
    }
    if (s.items.length < 2) out.push(el('div', { class: 'studio-note warn-note', text: 'Değişim için en az iki görsel seçin.' }));

    const rule = el('select', { class: 'sel-ctrl' });
    RULE_LABELS.forEach(([v, label]) => { const o = el('option', { value: v, text: label }); if (v === s.rule) o.selected = true; rule.appendChild(o); });
    rule.addEventListener('change', () => { sw.rule = rule.value; P().push(true); rerender(); });
    out.push(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Değişim Kuralı' }), rule]));

    if (s.rule === 'seconds') out.push(numRow('Saniye', s.every, 0.25, 3600, 0.25, (v) => { sw.every = v; P().push(true); }));
    if (s.rule === 'bars') {
      out.push(numRow('Ölçü', s.every, 0.25, 512, 0.25, (v) => { sw.every = v; P().push(true); }));
      const b = SW().bpmOf(P().cfg());
      // Sözlük tam metin eşleştiriyor: sayılar ayrı satırda
      out.push(el('div', { class: 'studio-note dim-hint' }, [
        el('div', { text: 'Tempo: zaman çizelgesi açıksa onun temposu, değilse kilitli tempo; ikisi de yoksa 120 BPM.' }),
        el('div', { text: Math.round(b.bpm * 10) / 10 + ' BPM · ' + b.beatsPerBar + '/4' }),
      ]));
    }
    if (s.rule === 'random') {
      out.push(numRow('En Kısa (sn)', s.min, 0.25, 3600, 0.25, (v) => { sw.min = v; P().push(true); }));
      out.push(numRow('En Uzun (sn)', s.max, 0.25, 3600, 0.25, (v) => { sw.max = v; P().push(true); }));
    }
    if (s.rule === 'bass') {
      out.push(numRow('Eşik (0–1)', s.threshold, 0, 1, 0.05, (v) => { sw.threshold = v; P().push(true); }));
      out.push(numRow('En Az Ara (sn)', s.hold, 0, 60, 0.1, (v) => { sw.hold = v; P().push(true); }));
    }

    const tr = el('select', { class: 'sel-ctrl' });
    [['fade', 'Çapraz Geçiş'], ['cut', 'Kesme']].forEach(([v, label]) => { const o = el('option', { value: v, text: label }); if (v === (sw.transition === 'cut' ? 'cut' : 'fade')) o.selected = true; tr.appendChild(o); });
    tr.addEventListener('change', () => { sw.transition = tr.value; P().push(true); rerender(); });
    out.push(el('div', { class: 'ctrl' }, [el('label', { class: 'lbl', text: 'Geçiş' }), tr]));
    if (sw.transition !== 'cut') out.push(numRow('Geçiş Süresi (sn)', s.fade, 0, 10, 0.05, (v) => { sw.fade = v; P().push(true); }));
    out.push(el('div', { class: 'studio-note dim-hint', text: 'Sıra canlı çıkışta ve video dışa aktarımında aynıdır: süre ve ölçü kuralları saatten, rastgele aralıklar sabit bir tohumdan hesaplanır.' }));
    return out;
  }

  window.SVLogoSwapPanel = { controls };
})();
