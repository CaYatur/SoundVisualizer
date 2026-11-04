/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Başlık araması (#957): dar ve geniş pencerede, Basit kip açık/kapalı, gerçek tıklama ve tuşlarla.
// Girdi odaklanmalı, sonuç gelmeli, sayfa sekmelerinin üstüne binmemeli, Esc kapatmalı.
// Kullanım: xvfb-run -a node scripts/ui-search.js [--as-windows]
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9798, asWindows: process.argv.includes('--as-windows') });
  const { a } = s; await sleep(1500);
  const q = (x) => a.ev(x);
  const J = async (x) => JSON.parse(await q('JSON.stringify((()=>{' + x + '})())'));
  const mouse = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: 1 }); await sleep(300); };
  const key = async (k, code, mods) => { for (const type of ['rawKeyDown', 'keyUp']) await a.call('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 27, modifiers: mods || 0 }); await sleep(250); };
  const probe = () => J(`const i=document.getElementById('searchInput'),r=document.getElementById('searchResults'),ir=i.getBoundingClientRect(),w=i.closest('.topsearch').getBoundingClientRect();
    const box=getComputedStyle(i).position==='absolute'?ir:w;
    const tabs=[...document.querySelectorAll('.sv-pages button, .sv-pages a')].filter(b=>b.getBoundingClientRect().width);
    const hit=tabs.filter(b=>{const t=b.getBoundingClientRect();return t.right>box.left&&t.left<box.right&&t.bottom>box.top&&t.top<box.bottom}).map(b=>b.textContent.trim());
    const cut=tabs.filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.textContent.trim());
    return {focus:document.activeElement===i, w:Math.round(ir.width), op:+getComputedStyle(i).opacity, res:r.classList.contains('hidden')?0:r.querySelectorAll('.sr-item').length, hit, cut, fit:document.querySelector('.topbar').getAttribute('data-fit'), pop:i.closest('.topsearch').classList.contains('ts-pop')}`);
  const out = []; let ok = true;
  for (const simple of [false, true]) {
    await q(`(()=>{const t=document.getElementById('simpleToggle'); if (t.checked!==${simple}) t.click(); return 1})()`);
    for (const W of [1024, 1280, 1600]) {
      await a.call('Emulation.setDeviceMetricsOverride', { width: W, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(700);
      const c = await J("const r=document.querySelector('.topsearch').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]");
      // Tıklama noktasındaki öğe başlığa ait olmalı (sürükleme bölgesi ya da örtü yutmasın)
      const top = await q(`(document.elementFromPoint(${c[0]},${c[1]})||{}).closest('.topsearch') ? 1 : 0`);
      await mouse(c[0], c[1]);
      await a.call('Input.insertText', { text: 'bloom' }); await sleep(500);
      const open = await probe();
      await key('Escape', 'Escape');
      const esc = await probe();
      await mouse(5, 400);
      await key('k', 'KeyK', 2); const ck = await probe(); await key('Escape', 'Escape');
      await key('f', 'KeyF', 2); const cf = await probe(); await key('Escape', 'Escape');
      const good = top && open.focus && open.res > 0 && open.op === 1 && open.w >= 100 && !open.hit.length && !open.cut.length && !esc.focus && esc.res === 0 && ck.focus && cf.focus;
      ok = ok && good;
      out.push({ simple, W, top, open, esc: { focus: esc.focus, res: esc.res }, ck: ck.focus, cf: cf.focus, good });
    }
  }
  console.log(JSON.stringify(out), JSON.stringify(s.errors.slice(0, 3)), ok && !s.errors.length ? "tamam" : "SORUN");
  await s.stop(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
