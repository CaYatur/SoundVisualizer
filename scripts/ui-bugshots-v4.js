/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Dört v4 hata düzeltmesi için kanıt ekran görüntüleri.
   Kullanım: xvfb-run -a node scripts/ui-bugshots-v4.js --out=/path/dir */
const fs = require('fs');
const path = require('path');
const { sleep, startPanel } = require('./ui-lib');

const out = (() => {
  const a = process.argv.find((x) => x.startsWith('--out='));
  return a ? a.slice(6) : path.join(process.cwd(), 'bugshots');
})();
fs.mkdirSync(out, { recursive: true });

async function shot(a, name, clip) {
  const opts = { format: 'png' };
  if (clip) opts.clip = Object.assign({ scale: 1 }, clip);
  const r = await a.call('Page.captureScreenshot', opts);
  const f = path.join(out, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  return f;
}

(async () => {
  const s = await startPanel({ port: 9812, lang: 'en-US' });
  const { a } = s;
  const q = (x) => a.ev(x);
  const files = [];
  try {
    await sleep(1200);
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await q("localStorage.setItem('sv-locale','en'); window.SVPanel.setCategory('time'); 1");
    await sleep(1000);
    // 1) Timeline context menu
    await q(`(() => {
      const cv = document.querySelector('canvas.tl-canvas, .tl-wrap canvas, #tlCanvas, canvas');
      if (!cv) throw new Error('timeline canvas yok');
      const r = cv.getBoundingClientRect();
      const x = r.left + r.width * 0.35, y = r.top + r.height * 0.45;
      cv.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y, button: 2 }));
      return 1;
    })()`);
    await sleep(400);
    const menu = JSON.parse(await q(`JSON.stringify((() => {
      const m = document.querySelector('.tl-ctx, .sv-menu.tl-ctx, .sv-menu');
      if (!m) return null;
      const r = m.getBoundingClientRect();
      const labels = [...m.querySelectorAll('[role=menuitem], button')].map((b) => (b.textContent||'').replace(/\\s+/g,' ').trim());
      return { x: r.x, y: r.y, w: r.width, h: r.height, labels };
    })())`));
    if (menu) {
      files.push(await shot(a, '01-timeline-context-menu', { x: Math.max(0, menu.x - 8), y: Math.max(0, menu.y - 8), width: Math.min(480, menu.w + 16), height: Math.min(520, menu.h + 16) }));
      fs.writeFileSync(path.join(out, '01-timeline-context-menu.json'), JSON.stringify(menu, null, 2));
    }
    await q("document.querySelectorAll('.sv-menu').forEach((m) => m.remove()); 1");

    // 2) Layer Groups A/B at narrow inspector
    await q("window.SVPanel.setCategory('scene'); 1");
    await sleep(800);
    await q(`(() => {
      const cfg = window.SVPanel.cfg();
      cfg.crossfade = cfg.crossfade || { enabled: true, value: 0.35 };
      cfg.crossfade.enabled = true;
      // A/B gruplu iki katman — fader kutusu görünsün
      const layers = cfg.layers || [];
      const ensure = (type, group) => {
        let l = layers.find((x) => x && x.group === group);
        if (!l) {
          l = { id: 't-' + group, kind: 'visualizer', type: type || 'bars', name: group, enabled: true, group, opacity: 1, settings: {} };
          layers.push(l);
        } else l.group = group;
      };
      ensure('bars', 'A'); ensure('wave', 'B');
      cfg.layers = layers;
      window.SVSceneShell.select('');
      window.SVPanel.apply();
      return 1;
    })()`);
    await sleep(1000);
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    // scroll inspector to groups
    await q(`(() => {
      const b = document.querySelector('#svInspector .sv-insp');
      const g = [...b.querySelectorAll('h3, .card-head h3, .item-title')].find((n) => /Layer Groups|Katman Grupları/i.test(n.textContent||''));
      if (g) g.scrollIntoView({ block: 'center' });
      return !!document.querySelector('.xf-box');
    })()`);
    await sleep(300);
    const xf = JSON.parse(await q(`JSON.stringify((() => {
      const box = document.querySelector('.xf-box');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      const btns = [...box.querySelectorAll('button')].map((b) => {
        const br = b.getBoundingClientRect();
        return { t: (b.textContent||'').trim(), top: br.top, left: br.left, w: br.width, h: br.height, bottom: br.bottom, right: br.right };
      });
      return { x: r.x, y: r.y, w: r.width, h: r.height, btns, panelW: document.getElementById('svInspector').getBoundingClientRect().width };
    })())`));
    if (xf) {
      files.push(await shot(a, '02-layer-groups-ab', { x: Math.max(0, xf.x - 12), y: Math.max(0, xf.y - 40), width: Math.min(420, xf.w + 24), height: Math.min(280, xf.h + 80) }));
      fs.writeFileSync(path.join(out, '02-layer-groups-ab.json'), JSON.stringify(xf, null, 2));
    }

    // 3) MilkDrop nav after scroll
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await q(`(() => {
      const cfg = window.SVPanel.cfg();
      const l = (cfg.layers || []).find((x) => x && x.type === 'milkdrop') || (cfg.layers || []).find((x) => x && x.kind === 'visualizer');
      if (l) { l.type = 'milkdrop'; l.kind = 'visualizer'; window.SVSceneShell.select(l.id); }
      window.SVPanel.apply();
      return 1;
    })()`);
    await sleep(1000);
    await q(`(() => {
      const b = document.querySelector('#svInspector .sv-insp');
      if (!b) return 0;
      b.scrollTop = Math.min(b.scrollHeight - b.clientHeight, 380);
      return b.scrollTop;
    })()`);
    await sleep(200);
    await q(`(() => { const b = [...document.querySelectorAll('#svInspector button')].find((x) => /Random|Rastgele/.test(x.textContent||'')); if (b) b.click(); return !!b; })()`);
    await sleep(1000);
    const md = JSON.parse(await q(`JSON.stringify((() => {
      const row = document.querySelector('#svInspector .sv-btn-row') || [...document.querySelectorAll('#svInspector .row')].find((r) => /Random|Rastgele|Lock|Kilitle/.test(r.textContent||''));
      const b = document.querySelector('#svInspector .sv-insp');
      if (!row || !b) return { st: b && b.scrollTop };
      const r = row.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, st: b.scrollTop };
    })())`));
    if (md && md.w) {
      files.push(await shot(a, '03-milkdrop-nav-scroll', { x: Math.max(0, md.x - 16), y: Math.max(0, md.y - 80), width: Math.min(420, md.w + 32), height: Math.min(320, md.h + 160) }));
      fs.writeFileSync(path.join(out, '03-milkdrop-nav-scroll.json'), JSON.stringify(md, null, 2));
    }

    // 4) Preset shelf card size
    await q("window.SVSceneShell.setShelf('templates'); 1");
    await sleep(900);
    await q(`(() => {
      const r = document.querySelector('#svShelf .sv-card-size input');
      if (!r) throw new Error('slider yok');
      r.value = '220'; r.dispatchEvent(new Event('input', { bubbles: true }));
      return r.value;
    })()`);
    await sleep(500);
    const shelf = JSON.parse(await q(`JSON.stringify((() => {
      const host = document.getElementById('svShelf');
      const r = host.getBoundingClientRect();
      const g = host.querySelector('.tpl-grid');
      const cs = g && getComputedStyle(g);
      return {
        x: r.x, y: r.y, w: r.width, h: Math.min(520, r.height),
        card: host.style.getPropertyValue('--sv-card'),
        tracks: cs ? cs.gridTemplateColumns.split(' ').length : 0,
        n: g ? g.querySelectorAll('.tpl-card').length : 0,
      };
    })())`));
    files.push(await shot(a, '04-preset-cardsize', { x: Math.max(0, shelf.x), y: Math.max(0, shelf.y), width: Math.min(900, shelf.w), height: Math.min(520, shelf.h) }));
    fs.writeFileSync(path.join(out, '04-preset-cardsize.json'), JSON.stringify(shelf, null, 2));
    // also small size for comparison
    await q(`(() => { const r = document.querySelector('#svShelf .sv-card-size input'); r.value = '110'; r.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await sleep(400);
    files.push(await shot(a, '04-preset-cardsize-small', { x: Math.max(0, shelf.x), y: Math.max(0, shelf.y), width: Math.min(900, shelf.w), height: Math.min(520, shelf.h) }));
  } catch (e) {
    fs.writeFileSync(path.join(out, 'error.txt'), String(e && e.stack || e));
    console.error(e);
    await s.stop();
    process.exit(1);
  }
  await s.stop();
  console.log('wrote', files.join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
