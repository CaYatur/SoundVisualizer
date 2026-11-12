/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KLAVYE KISAYOLLARI PENCERESİ. Kısayollar yalnız README'de yazıyordu; uygulamanın içinde
   bakılacak bir yer yoktu. Liste shared/hotkeys.js'te (tek tanım). `?` ile, aramadan
   ("kısayol") ve Ayarlar > Uygulama'daki düğmeden açılır; Esc ya da dışına tıklamak kapatır. */
(function () {
  const tr = (s) => (window.SVI18n && window.SVI18n.t ? window.SVI18n.t(s) : s) || s;
  let node = null;
  let lastFocus = null;

  function isOpen() {
    return !!(node && node.isConnected);
  }

  function close() {
    if (!node) return;
    node.remove();
    node = null;
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  function onKey(e) {
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function keyLabel(k, mac) {
    if (mac && k === 'Ctrl') return 'Cmd';
    return tr(k);
  }

  function open() {
    if (isOpen()) { close(); return; }
    const P = window.SVPanel;
    const HK = window.SVHotkeys;
    if (!P || !HK || !document.body) return;
    const el = P.el;
    const mac = !!(window.SV_PLATFORM && window.SV_PLATFORM.isMac);
    const body = el('div', { class: 'keys-help-body' });
    HK.GROUPS.forEach((g) => {
      body.appendChild(el('div', { class: 'keys-help-group', text: tr(g.title) }));
      const list = el('div', { class: 'keys-help-list' });
      g.keys.forEach((row) => {
        const combo = el('span', { class: 'keys-help-combo' });
        row.keys.forEach((k, i) => {
          if (i) combo.appendChild(el('span', { class: 'keys-help-plus', text: '+' }));
          combo.appendChild(el('kbd', { text: keyLabel(k, mac && row.mac) }));
        });
        list.appendChild(combo);
        list.appendChild(el('span', { class: 'keys-help-text', text: tr(row.text) }));
      });
      body.appendChild(list);
    });
    const closeBtn = el('button', { class: 'btn small', type: 'button', icon: 'x', title: tr('Kapat (Esc)'), 'aria-label': tr('Kapat (Esc)'), onclick: close });
    node = el('div', { class: 'ask-backdrop keys-help-backdrop' }, [
      el('div', { class: 'ask-panel keys-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Klavye kısayolları') }, [
        el('div', { class: 'keys-help-head' }, [el('div', { class: 'ask-title', text: tr('Klavye kısayolları') }), closeBtn]),
        body,
        el('div', { class: 'ask-text keys-help-more', text: tr(HK.MORE) }),
      ]),
    ]);
    node.addEventListener('mousedown', (e) => { if (e.target === node) close(); });
    lastFocus = document.activeElement;
    document.body.appendChild(node);
    document.addEventListener('keydown', onKey, true);
    closeBtn.focus();
  }

  window.SVShortcutsHelp = { open, close, isOpen };
})();
