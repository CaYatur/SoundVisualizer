/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Ayar grupları (#957): kapalı grup gövdesini gizlemeli; görünür içeriği kalmayan grup başlığı
// kendiliğinden gizlenmeli ve içerik görünür olunca geri gelmeli.
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
    for (const g of gs) {
      const lab=g.querySelector(':scope > .group-label'), was=g.classList.contains('closed');
      if (!was) lab.click();
      if ([...g.children].some(c=>c!==lab&&getComputedStyle(c).display!=='none')) bad.push('kapalı ama görünür: '+lab.textContent.trim());
      if (!was) lab.click();
    }
    const g=gs.find(g=>g.querySelectorAll(':scope > :not(.group-label)').length);
    const kids=[...g.querySelectorAll(':scope > :not(.group-label)')];
    kids.forEach(c=>c.hidden=true); await fr();
    if (!g.classList.contains('sv-empty')) bad.push('boş grup gizlenmedi');
    kids[0].hidden=false; await fr();
    if (g.classList.contains('sv-empty')) bad.push('içerik gelince grup geri gelmedi');
    kids.forEach(c=>c.hidden=false);
    return {n:gs.length,bad};
  })()))()`));
  console.log(r.n + ' grup', r.bad.length ? r.bad.join('; ') : 'tamam');
  s.stop(); process.exit(r.bad.length || !r.n ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
