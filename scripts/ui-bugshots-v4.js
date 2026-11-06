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
    // 1) Timeline context menu (EN labels)
    await q(`(() => {
      const cfg = window.SVPanel.cfg();
      cfg.timeline.enabled = true;
      if (!cfg.timeline.tracks || !cfg.timeline.tracks.length) {
        cfg.timeline.tracks = [{ id: 'tr1', kind: 'clip', name: 'Track 1', clips: [
          { id: 'c1', type: 'palette', ref: 'Orman', name: '', start: 0, dur: 4 },
        ] }];
      }
      window.SVPanel.apply();
      if (window.SVPanel.rerender) window.SVPanel.rerender();
      return 1;
    })()`);
    await sleep(900);
    await q(`(() => {
      const TP = window.SVTimelinePanel;
      const cv = document.querySelector('.tl-editor canvas, .tl-wrap canvas, canvas');
      if (!cv) throw new Error('timeline canvas yok');
      const r = cv.getBoundingClientRect();
      const x = r.left + Math.min(120, r.width * 0.3);
      const y = r.top + 50;
      if (TP && TP._menu) TP._menu(x, y);
      else cv.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y, button: 2 }));
      return 1;
    })()`);
    await sleep(500);
    const menu = JSON.parse(await q(`JSON.stringify((() => {
      const m = document.querySelector('.sv-menu.tl-ctx, .tl-ctx, .sv-menu');
      if (!m) return { missing: true };
      const r = m.getBoundingClientRect();
      const labels = [...m.querySelectorAll('[role=menuitem], button')].map((b) => (b.textContent||'').replace(/\s+/g,' ').trim());
      const tr = /[çğıöşüÇĞİÖŞÜ]/;
      return { x: r.x, y: r.y, w: r.width, h: r.height, labels, trLeft: labels.filter((t) => tr.test(t)) };
    })())`));
    fs.writeFileSync(path.join(out, '01-timeline-context-menu.json'), JSON.stringify(menu, null, 2));
    if (menu.missing || !menu.w) throw new Error('Timeline sağ tık menüsü açılmadı');
    {
      files.push(await shot(a, '01-timeline-context-menu', { x: Math.max(0, menu.x - 8), y: Math.max(0, menu.y - 8), width: Math.min(480, menu.w + 16), height: Math.min(520, menu.h + 16) }));
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
    if (!xf) throw new Error('A/B kutusu (.xf-box) yok');
    {
      files.push(await shot(a, '02-layer-groups-ab', { x: Math.max(0, xf.x - 12), y: Math.max(0, xf.y - 40), width: Math.min(420, xf.w + 24), height: Math.min(280, xf.h + 80) }));
      fs.writeFileSync(path.join(out, '02-layer-groups-ab.json'), JSON.stringify(xf, null, 2));
    }

    // 3) MilkDrop nav after scroll — satır denetçinin görünür alanında olmalı, değilse HATA
    await a.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await q(`(() => {
      const cfg = window.SVPanel.cfg();
      const l = (cfg.layers || []).find((x) => x && x.type === 'milkdrop') || (cfg.layers || []).find((x) => x && x.kind === 'visualizer');
      if (!l) throw new Error('görselleştirici katmanı yok');
      l.type = 'milkdrop'; l.kind = 'visualizer'; window.SVSceneShell.select(l.id);
      window.SVPanel.apply();
      return 1;
    })()`);
    await sleep(1000);
    const MDROW = `(() => {
      const b = document.querySelector('#svInspector .sv-insp');
      const rnd = [...document.querySelectorAll('#svInspector button')].find((x) => /^\\s*(Random|Rastgele)\\s*$/.test(x.textContent||''));
      const lock = [...document.querySelectorAll('#svInspector button')].find((x) => /Lock|Kilitle|Kilitli/.test(x.textContent||''));
      if (!b || !rnd || !lock) return { missing: true, b: !!b, rnd: !!rnd, lock: !!lock };
      let row = rnd.parentElement; while (row && !row.contains(lock)) row = row.parentElement;
      const r = row.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, st: b.scrollTop, inView: r.top >= br.top && r.bottom <= br.bottom && r.bottom <= innerHeight };
    })()`;
    // Denetçiyi satır ortaya gelecek kadar kaydır (gerçek kaydırılmış durum)
    await q(`(() => {
      const b = document.querySelector('#svInspector .sv-insp');
      const rnd = [...document.querySelectorAll('#svInspector button')].find((x) => /^\\s*(Random|Rastgele)\\s*$/.test(x.textContent||''));
      if (!b || !rnd) return 0;
      const br = b.getBoundingClientRect();
      b.scrollTop += rnd.getBoundingClientRect().top - (br.top + br.height / 2);
      return b.scrollTop;
    })()`);
    await sleep(300);
    const md0 = JSON.parse(await q('JSON.stringify(' + MDROW + ')'));
    if (md0.missing) throw new Error('MilkDrop Random/Lock yok: ' + JSON.stringify(md0));
    if (md0.st < 40) throw new Error('denetçi kaydırılamadı: scrollTop=' + md0.st);
    if (!md0.inView) throw new Error('MilkDrop satırı görünür alanda değil: ' + JSON.stringify(md0));
    const clickText = async (re) => {
      const p = JSON.parse(await q(`JSON.stringify((() => { const b = [...document.querySelectorAll('#svInspector button')].find((x) => ${re}.test(x.textContent||'')); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())`));
      for (const type of ['mousePressed', 'mouseReleased']) await a.call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(1000);
    };
    await clickText('/^\\s*(Random|Rastgele)\\s*$/');
    const mdR = JSON.parse(await q('JSON.stringify(' + MDROW + ')'));
    await clickText('/Lock|Kilitle|Kilitli/');
    const md = JSON.parse(await q('JSON.stringify(' + MDROW + ')'));
    md.scrollBefore = md0.st; md.scrollAfterRandom = mdR.st; md.scrollAfterLock = md.st;
    fs.writeFileSync(path.join(out, '03-milkdrop-nav-scroll.json'), JSON.stringify(md, null, 2));
    if (md.missing || !md.inView) throw new Error('tıklamadan sonra MilkDrop satırı görünmüyor: ' + JSON.stringify(md));
    if (Math.abs(mdR.st - md0.st) > 24 || Math.abs(md.st - md0.st) > 24) throw new Error(`kaydırma sıçradı ${md0.st} -> ${mdR.st} -> ${md.st}`);
    files.push(await shot(a, '03-milkdrop-nav-scroll', { x: Math.max(0, md.x - 16), y: Math.max(0, md.y - 80), width: Math.min(420, md.w + 32), height: Math.min(900 - Math.max(0, md.y - 80), md.h + 160) }));

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
