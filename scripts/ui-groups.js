/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Ayar grupları (#957): Ayarlar'da alt grup başlıkları düz etiket (katlanmaz); başka yerde görünür içeriği kalmayan grup başlığı
// kendiliğinden gizlenmeli ve içerik görünür olunca geri gelmeli; Ayarlar sayfası bunun dışında.
// Kullanım: xvfb-run -a node scripts/ui-groups.js
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9799 });
  const { a } = s; await sleep(1500);
  const q = (x) => a.ev(x);
  await q("window.SVPanel.setCategory('settings'); 1"); await sleep(1200);
  const r = JSON.parse(await q(`(async()=>JSON.stringify(await (async()=>{
    const fr=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const gs=[...document.querySelectorAll('.group')].filter(g=>g.querySelector(':scope > .group-label'));
    const bad=[];
    // Ayarlar: alt grup başlıkları düz etiket; ok yok, tıklayınca katlanmaz, içerik görünür
    for (const g of gs) {
      const lab=g.querySelector(':scope > .group-label'), n=lab.textContent.trim();
      if (lab.tagName==='BUTTON'||!lab.classList.contains('static')) bad.push('katlanır başlık: '+n);
      if (lab.querySelector('.sv-caret')) bad.push('ok var: '+n);
      lab.click(); await fr();
      if (g.classList.contains('closed')||[...g.children].some(c=>c!==lab&&getComputedStyle(c).display==='none'&&!c.hidden)) bad.push('içerik gizlendi: '+n);
    }
    if (!document.body.hasAttribute('data-sv-keep-groups')) bad.push('Ayarlar sayfası vazgeçme işareti yok');
    // Ayarlar: içi boşalsa da başlık gizlenmez
    const g=gs.find(g=>g.querySelectorAll(':scope > :not(.group-label)').length);
    const kids=[...g.querySelectorAll(':scope > :not(.group-label)')];
    kids.forEach(c=>c.hidden=true); await fr();
    if (g.classList.contains('sv-empty')) bad.push('Ayarlar sayfasında grup gizlendi');
    kids.forEach(c=>c.hidden=false);
    // Başka yerde (vazgeçmesiz kap): boş grup gizlenir, içerik gelince geri gelir
    const host=document.createElement('div');document.body.appendChild(host);
    host.innerHTML='<div class="group"><button class="group-label">X</button><div class="ctrl">a</div></div>';
    const h=host.firstChild, hc=h.lastChild;
    document.body.removeAttribute('data-sv-keep-groups'); await fr();
    hc.hidden=true; await fr();
    if (!h.classList.contains('sv-empty')) bad.push('boş grup gizlenmedi');
    hc.hidden=false; await fr();
    if (h.classList.contains('sv-empty')) bad.push('içerik gelince grup geri gelmedi');
    host.remove(); document.body.setAttribute('data-sv-keep-groups','');
    return {n:gs.length,bad};
  })()))()`));
  console.log(r.n + ' grup', r.bad.length ? r.bad.join('; ') : 'tamam');
  s.stop(); process.exit(r.bad.length || !r.n ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
