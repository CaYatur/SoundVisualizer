/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// MilkDrop ızgarası (#957): preset seçince kaydırma yerinde kalır, etkin işaret yerinde değişir.
// Kullanım: xvfb-run -a node scripts/ui-mdscroll.js
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9806 });
  const { a } = s; const q = (x) => a.ev(x); const fails = [];
  await sleep(1500);
  // Testte preset yok: 400 sahte yerleşik preset
  await q("window.SVMilkdropBuiltins = Array.from({length:400},(_, i)=>({id:'t'+i,name:'Test '+i,kind:'milkdrop',builtin:true})); localStorage.setItem('sv-md-view','grid'); window.SVPanel.setCategory('scene'); 1");
  await sleep(800);
  await q("window.SVSceneShell.setShelf('milkdrop'); window.SVPanel.rerender && window.SVPanel.rerender(); 1"); await sleep(1200);
  for (const view of ['grid', 'list']) {
    if (view === 'list') { await q("(()=>{const v=[...document.querySelectorAll('#svShelf select')].find(x=>[...x.options].some(o=>o.value==='list'));v.value='list';v.dispatchEvent(new Event('change'));return 1})()"); await sleep(1200); }
    const sel = view === 'grid' ? '#svShelf .md-grid' : '#svShelf .md-list';
    const n = await q(`(()=>{const g=document.querySelector('${sel}');if(!g)return 0;g.scrollTop=Math.min(g.scrollHeight-g.clientHeight, 600);g.dispatchEvent(new Event('scroll'));return g.children.length})()`);
    if (!n) { fails.push(view + ': liste yok'); continue; }
    await sleep(500);
    const t = JSON.parse(await q(`JSON.stringify((()=>{const g=document.querySelector('${sel}'),b=g.getBoundingClientRect();
      const c=[...g.querySelectorAll('[data-id]:not(.md-thumb-box)')].find(n=>{const r=n.getBoundingClientRect();return r.top>b.top+30&&r.bottom<b.bottom-10&&!n.classList.contains('active')});
      const r=c.getBoundingClientRect();return {id:c.dataset.id,x:r.left+r.width/3,y:r.top+12,st:g.scrollTop}})())`));
    for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x: t.x, y: t.y, button: 'left', clickCount: 1 });
    await sleep(1200);
    const r = JSON.parse(await q(`JSON.stringify((()=>{const g=document.querySelector('${sel}');const act=[...g.querySelectorAll('.active[data-id]')].map(n=>n.dataset.id);return {st:g.scrollTop,act}})())`));
    if (Math.abs(r.st - t.st) > 2) fails.push(`${view}: kaydırma atladı ${t.st} -> ${r.st}`);
    if (r.act.length !== 1 || r.act[0] !== t.id) fails.push(`${view}: etkin işaret ${JSON.stringify(r.act)} beklenen ${t.id}`);
  }
  await s.stop();
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ui-mdscroll: OK');
  process.exit(fails.length ? 1 : 0);
})();
