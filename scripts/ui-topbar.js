/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Üst çubuk (#957): görselleştirici açıkken (Kapat + Ekranları Uygula) çubuk kapalı hâline benzemeli; önce ikincil
// eylemler ikona iner, sayfa adları ve marka en son. Kullanım: xvfb-run -a node scripts/ui-topbar.js
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9807 });
  const { a } = s; const q = (x) => a.ev(x); const fails = []; const out = [];
  await sleep(1500);
  const setRun = (on) => q(`(()=>{const c=document.getElementById('closeBtn'),o=document.getElementById('openBtn');c.disabled=!${on};window.SVIcons.set(o,'play',${on}?'Ekranları Uygula':'Görselleştirmeyi Aç');return 1})()`);
  const probe = () => q(`JSON.stringify((()=>{const b=document.querySelector('.topbar'),vis=(e)=>!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;
    return {fit:+b.getAttribute('data-fit'),labels:[...b.querySelectorAll('.sv-pages .nav-label')].every(vis),brand:vis(b.querySelector('.brand-text')),hit:window.SVTopbarFit.collides(b),kids:[".sv-top-left",".sv-tools"].map(s=>[...b.querySelector(s).children].filter(e=>e.getBoundingClientRect().width>0).map(e=>(e.id||e.className).slice(0,18)+":"+Math.round(e.getBoundingClientRect().width))),dm:[".sv-top-left",".sv-pages",".sv-tools"].map(s=>{const e=b.querySelector(s),r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.right),e.scrollWidth,e.clientWidth]}),ow:document.getElementById('openBtn').getBoundingClientRect().width,cw:document.getElementById('closeBtn').getBoundingClientRect().width}})())`).then(JSON.parse);
  for (const W of [1024, 1280, 1600]) {
    await a.call('Emulation.setDeviceMetricsOverride', { width: W, height: 800, deviceScaleFactor: 1, mobile: false });
    const r = {};
    for (const run of [false, true]) { await setRun(run); await sleep(500); r[run ? 'acik' : 'kapali'] = await probe(); }
    out.push({ W, ...r });
    for (const k of ['kapali', 'acik']) if (r[k].hit) fails.push(`${W}/${k}: çakışma`);
    // Her iki hâlde de sayfa adları ve marka görünmeli (1024+)
    for (const k of ['kapali', 'acik']) if (!r[k].labels || !r[k].brand) fails.push(`${W}/${k}: sayfa adları ya da marka gizli`);
  }
  if (process.argv[2]) for (const run of [false, true]) { await a.call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(800); await setRun(run); await sleep(150);
    const sh = await a.call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1024, height: 60, scale: 1 } }); require('fs').writeFileSync(process.argv[2] + (run ? '-acik.png' : '-kapali.png'), Buffer.from((sh.result || sh).data, 'base64')); }
  await s.stop();
  console.log(JSON.stringify(out));
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ui-topbar: OK');
  process.exit(fails.length ? 1 : 0);
})();
