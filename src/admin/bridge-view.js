/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SES KÖPRÜSÜ görünümü (#813): durum hapı, ölçüm kutucukları, seviye ve
   bant çubukları, '?' yardımı. Paneldeki Ses Köprüsü kartı ve köprü kipinin
   küçük durum penceresi aynı parçaları kullanıyor; görünüm iki yerde aynı.
   Metinler Türkçe yazılır, i18n.js İngilizceye çevirir. Kullanıcının verdiği
   adlar (köprü adı, aygıt, parça) data-user-text taşır: çevrilmez. */
(function () {
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s);

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    const a = attrs || {};
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    (kids || []).forEach((c) => { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function ms(v) { return v == null || !Number.isFinite(Number(v)) ? '—' : (Math.round(v * 10) / 10) + ' ms'; }
  function pct(v) { return Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%'; }

  // Durum hapı: tone = ok | warn | err | off
  function pill(tone, text) {
    return el('span', { class: 'br-pill ' + (tone || 'off'), role: 'status' }, [el('span', { class: 'br-dot' }), el('span', { text })]);
  }

  // Kutucuk: kısa etiket + değer (+ isteğe bağlı küçük not)
  function tile(label, value, opts) {
    const o = opts || {};
    return el('div', { class: 'br-tile' + (o.tone ? ' ' + o.tone : '') + (o.wide ? ' wide' : '') }, [
      el('div', { class: 'br-tile-k', text: label }),
      el('div', Object.assign({ class: 'br-tile-v', text: String(value) }, o.user ? { 'data-user-text': '' } : {})),
      o.note ? el('div', Object.assign({ class: 'br-tile-n', text: o.note }, o.noteUser ? { 'data-user-text': '' } : {})) : null,
    ]);
  }

  // Seviye çubuğu (0..1); peak varsa ince işaret
  function meter(level, peak, cls) {
    const bar = el('div', { class: 'br-meter ' + (cls || '') }, [el('div', { class: 'br-meter-fill', style: { width: pct(level) } })]);
    if (peak != null) bar.appendChild(el('div', { class: 'br-meter-peak', style: { left: pct(peak) } }));
    return bar;
  }
  function levelTile(level, peak) {
    return el('div', { class: 'br-tile wide' }, [
      el('div', { class: 'br-tile-k', text: tr('Seviye') }),
      el('div', { class: 'br-tile-v br-level' }, [meter(level, peak, 'br-level-bar'), el('span', { class: 'br-num', text: pct(level) })]),
    ]);
  }
  function bandsTile(bands) {
    const b = bands || {};
    const row = (k, v) => el('div', { class: 'br-band' }, [el('span', { class: 'br-band-k', text: k }), meter(v, null, 'br-mini')]);
    return el('div', { class: 'br-tile' }, [
      el('div', { class: 'br-tile-k', text: tr('Bantlar') }),
      el('div', { class: 'br-bands' }, [row(tr('B'), b.bass), row(tr('O'), b.mid), row(tr('T'), b.treble)]),
    ]);
  }
  // Çözümlemenin kutucukları: BPM, vuruş, yaş
  function analysisTiles(a) {
    const out = [];
    if (!a) return out;
    const bpmKnown = a.bpm && a.confidence >= 0.3;
    out.push(tile(tr('BPM'), a.bpm ? String(a.bpm) : tr('ölçülüyor'), { tone: bpmKnown ? '' : 'dim', note: a.bpm && !bpmKnown ? tr('belirsiz') : '' }));
    out.push(tile(tr('Vuruş'), a.onsets || 0));
    out.push(tile(tr('Çözümleme yaşı'), ms(a.ageMs)));
    return out;
  }
  function grid(nodes) { return el('div', { class: 'br-grid' }, nodes.filter(Boolean)); }

  // '?' yardımı: kısa açıklama tıklayınca açılır
  function help(text) {
    return el('details', { class: 'br-help' }, [
      el('summary', { 'aria-label': tr('Yardım'), title: tr('Yardım'), text: '?' }),
      el('div', { class: 'br-help-body', text }),
    ]);
  }

  // Etiketin yanındaki '?' ve satırın altındaki açıklama (gizli başlar)
  function helpBody(text) { return el('div', { class: 'br-help-body', hidden: true, text }); }
  function helpButton(body) {
    const b = el('button', { class: 'br-q', type: 'button', 'aria-label': tr('Yardım'), 'aria-expanded': 'false', title: tr('Yardım'), text: '?' });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      body.hidden = !body.hidden;
      b.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
      b.classList.toggle('on', !body.hidden);
    });
    return b;
  }

  window.SVBridgeView = { el, ms, pct, pill, tile, meter, levelTile, bandsTile, analysisTiles, grid, help, helpBody, helpButton };
})();
