/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Sahne › alt kitaplık rafı kart boyu (#957): raf başlığındaki kaydırıcı bütün sekmelerin
// ızgarasına uygulanıyor; kartlar satırı eşit dolduruyor (sağda boşluk yok), boy kalıcı.
const { sleep, startPanel } = require('./ui-lib');

const PROBE = `JSON.stringify((() => {
  const g = document.querySelector('#svShelf .sv-gal, #svShelf .md-grid');
  if (!g) return null;
  const cs = getComputedStyle(g);
  const inner = g.getBoundingClientRect().left + parseFloat(cs.paddingLeft) + g.clientLeft;
  const right = g.getBoundingClientRect().left + g.clientLeft + g.clientWidth - parseFloat(cs.paddingRight);
  const cards = [...g.children].filter((c) => c.matches('.sv-gi, .md-cell'));
  if (!cards.length) return { cls: g.className, n: 0 };
  const y0 = cards[0].getBoundingClientRect().top;
  const row = cards.filter((c) => Math.abs(c.getBoundingClientRect().top - y0) < 2);
  const ws = row.map((c) => c.getBoundingClientRect().width);
  const th = cards[0].querySelector('.sv-th, .md-thumb-box');
  const tb = th && th.getBoundingClientRect();
  return { cls: g.className, n: cards.length, cols: row.length, tracks: cs.gridTemplateColumns.split(' ').length, wmin: Math.min(...ws), wmax: Math.max(...ws),
    leftGap: row[0].getBoundingClientRect().left - inner, rightGap: right - row[row.length - 1].getBoundingClientRect().right,
    ratio: tb && tb.height ? tb.width / tb.height : 0 };
})())`;

(async () => {
  const s = await startPanel({ port: 9803 });
  const { a } = s;
  const fails = [];
  const q = (x) => a.ev(x);
  try {
    await sleep(1500);
    await q("localStorage.setItem('sv-md-view','grid'); window.SVPanel.setCategory('scene'); 1");
    await sleep(800);
    for (const W of [1024, 1600, 1920]) {
      await a.call('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const tab of ['vis', 'bg', 'milkdrop']) {
        await q(`window.SVSceneShell.setShelf('${tab}'); 1`);
        await sleep(700);
        const ctl = await q("!!document.querySelector('#svShelf .sv-chead .sv-card-size input[type=range]')");
        if (!ctl) { fails.push(W + '/' + tab + ': kart boyu denetimi yok'); continue; }
        const sizes = {};
        for (const v of [110, 220]) {
          await q(`(() => { const r = document.querySelector('#svShelf .sv-card-size input'); r.value = '${v}'; r.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
          await sleep(400);
          const r = JSON.parse(await q(PROBE));
          if (!r || !r.n) { if (tab === 'milkdrop') break; fails.push(W + '/' + tab + ': ızgara yok'); break; }
          sizes[v] = r.tracks;
          if (r.wmin < v - 1 && r.cols > 1) fails.push(`${W}/${tab}/${v}: kart ${r.wmin.toFixed(0)}px < ${v}`);
          if (r.wmax - r.wmin > 1) fails.push(`${W}/${tab}/${v}: eşit olmayan kart genişliği`);
          if (r.cols > 1 && r.cols === r.tracks && Math.abs(r.rightGap - r.leftGap) > 3) fails.push(`${W}/${tab}/${v}: kenar hizası sol ${r.leftGap.toFixed(1)} sağ ${r.rightGap.toFixed(1)}`);
          if (r.ratio && Math.abs(r.ratio - 16 / 9) > 0.05) fails.push(`${W}/${tab}/${v}: küçük resim oranı ${r.ratio.toFixed(2)}`);
        }
        if (sizes[110] && sizes[220] && !(sizes[110] > sizes[220])) fails.push(`${W}/${tab}: boy büyüyünce sütun azalmadı (${sizes[110]} / ${sizes[220]})`);
      }
    }
    const kept = await q("localStorage.getItem('sv-shelf-card')");
    if (kept !== '220') fails.push('kart boyu saklanmadı: ' + kept);
    // Ctrl + tekerlek
    await q(`(() => { const g = document.querySelector('#svShelf .sv-cbody'); g.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })); return 1; })()`);
    await sleep(200);
    const after = await q("localStorage.getItem('sv-shelf-card')");
    if (!(Number(after) > 220)) fails.push('Ctrl+tekerlek boyu büyütmedi: ' + after);
  } catch (e) { fails.push(String(e && e.message || e)); }
  s.stop();
  if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('ui-cardsize: OK');
  process.exit(0);
})();
