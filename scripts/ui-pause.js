/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Önizleme duraklatma (#957): sürdür düğmesi tüm katmanların üstünde ve tıklanabilir; önizlemeye tıklamak ya da
// Boşluk sürdürür; araç çubuğu simgesi ve durum eşit kalır. Kullanım: xvfb-run -a node scripts/ui-pause.js
const { sleep, startPanel } = require('./ui-lib');
(async () => {
  const s = await startPanel({ port: 9805 });
  const { a } = s; await sleep(1500);
  const q = (x) => a.ev(x);
  const fails = [];
  await q("document.querySelector('#pageTabs [data-cat=\"scene\"]').click(); 1"); await sleep(1200);
  const st = () => q(`JSON.stringify((()=>{const b=document.getElementById('previewToggle'),r=document.querySelector('.sv-resume');
    return {p:window.SVPreview.isPaused(),ic:b&&b.querySelector('[data-icon]')?b.querySelector('[data-icon]').dataset.icon:(b?b.innerHTML.includes('play')?'play':'pause':''),vis:!!(r&&!r.hidden)}})())`).then(JSON.parse);
  const center = () => q(`JSON.stringify((()=>{const r=document.getElementById('previewStage').getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const t=document.elementFromPoint(x,y);return {x,y,top:t&&t.closest('.sv-resume')?1:0}})())`).then(JSON.parse);
  const clickAt = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(200); };
  const pause = async () => { await q("document.getElementById('previewToggle').click();1"); await sleep(200); };
  await pause();
  let v = await st();
  if (!v.p || !v.vis || v.ic !== 'play') fails.push('duraklatma durumu: ' + JSON.stringify(v));
  const c = await center();
  if (!c.top) fails.push('sürdür düğmesi üstte değil');
  await clickAt(c.x, c.y); v = await st();
  if (v.p || v.vis || v.ic !== 'pause') fails.push('ortadan tıklama sürdürmedi: ' + JSON.stringify(v));
  // Önizlemenin kenarına tıklamak da sürdürür
  await pause();
  const r = JSON.parse(await q("JSON.stringify(document.getElementById('previewStage').getBoundingClientRect())"));
  await clickAt(r.left + 40, r.top + r.height - 60); v = await st();
  if (v.p) fails.push('kenara tıklama sürdürmedi');
  // Boşluk (odak önizlemede)
  await pause();
  await a.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await a.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); await sleep(200);
  v = await st();
  if (v.p) fails.push('Boşluk sürdürmedi');
  // Araç çubuğu düğmesi duraklatılmışken de tıklanabilir
  await pause();
  const t = JSON.parse(await q("JSON.stringify((()=>{const r=document.getElementById('previewToggle').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})())"));
  await clickAt(t.x, t.y); v = await st();
  if (v.p || v.ic !== 'pause') fails.push('araç düğmesi sürdürmedi: ' + JSON.stringify(v));
  await s.stop();
  console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ui-pause: OK');
  process.exit(fails.length ? 1 : 0);
})();
