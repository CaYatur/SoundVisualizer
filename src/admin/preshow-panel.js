/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* GÖSTERİ ÖNCESİ DENETİM paneli (#545). Denetim ana süreçte
   (main/preshow.js); burada sonuç. Panel görünürken 3 sn'de bir yenilenir.
   Kapılar açılmadan bakılır, bir şey bozulduktan sonra değil. */
(function () {
  const P = () => window.SVPanel;
  let last = null;
  let busy = false;
  let timer = null;

  const ICON = { ok: 'check', warn: 'warning', fail: 'x', info: 'info' };
  const OVERALL = { ok: 'Düzen hazır', warn: 'Düzen hazır, uyarılar var', fail: 'Düzen hazır değil' };

  async function run() {
    if (busy || !window.api || !window.api.preshowCheck) return;
    busy = true;
    try {
      const r = await window.api.preshowCheck();
      const changed = JSON.stringify(r) !== JSON.stringify(last);
      last = r;
      if (changed && document.querySelector('.preshow-panel')) P().rerender();
    } catch { /* ana süreç yanıt vermedi */ } finally { busy = false; }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => {
      if (!document.querySelector('.preshow-panel')) { clearInterval(timer); timer = null; return; }
      run();
    }, 3000);
  }

  function panel() {
    const el = P().el;
    ensureTimer();
    if (!last) run();
    const nodes = [];
    if (last) {
      nodes.push(el('div', { class: 'studio-status ' + (last.overall === 'ok' ? 'ok' : last.overall === 'fail' ? 'err' : ''), role: 'status' }, [
        el('span', { icon: ICON[last.overall] || 'info' }),
        el('span', { text: OVERALL[last.overall] || OVERALL.ok }),
      ]));
      const list = el('ul', { class: 'preshow-list' });
      last.checks.forEach((c) => {
        const row = el('li', { class: 'preshow-row ' + c.state }, [
          el('span', { class: 'preshow-icon', icon: ICON[c.state] || 'info', 'aria-hidden': 'true' }),
          el('span', { class: 'preshow-text', text: c.text }),
        ]);
        (c.parts || []).forEach((p) => {
          row.appendChild(el('span', { class: 'st-sep', 'aria-hidden': 'true', text: ' · ' }));
          row.appendChild(el('span', { class: 'st-num', text: String(p), 'data-user-text': '' }));
        });
        list.appendChild(row);
      });
      nodes.push(list);
    } else {
      nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Denetleniyor…' }));
    }
    nodes.push(el('div', { class: 'lay-file' }, [
      el('button', { class: 'btn small', type: 'button', icon: 'refresh', text: 'Şimdi Denetle', onclick: () => run() }),
    ]));
    nodes.push(el('div', { class: 'studio-note dim-hint', text: 'Ekranlar, ses, çıkışların kare hızı, sahnenin dosyaları, yedek ve disk. Kare hızı ekran kartının payını gösterir: çıkış ekranın yenileme hızını (kare sınırı varsa onu) tutmuyorsa kart yetişmiyordur.' }));
    return el('div', { class: 'preshow-panel' }, nodes);
  }

  window.SVPreshowPanel = { panel, run };
})();
