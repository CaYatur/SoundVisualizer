/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Ayarlar › 'Ses Köprüsü Ayarlarını Aç' bağlantısı Ses kategorisinde Ses Köprüsü kartına
// gitmeli: kart çizili, görünür alanda ve kısa süre vurgulu (#957).
const { sleep, startPanel } = require('./ui-lib');

(async () => {
  const s = await startPanel({ port: 9802 });
  const { a } = s;
  const fails = [];
  try {
    await sleep(1500);
    await a.ev("window.SVPanel.setCategory('settings'); 1");
    await sleep(800);
    const clicked = await a.ev("(() => { const b = [...document.querySelectorAll('#sections button')].find((x) => /Ses Köprüsü Ayarlarını Aç|Audio Bridge Settings/i.test(x.textContent)); if (!b) return false; b.click(); return true; })()");
    if (!clicked) fails.push('bağlantı düğmesi bulunamadı');
    await sleep(300);
    const r = JSON.parse(await a.ev(`JSON.stringify((() => {
      const card = [...document.querySelectorAll('#sections .card')].find((c) => { const h = c.querySelector('h3'); return h && /Ses Köprüsü|Audio Bridge/.test(h.textContent); });
      if (!card) return { page: localStorage.getItem('sv-category'), card: false };
      const b = card.getBoundingClientRect();
      return { page: localStorage.getItem('sv-category'), card: true, flash: card.classList.contains('flash'), closed: !!card.closest('.group.closed'), top: b.top, h: window.innerHeight };
    })())`));
    if (r.page !== 'audio') fails.push('kategori audio değil: ' + r.page);
    if (!r.card) fails.push('Ses Köprüsü kartı çizilmedi');
    else {
      if (!r.flash) fails.push('kart vurgulanmadı');
      if (r.closed) fails.push('kart kapalı grupta');
    }
    await sleep(1200);
    const vis = await a.ev("(() => { const c = [...document.querySelectorAll('#sections .card')].find((c) => /Ses Köprüsü|Audio Bridge/.test((c.querySelector('h3') || {}).textContent || '')); if (!c) return false; const b = c.getBoundingClientRect(); return b.top < window.innerHeight && b.bottom > 0; })()");
    if (!vis) fails.push('kart görünür alanda değil');
  } catch (e) { fails.push(String(e && e.message || e)); }
  s.stop();
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('ui-navcard: OK');
  process.exit(0);
})();
